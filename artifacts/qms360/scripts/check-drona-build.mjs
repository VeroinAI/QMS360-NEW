import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const output = fileURLToPath(new URL('../dist/public/', import.meta.url));
const html = await readFile(path.join(output, 'index.html'), 'utf8');
const js = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
const css = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
assert.ok(js?.startsWith('./assets/'), 'Entry JavaScript must be relative');
assert.ok(css?.startsWith('./assets/'), 'Stylesheet must be relative');
assert.ok(!html.includes('rel="manifest"'), 'Container must not install the root PWA');
await access(path.join(output, css));
const bundle = await readFile(path.join(output, js), 'utf8');
assert.ok(!bundle.includes('/qms360/1.0.5/'), 'No fixed release mount path');
assert.ok(!bundle.includes('/sw.js'), 'Container must not register the root worker');
const sdk = bundle.match(/new URL\("([^"]*dronahq[^"]+\.js)",import\.meta\.url\)/)?.[1];
assert.ok(sdk && !sdk.startsWith('/'), 'SDK must resolve relative to its module');
await access(path.resolve(output, path.dirname(js), sdk));

for (const entry of [
  'https://example.invalid/mobile/apps/qms/index.html',
  'https://example.invalid/releases/next/',
  'https://example.invalid/qms360/1.0.6/index.html?container=ios#/audit/plans',
]) {
  const moduleUrl = new URL(js, entry);
  const sdkUrl = new URL(sdk, moduleUrl);
  const cssUrl = new URL(css, entry);
  const directory = new URL('.', entry).pathname;
  assert.equal(moduleUrl.pathname, `${directory}${js.slice(2)}`);
  assert.equal(cssUrl.pathname, `${directory}${css.slice(2)}`);
  assert.equal(sdkUrl.pathname, `${directory}assets/${sdk}`);
  const navigated = new URL(entry);
  navigated.hash = '/qaqc/daily/new';
  assert.equal(new URL(js, navigated).href, moduleUrl.href);
}
console.log('Drona build checks passed: relative JS/CSS/SDK, portable mounts, hash navigation, no root PWA.');
