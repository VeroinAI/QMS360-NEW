# qms360 ECR push CLI

Builds the `qms360-api` image, creates the ECR repository if it doesn't
exist yet, and pushes it under an immutable `<version>-<gitSHA>` tag. This
tool is standalone on purpose: its own `package.json`, its own
`node_modules`, one dependency (`@aws-sdk/client-ecr`). It never touches the
app's workspace, the cluster, or any manifest -- it only prints the `image:`
ref and the `kubectl set image` command for you to run yourself.

## Prerequisites

- Docker Desktop running
- `git` installed, and this is a checkout of the QMS360-NEW repo
- AWS credentials with the permissions listed below, available as
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars (or any other
  credential source the AWS SDK picks up, e.g. `aws configure`). The same
  access key/secret already used for S3 uploads works.

Required IAM permissions (`ecr:*` scoped to the `qms360-api` repository is
enough, plus the account-level token call):

- `ecr:GetAuthorizationToken`
- `ecr:DescribeRepositories`
- `ecr:CreateRepository`
- `ecr:DescribeImages`
- `ecr:BatchCheckLayerAvailability`
- `ecr:InitiateLayerUpload`
- `ecr:UploadLayerPart`
- `ecr:CompleteLayerUpload`
- `ecr:PutImage`

## Install

```bash
cd deploy/ecr
npm install
```

## Usage

Run from the repo root (`QMS360-NEW/`), not from inside `deploy/ecr/`,
since the default Dockerfile/context paths are relative to the repo root.

```bash
node deploy/ecr/push-image.mjs --version 1.0.0
```

This:
1. Refuses to run if the git working tree is dirty (so the pushed tag
   always matches committed source) -- pass `--allow-dirty` to override.
2. Checks the ECR repo `qms360-api` exists in `ap-south-1`, creating it
   (immutable tags, scan-on-push) if it doesn't.
3. Fails fast if `<version>-<gitSHA>` is already pushed -- tags are
   immutable, so bump `--version` or commit a change first.
4. Builds `artifacts/api-server/Dockerfile` with the repo root as context.
5. Logs in to ECR, tags, and pushes the image.
6. Prints the `image:` ref and the `kubectl set image` rollout commands for
   both `qms360-api` and `qms360-scheduler` (they share the same image --
   see `deploy/k8s/`).

Push an already-built image instead of building one:

```bash
node deploy/ecr/push-image.mjs --version 1.0.0 --source qms360-api:local-build
```

Full flag list:

```bash
node deploy/ecr/push-image.mjs --help
```

## Notes

- Tags are immutable: the same `<version>-<gitSHA>` can never be pushed
  twice. Commit a change (new SHA) or bump `--version`.
- This script never edits `deploy/k8s/*.yaml` and never runs `kubectl` --
  copy the printed command and run it yourself once you're ready to roll
  out.
