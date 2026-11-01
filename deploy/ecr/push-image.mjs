#!/usr/bin/env node
// Standalone CLI: build the qms360-api image, create the ECR repo if it does
// not exist, push it under an immutable <version>-<gitSHA> tag, and print the
// image ref plus the kubectl rollout commands. Never touches the cluster and
// never edits any manifest.
//
// Usage:
//   node push-image.mjs --version 1.0.0
//   node push-image.mjs --version 1.0.0 --allow-dirty
//   node push-image.mjs --version 1.0.0 --source qms360-api:local-build
//
// Run `node push-image.mjs --help` for the full flag list.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  DescribeImagesCommand,
  GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";

const DEFAULT_REPO = "qms360-api";
const DEFAULT_REGION = "ap-south-1";
const DEFAULT_DOCKERFILE = "artifacts/api-server/Dockerfile";
const DEFAULT_CONTEXT = ".";

function printHelp() {
  console.log(`
qms360 ECR push CLI

Builds (or reuses) a Docker image, ensures the ECR repository exists, and
pushes it under an immutable "<version>-<gitSHA>" tag.

Flags:
  --version <v>        Required. Human-readable version label, e.g. 1.0.0.
  --dockerfile <path>  Dockerfile to build. Default: ${DEFAULT_DOCKERFILE}
  --context <path>     Docker build context. Default: ${DEFAULT_CONTEXT}
  --source <image>     Push an already-built local image instead of building.
                        Mutually exclusive with --dockerfile/--context.
  --repo <name>         ECR repository name. Default: ${DEFAULT_REPO}
  --region <region>    AWS region. Default: ${DEFAULT_REGION}
  --allow-dirty         Allow a dirty git working tree (refused otherwise, so
                        the tag always matches committed source).
  -h, --help            Show this help.

Examples:
  node push-image.mjs --version 1.0.0
  node push-image.mjs --version 1.0.1 --allow-dirty
  node push-image.mjs --version 1.0.0 --source qms360-api:local-build

Requires: Docker running, git, and AWS credentials with ecr:* permissions
(the same access key/secret used for S3 uploads works). See README.md.
`);
}

function parseArgs(argv) {
  const args = {
    version: null,
    dockerfile: null,
    context: null,
    source: null,
    repo: DEFAULT_REPO,
    region: DEFAULT_REGION,
    allowDirty: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const [flag, inlineValue] = token.includes("=") ? token.split(/=(.*)/s) : [token, undefined];

    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Flag ${flag} requires a value.`);
      }
      i++;
      return next;
    };

    switch (flag) {
      case "--version":
        args.version = takeValue();
        break;
      case "--dockerfile":
        args.dockerfile = takeValue();
        break;
      case "--context":
        args.context = takeValue();
        break;
      case "--source":
        args.source = takeValue();
        break;
      case "--repo":
        args.repo = takeValue();
        break;
      case "--region":
        args.region = takeValue();
        break;
      case "--allow-dirty":
        args.allowDirty = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function checkTool(command, versionArgs, friendlyName) {
  try {
    run(command, versionArgs);
  } catch {
    fail(`${friendlyName} does not appear to be available. Install/start it and try again.`);
  }
}

function getGitState(allowDirty) {
  let status;
  try {
    status = run("git", ["status", "--porcelain"]);
  } catch {
    fail("Not a git repository (or git is not installed). Run this from inside the repo.");
  }

  if (status.trim().length > 0 && !allowDirty) {
    fail(
      "Working tree has uncommitted changes. Commit first so the pushed tag matches " +
        "committed source, or pass --allow-dirty to override.",
    );
  }

  const shortSha = run("git", ["rev-parse", "--short", "HEAD"]).trim();
  return { shortSha, dirty: status.trim().length > 0 };
}

function validateVersion(version) {
  if (!version) {
    fail("--version is required.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(version)) {
    fail(`--version "${version}" has characters a Docker tag cannot use. Stick to letters, digits, ., _, -.`);
  }
}

function mapAwsError(error, action) {
  const name = error?.name ?? "";
  const message = error?.message ?? String(error);

  if (name === "AccessDeniedException" || message.includes("AccessDenied")) {
    return (
      `AWS access denied while trying to ${action}. The credentials in use lack the ` +
      "required ecr:* permissions -- see README.md for the exact permission list, and " +
      "ask whoever manages IAM to grant them."
    );
  }
  if (
    name === "CredentialsProviderError" ||
    name === "UnrecognizedClientException" ||
    name === "ExpiredTokenException" ||
    message.includes("Could not load credentials")
  ) {
    return (
      "AWS credentials are missing or expired. Set AWS_ACCESS_KEY_ID / " +
      "AWS_SECRET_ACCESS_KEY (the same ones used for S3 uploads) or run `aws configure`, " +
      "then try again."
    );
  }
  if (name === "RepositoryNotFoundException") {
    return `ECR repository not found while trying to ${action}. This should have been created automatically -- check the --repo value.`;
  }
  return `AWS error while trying to ${action}: ${name || "unknown"} -- ${message}`;
}

async function ensureRepository(client, repoName, region) {
  try {
    const described = await client.send(
      new DescribeRepositoriesCommand({ repositoryNames: [repoName] }),
    );
    return described.repositories[0].repositoryUri;
  } catch (error) {
    if (error.name !== "RepositoryNotFoundException") {
      fail(mapAwsError(error, "look up the ECR repository"));
    }
  }

  console.log(`ECR repository "${repoName}" does not exist yet -- creating it in ${region}...`);
  try {
    const created = await client.send(
      new CreateRepositoryCommand({
        repositoryName: repoName,
        imageTagMutability: "IMMUTABLE",
        imageScanningConfiguration: { scanOnPush: true },
      }),
    );
    return created.repository.repositoryUri;
  } catch (error) {
    fail(mapAwsError(error, "create the ECR repository"));
  }
}

async function tagAlreadyExists(client, repoName, tag) {
  try {
    await client.send(
      new DescribeImagesCommand({ repositoryName: repoName, imageIds: [{ imageTag: tag }] }),
    );
    return true;
  } catch (error) {
    if (error.name === "ImageNotFoundException") return false;
    fail(mapAwsError(error, "check whether the image tag already exists"));
  }
}

async function dockerLogin(client, registry) {
  let auth;
  try {
    auth = await client.send(new GetAuthorizationTokenCommand({}));
  } catch (error) {
    fail(mapAwsError(error, "get an ECR authorization token"));
  }

  const token = auth.authorizationData[0].authorizationToken;
  const [, password] = Buffer.from(token, "base64").toString("utf8").split(":");

  try {
    run("docker", ["login", "--username", "AWS", "--password-stdin", registry], {
      input: password,
    });
  } catch (error) {
    fail(`docker login to ${registry} failed: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.source && (args.dockerfile || args.context)) {
    fail("--source cannot be combined with --dockerfile/--context -- pick one build mode.");
  }

  validateVersion(args.version);
  checkTool("docker", ["info"], "Docker");
  checkTool("git", ["--version"], "git");

  const { shortSha, dirty } = getGitState(args.allowDirty);
  if (dirty) {
    console.log("WARNING: pushing with uncommitted changes (--allow-dirty was set).");
  }

  const fullTag = `${args.version}-${shortSha}`;
  const client = new ECRClient({ region: args.region });

  console.log(`Checking ECR repository "${args.repo}" in ${args.region}...`);
  const repositoryUri = await ensureRepository(client, args.repo, args.region);

  console.log(`Checking tag "${fullTag}" is not already pushed (tags are immutable)...`);
  if (await tagAlreadyExists(client, args.repo, fullTag)) {
    fail(
      `Tag "${fullTag}" already exists in "${args.repo}" and tags are immutable. ` +
        "Commit a change (new SHA) or bump --version.",
    );
  }

  const localTag = `${args.repo}:${fullTag}`;

  if (args.source) {
    console.log(`Using already-built image "${args.source}" as the source.`);
    run("docker", ["tag", args.source, localTag]);
  } else {
    const dockerfile = resolve(args.dockerfile ?? DEFAULT_DOCKERFILE);
    const context = resolve(args.context ?? DEFAULT_CONTEXT);
    if (!existsSync(dockerfile)) {
      fail(`Dockerfile not found: ${dockerfile}`);
    }
    console.log(`Building ${localTag} from ${dockerfile} (context: ${context})...`);
    run("docker", ["build", "-f", dockerfile, "-t", localTag, context], { stdio: "inherit" });
  }

  const registry = repositoryUri.split("/")[0];
  console.log(`Logging in to ${registry}...`);
  await dockerLogin(client, registry);

  const remoteRef = `${repositoryUri}:${fullTag}`;
  console.log(`Tagging ${localTag} as ${remoteRef}...`);
  run("docker", ["tag", localTag, remoteRef]);

  console.log(`Pushing ${remoteRef}...`);
  run("docker", ["push", remoteRef], { stdio: "inherit" });

  console.log("\nPush complete.\n");
  console.log(`image: ${remoteRef}\n`);
  console.log("Both qms360 Deployments share this image -- roll out whichever one(s) changed:");
  console.log(
    `  kubectl -n codefactory set image deployment/qms360-api qms360-api=${remoteRef}`,
  );
  console.log(`  kubectl -n codefactory rollout status deployment/qms360-api`);
  console.log(
    `  kubectl -n codefactory set image deployment/qms360-scheduler qms360-scheduler=${remoteRef}`,
  );
  console.log(`  kubectl -n codefactory rollout status deployment/qms360-scheduler`);
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
