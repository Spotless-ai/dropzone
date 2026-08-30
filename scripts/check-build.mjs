import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
assert(html.includes("connect-src 'none'"), 'Production must forbid fetch/XHR/WebSocket connections.');
assert(!html.includes("'unsafe-inline'") && !html.includes("'unsafe-eval'"), 'Production CSP must not permit inline/eval scripts or styles.');
assert(!html.includes('noindex'), 'The approved public release should be indexable.');
assert(html.includes('https://spotless-ai.github.io/dropzone/'), 'Keep the canonical public URL in release metadata.');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
for (const reference of references.filter(value => value.startsWith('./assets/'))) assert(existsSync(resolve(root, 'dist', reference)), `Missing build asset ${reference}`);
assert(!references.some(value => value.startsWith('/assets/')), 'Asset paths must support a GitHub Pages subdirectory.');
for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
  // A canonical URL is metadata, not a fetched script/style/font resource.
  if (/^<link\b/i.test(tag) && /\brel="canonical"/i.test(tag) && /\bhref="https:\/\/spotless-ai\.github\.io\/dropzone\/"/.test(tag)) continue;
  assert(!/\b(?:src|href)="https?:/i.test(tag), 'Do not load runtime scripts, styles or fonts from third-party hosts.');
}
const assets = readdirSync(resolve(root, 'dist/assets'));
assert(assets.some(name => /^worker-.*\.js$/.test(name)), 'The processing worker must be a local build asset.');
assert(existsSync(resolve(root, 'dist/LICENSE.txt')), 'Include the project license.');
const notices = readFileSync(resolve(root, 'dist/third-party-licenses.txt'), 'utf8');
for (const name of ['fflate', 'pdf-lib', 'standard-fonts', 'upng', 'pako', 'tslib', 'Jean-loup Gailly', 'Microsoft Corporation']) assert(notices.includes(name), `Missing license notice: ${name}`);
console.log('Static build checks passed: relative assets, local worker, restrictive production CSP and license notices.');
