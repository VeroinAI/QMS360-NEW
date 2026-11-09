import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, MANIFEST } from './export.mjs';

function safePath(root, file) {
  if (!file || file.includes('\\') || path.isAbsolute(file) || file.split('/').some(p => !p || p === '..' || p === '.')) {
    throw new Error(`Unsafe managed path: ${file}`);
  }
  if (file.split('/').some(p => ['.git', '.github'].includes(p)) || /(^|\/)\.env($|\.)/.test(file)) {
    throw new Error(`Protected managed path: ${file}`);
  }
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Symlink in managed path: ${file}`);
  }
  return current;
}

function load(root) {
  const file = safePath(root, MANIFEST);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.version !== 1 || !['frontend', 'backend'].includes(data.kind) || !data.files ||
    typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Invalid export ownership manifest.');
  for (const [name, hash] of Object.entries(data.files)) {
    if (name === MANIFEST || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid managed file entry.');
    safePath(root, name);
  }
  return data;
}

// This function deliberately neither commits nor pushes. It validates the
// complete change before touching files and only stages manifest-owned paths.
export function applyExport(exportDirectory, targetDirectory) {
  const source = path.resolve(exportDirectory);
  const target = path.resolve(targetDirectory);
  if (lstatSync(target).isSymbolicLink()) throw new Error('Target must not be a symlink.');
  const next = load(source);
  const targetManifest = safePath(target, MANIFEST);
  const previous = existsSync(targetManifest) ? load(target) : { files: {} };
  if (previous.kind && previous.kind !== next.kind) throw new Error('Wrong destination: export kinds differ.');
  for (const [file, hash] of Object.entries(previous.files)) {
    const current = safePath(target, file);
    if (!existsSync(current) || !lstatSync(current).isFile() || digest(readFileSync(current)) !== hash) {
      throw new Error(`Customer changed an automation-owned file: ${file}. Reconcile it before syncing.`);
    }
  }
  for (const [file, hash] of Object.entries(next.files)) {
    const incoming = safePath(source, file);
    const current = safePath(target, file);
    if (!lstatSync(incoming).isFile() || digest(readFileSync(incoming)) !== hash) throw new Error(`Export checksum mismatch: ${file}`);
    if (!(file in previous.files) && existsSync(current) &&
      (!lstatSync(current).isFile() || digest(readFileSync(current)) !== hash)) {
      throw new Error(`Refusing to overwrite customer-owned file: ${file}`);
    }
  }
  for (const file of Object.keys(previous.files)) {
    if (!(file in next.files)) unlinkSync(safePath(target, file));
  }
  for (const file of Object.keys(next.files)) {
    const current = safePath(target, file);
    mkdirSync(path.dirname(current), { recursive: true });
    writeFileSync(current, readFileSync(safePath(source, file)));
  }
  writeFileSync(targetManifest, readFileSync(path.join(source, MANIFEST)));
  const changed = [...new Set([...Object.keys(previous.files), ...Object.keys(next.files), MANIFEST])];
  // --literal-pathspecs prevents filenames being treated as Git pathspec syntax.
  execFileSync('git', ['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    cwd: target, input: `${changed.join('\0')}\0`,
  });
  return { kind: next.kind, files: Object.keys(next.files).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node sync.mjs EXPORT_DIRECTORY TARGET_CHECKOUT');
  console.log(applyExport(process.argv[2], process.argv[3]));
}
