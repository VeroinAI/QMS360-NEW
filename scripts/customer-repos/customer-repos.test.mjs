import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportRepository, digest, MANIFEST } from './export.mjs';
import { applyExport } from './sync.mjs';

const json = data => `${JSON.stringify(data, null, 2)}\n`;
function sandbox(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qms-customer-sync-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}
function put(root, file, bytes) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), bytes);
}
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function commit(root) {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
}
function fixture(root) {
  git(root, 'init', '-q');
  put(root, 'package.json', json({ private: true, devDependencies: { typescript: '5.9.3' }, scripts: {} }));
  put(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\n');
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - artifacts/*\n  - lib/*\n  - scripts\n\nautoInstallPeers: false\ncatalog:\n  typescript: 5.9.3\n');
  put(root, 'tsconfig.base.json', '{}\n');
  for (const [dir, name, deps] of [
    ['artifacts/qms360', '@workspace/qms360', { '@workspace/api-client-react': 'workspace:*' }],
    ['artifacts/api-server', '@workspace/api-server', { '@workspace/db': 'workspace:*' }],
    ['lib/api-client-react', '@workspace/api-client-react', { '@workspace/field-controls': 'workspace:*' }],
    ['lib/field-controls', '@workspace/field-controls', {}],
    ['lib/db', '@workspace/db', {}],
    ['artifacts/unrelated', '@workspace/unrelated', {}],
  ]) {
    put(root, `${dir}/package.json`, json({ name, dependencies: deps }));
    put(root, `${dir}/src/index.ts`, 'export const fixture = true;\n');
    put(root, `${dir}/src/index.test.ts`, 'test-only\n');
    put(root, `${dir}/.env.production`, 'not-for-delivery\n');
    put(root, `${dir}/uploads/business.txt`, 'not-for-delivery\n');
  }
  put(root, 'scripts/package.json', json({ name: '@workspace/scripts', scripts: { seed: 'seed', migrate: 'migrate' } }));
  put(root, 'scripts/src/migrate.ts', '// operator only\n');
  put(root, 'scripts/src/seed.ts', '// never export\n');
  put(root, 'artifacts/api-server/src/assets/report.pdf', Buffer.from([0, 1, 2, 255]));
  put(root, 'lib/db/drizzle/0000.sql', '-- schema migration\n');
  put(root, 'patches/example.patch', 'patch data\n');
  put(root, 'attached_assets/customer-data.csv', 'never export\n');
  put(root, '.npmrc', '//registry.invalid/:_authToken=never-copy-this\n');
  commit(root);
}
function incoming(root, files, kind = 'frontend') {
  mkdirSync(root, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) put(root, file, bytes);
  put(root, MANIFEST, json({
    version: 1, kind, sourceCommit: 'fixture',
    files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, digest(bytes)])),
  }));
}
function target(root) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  put(root, 'README.md', 'Customer README\n');
  put(root, '.github/workflows/deploy.yml', 'customer deployment\n');
  put(root, 'Dockerfile', 'customer Dockerfile\n');
  commit(root);
}

test('frontend export follows dependencies but excludes backend, unrelated apps and private files', t => {
  const base = sandbox(t), root = path.join(base, 'source'), output = path.join(base, 'frontend');
  mkdirSync(root);
  fixture(root);
  const result = exportRepository('frontend', output, root);
  assert.deepEqual(result.packages.sort(), ['artifacts/qms360', 'lib/api-client-react', 'lib/field-controls']);
  assert.ok(existsSync(path.join(output, 'lib/field-controls/src/index.ts')));
  assert.ok(!existsSync(path.join(output, 'artifacts/api-server')));
  assert.ok(!existsSync(path.join(output, 'attached_assets')));
  assert.ok(!existsSync(path.join(output, 'artifacts/qms360/.env.production')));
  assert.ok(!existsSync(path.join(output, 'artifacts/qms360/uploads')));
  assert.ok(!existsSync(path.join(output, 'artifacts/qms360/src/index.test.ts')));
  assert.ok(!readFileSync(path.join(output, '.npmrc'), 'utf8').includes('never-copy'));
  assert.match(readFileSync(path.join(output, 'customer-build.mjs'), 'utf8'), /build:drona/);
  assert.match(readFileSync(path.join(output, 'pnpm-workspace.yaml'), 'utf8'), /catalog:/);
  assert.equal(JSON.parse(readFileSync(path.join(output, 'tsconfig.json'))).references.length, 2);
  assert.ok(!existsSync(path.join(output, 'README.md')));
  assert.ok(existsSync(path.join(output, 'QMS360-DELIVERY.md')));
});

test('backend export retains binary templates, schema migrations and only operator scripts', t => {
  const base = sandbox(t), root = path.join(base, 'source'), output = path.join(base, 'backend');
  mkdirSync(root);
  fixture(root);
  exportRepository('backend', output, root);
  assert.ok(existsSync(path.join(output, 'lib/db/drizzle/0000.sql')));
  assert.deepEqual(readFileSync(path.join(output, 'artifacts/api-server/src/assets/report.pdf')), Buffer.from([0, 1, 2, 255]));
  assert.ok(existsSync(path.join(output, 'scripts/src/migrate.ts')));
  assert.ok(!existsSync(path.join(output, 'scripts/src/seed.ts')));
  assert.ok(!('seed' in JSON.parse(readFileSync(path.join(output, 'scripts/package.json'))).scripts));
  assert.ok(!existsSync(path.join(output, 'lib/api-client-react')));
  assert.ok(!readFileSync(path.join(output, 'customer-build.mjs'), 'utf8').includes('db:migrate'));
});

test('export refuses nonempty destinations and missing workspace dependencies', t => {
  const base = sandbox(t), root = path.join(base, 'source'), output = path.join(base, 'frontend');
  mkdirSync(root); fixture(root);
  mkdirSync(output); put(output, 'keep.txt', 'keep');
  assert.throws(() => exportRepository('frontend', output, root), /empty/);
  assert.throws(() => exportRepository('frontend', root, root), /outside/);
  put(root, 'lib/api-client-react/package.json', json({ name: '@workspace/api-client-react', dependencies: { '@workspace/missing': 'workspace:*' } }));
  assert.throws(() => exportRepository('frontend', path.join(base, 'second'), root), /Unsupported workspace dependency/);
});

test('sync preserves customer files, removes only previously managed files, stages only owned changes and is repeatable', t => {
  const base = sandbox(t), source = path.join(base, 'export'), destination = path.join(base, 'target');
  target(destination);
  incoming(source, { 'app/old.ts': 'old', 'app/keep.ts': 'first' });
  applyExport(source, destination); commit(destination);
  put(destination, 'unrelated.txt', 'untracked customer file');
  incoming(source, { 'app/keep.ts': 'second', 'app/new.ts': 'new' });
  applyExport(source, destination);
  assert.ok(!existsSync(path.join(destination, 'app/old.ts')));
  assert.equal(readFileSync(path.join(destination, 'README.md'), 'utf8'), 'Customer README\n');
  assert.equal(readFileSync(path.join(destination, '.github/workflows/deploy.yml'), 'utf8'), 'customer deployment\n');
  assert.equal(readFileSync(path.join(destination, 'Dockerfile'), 'utf8'), 'customer Dockerfile\n');
  assert.ok(!git(destination, 'diff', '--cached', '--name-only').includes('unrelated'));
  // Commit only what applyExport staged, not the unrelated untracked customer file.
  git(destination, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'sync');
  applyExport(source, destination);
  assert.equal(git(destination, 'diff', '--cached', '--name-only'), '');
});

test('sync refuses first-run collisions without making other changes', t => {
  const base = sandbox(t), source = path.join(base, 'export'), destination = path.join(base, 'target');
  target(destination);
  incoming(source, { 'new.txt': 'new', 'Dockerfile': 'different' });
  assert.throws(() => applyExport(source, destination), /customer-owned/);
  assert.ok(!existsSync(path.join(destination, 'new.txt')));
  assert.ok(!existsSync(path.join(destination, MANIFEST)));
});

test('sync refuses manual changes to managed files and wrong export kind', t => {
  const base = sandbox(t), source = path.join(base, 'export'), destination = path.join(base, 'target');
  target(destination); incoming(source, { 'app.ts': 'first' });
  applyExport(source, destination); commit(destination);
  put(destination, 'app.ts', 'customer edit');
  incoming(source, { 'app.ts': 'second', 'new.ts': 'new' });
  assert.throws(() => applyExport(source, destination), /Customer changed/);
  assert.ok(!existsSync(path.join(destination, 'new.ts')));
  put(destination, 'app.ts', 'first');
  incoming(source, { 'app.ts': 'second' }, 'backend');
  assert.throws(() => applyExport(source, destination), /kinds differ/);
});

test('sync rejects traversal, protected paths, checksums and dangling symlinks', t => {
  const base = sandbox(t), source = path.join(base, 'export'), destination = path.join(base, 'target');
  target(destination);
  for (const file of ['../escape', '.github/workflows/evil.yml', '.env.production']) {
    incoming(source, { 'app.ts': 'ok' });
    const manifest = JSON.parse(readFileSync(path.join(source, MANIFEST)));
    manifest.files[file] = digest('bad');
    put(source, MANIFEST, json(manifest));
    assert.throws(() => applyExport(source, destination), /Unsafe|Protected/);
  }
  incoming(source, { 'app.ts': 'ok' });
  put(source, 'app.ts', 'tampered');
  assert.throws(() => applyExport(source, destination), /checksum/);
  incoming(source, { 'app.ts': 'ok' });
  symlinkSync(path.join(base, 'absent-outside'), path.join(destination, 'app.ts'));
  assert.throws(() => applyExport(source, destination), /Symlink/);
});

test('sync rejects a dangling ownership-manifest symlink before copying files', t => {
  const base = sandbox(t), source = path.join(base, 'export'), destination = path.join(base, 'target');
  target(destination); incoming(source, { 'new.ts': 'new' });
  symlinkSync(path.join(base, 'absent-manifest'), path.join(destination, MANIFEST));
  assert.throws(() => applyExport(source, destination), /Symlink/);
  assert.ok(!existsSync(path.join(destination, 'new.ts')));
});
