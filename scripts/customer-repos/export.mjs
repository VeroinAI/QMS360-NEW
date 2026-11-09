import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = '.qms360-customer-export.json';
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '../..');
const apps = { frontend: 'artifacts/qms360', backend: 'artifacts/api-server' };
const migrationFiles = [
  'package.json', 'tsconfig.json', 'src/migrate.ts', 'src/record-baseline.ts',
  'src/check-schema-drift.ts', 'src/schema-catalog.ts', 'src/schema-semantics.ts',
  'src/jsonb-canonical.ts',
].map(name => `scripts/${name}`);
const excluded = /(^|\/)(node_modules|dist|build|coverage|uploads|fixtures|\.git|\.github|\.local|\.replit-artifact)(\/|$)|(^|\/)\.env($|\.)|\.(test|spec|regression)\.[^/]+$|\.(tsbuildinfo|pem|key|p12|pfx|log|sql\.gz)$/i;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function exportRepository(kind, destination, root = sourceRoot) {
  if (!apps[kind]) throw new Error('Choose frontend or backend.');
  const output = path.resolve(destination);
  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative) && !relative.startsWith('generated-artifacts/'))) {
    throw new Error('Export outside the source tree or under generated-artifacts/.');
  }
  if (existsSync(output) && (lstatSync(output).isSymbolicLink() || readdirSync(output).length)) {
    throw new Error('Export destination must be an empty, non-symlink directory.');
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const packages = new Map();
  for (const file of tracked.filter(file => /^(artifacts|lib)\/[^/]+\/package\.json$/.test(file))) {
    const data = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    packages.set(data.name, { dir: path.dirname(file), data });
  }
  const app = [...packages.values()].find(pkg => pkg.dir === apps[kind]);
  if (!app) throw new Error(`Application package missing: ${apps[kind]}`);
  const selected = new Map();
  function include(pkg) {
    if (selected.has(pkg.data.name)) return;
    selected.set(pkg.data.name, pkg);
    for (const [name, version] of Object.entries({
      ...pkg.data.dependencies, ...pkg.data.devDependencies, ...pkg.data.peerDependencies, ...pkg.data.optionalDependencies,
    })) {
      if (String(version).startsWith('workspace:')) {
        const dependency = packages.get(name);
        if (!dependency || !dependency.dir.startsWith('lib/')) throw new Error(`Unsupported workspace dependency: ${name}`);
        include(dependency);
      }
    }
  }
  include(app);
  const directories = [...selected.values()].map(pkg => pkg.dir);
  const roots = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'];
  for (const required of roots) {
    if (!tracked.includes(required)) throw new Error(`Missing tracked build file: ${required}`);
  }
  const files = tracked.filter(file => !excluded.test(file) && (
    roots.includes(file) || file.startsWith('patches/') ||
    directories.some(dir => file.startsWith(`${dir}/`)) ||
    (kind === 'backend' && migrationFiles.includes(file))
  ));
  const owned = {};
  function put(file, bytes) {
    mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
    writeFileSync(path.join(output, file), bytes);
    owned[file] = digest(bytes);
  }
  for (const file of files) {
    const original = path.join(root, file);
    if (!lstatSync(original).isFile() || lstatSync(original).isSymbolicLink()) throw new Error(`Not a regular source file: ${file}`);
    put(file, readFileSync(original));
  }
  const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  rootPackage.name = `qms360-customer-${kind}`;
  rootPackage.packageManager = 'pnpm@10.26.1';
  rootPackage.scripts = {
    'typecheck:libs': 'tsc --build',
    typecheck: `pnpm run typecheck:libs && pnpm --filter ${app.data.name} run typecheck`,
    build: 'node customer-build.mjs',
    ...(kind === 'backend' ? {
      start: 'pnpm --filter @workspace/api-server run start',
      'db:migrate': 'pnpm --filter @workspace/scripts run migrate',
      'db:check-drift': 'pnpm --filter @workspace/scripts run check-drift',
      'db:record-baseline': 'pnpm --filter @workspace/scripts run record-baseline',
    } : {}),
  };
  put('package.json', json(rootPackage));
  // Preserve the original dependency specifiers and lockfile importers. Unused
  // importers are harmless; frozen installs resolve only the exported workspace.
  const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const rest = workspace.indexOf('\nautoInstallPeers:');
  if (rest < 0) throw new Error('Unrecognized workspace format; update the exporter explicitly.');
  put('pnpm-workspace.yaml', `packages:\n${directories.map(dir => `  - ${dir}`).join('\n')}${kind === 'backend' ? '\n  - scripts' : ''}\n${workspace.slice(rest)}`);
  put('tsconfig.json', json({
    files: [],
    references: directories.filter(dir => dir.startsWith('lib/')).map(dir => ({ path: `./${dir}` })),
  }));
  // Write known safe configuration rather than copying potential registry tokens.
  put('.npmrc', 'auto-install-peers=false\nstrict-peer-dependencies=false\n');
  put('.gitignore', 'node_modules/\ndist/\n*.tsbuildinfo\n.env\n.env.*\nuploads/\n.local/\n');
  put('customer-build.mjs', `import { execFileSync } from 'node:child_process';\nconst env = { ...process.env, PORT: process.env.PORT || '5173', BASE_PATH: process.env.BASE_PATH || '/', NODE_ENV: 'production' };\nexecFileSync('pnpm', ['run', 'typecheck'], { stdio: 'inherit', env });\nexecFileSync('pnpm', ['--filter', '${app.data.name}', 'run', '${kind === 'frontend' ? 'build:drona' : 'build'}'], { stdio: 'inherit', env });\n`);
  if (kind === 'backend') {
    const scriptsPackage = JSON.parse(readFileSync(path.join(root, 'scripts/package.json'), 'utf8'));
    scriptsPackage.scripts = Object.fromEntries(Object.entries(scriptsPackage.scripts).filter(([key]) =>
      ['migrate', 'record-baseline', 'check-drift', 'typecheck'].includes(key)));
    put('scripts/package.json', json(scriptsPackage));
  }
  put('QMS360-DELIVERY.md', `# QMS360 ${kind} delivery\n\nThis branch is generated. Do not edit exported files on vendor-sync; merge changes into your deployment branch through review.\nCustomer-owned README, .github workflows and non-exported deployment files are preserved. Do not put secrets in Git.\n\n## Build\nNode.js 24 and pnpm 10.26.1.\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm run build\n\`\`\`\n\n${kind === 'frontend'
    ? 'The default build uses Drona mode (relative assets and hash routing). Output: artifacts/qms360/dist/public/. Configure the existing Drona API bridge separately. For a browser-hosted build, explicitly supply PORT and BASE_PATH and run pnpm --filter @workspace/qms360 run build instead.'
    : 'Output: artifacts/api-server/dist/. Keep its templates, fonts and worker files together. Install dependencies in this workspace; the server has external runtime dependencies and dist alone is not standalone. Start from this workspace with pnpm start. Configure PORT, database/session, storage, email and any enabled AI services securely for AWS. Migration commands are operator-run only and never run during build or sync. Reconcile the existing database migration ledger before running db:migrate or db:record-baseline.'}\n\nThe retained lockfile can contain unused importers from the source monorepo; only the selected workspace packages are delivered and installed. A source sync does not deploy, configure services or migrate data.\n`);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(path.join(output, MANIFEST), json({ version: 1, kind, sourceCommit, files: owned }));
  return { kind, packages: directories, fileCount: Object.keys(owned).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , kind, destination] = process.argv;
  if (!destination) throw new Error('Usage: node scripts/customer-repos/export.mjs frontend|backend EMPTY_DESTINATION');
  console.log(exportRepository(kind, destination));
}
