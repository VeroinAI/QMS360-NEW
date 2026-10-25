import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve(import.meta.dirname, '../..');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [file] : [];
  });
}
describe('app-wide selection coverage', () => {
  it('keeps native form bridges and direct Radix Select imports inside shared adapters', () => {
    const adapters = ['components/ui/select.tsx', 'components/ui/native-selection.tsx'];
    const missed = files(source).flatMap(file => {
      const name = path.relative(source, file);
      if (adapters.includes(name)) return [];
      const code = readFileSync(file, 'utf8');
      return /<select[\s>]|from ['"]@radix-ui\/react-select['"]/.test(code) ? [name] : [];
    });
    expect(missed).toEqual([]);
  });
  it('keeps the former native field locations on the searchable adapter', () => {
    for (const file of [
      'components/layout/app-shell.tsx', 'pages/cockpit/index.tsx',
      'pages/cockpit/email-rules-tab.tsx', 'pages/cockpit/email-rule-template-editor.tsx',
      'pages/qaqc/reporting/approved-revisions.tsx', 'pages/qaqc/reporting/metrics-entry-form.tsx',
      'pages/qaqc/reporting/additional-metrics-tiles.tsx',
    ]) expect(readFileSync(path.join(source, file), 'utf8')).toContain('<NativeSelection');
  });
});
