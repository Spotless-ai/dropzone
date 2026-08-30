import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

// Executes the actual production worker bundle with an in-memory message endpoint.
// This checks bundling and the ZIP message protocol, not browser codecs or downloads.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'dist/assets');
const workerFile = readdirSync(assets).find(name => /^worker-.*\.js$/.test(name));
assert(workerFile, 'Missing production worker.');
let replies = [];
const scope = { postMessage(message) { replies.push(message); }, onmessage: undefined };
runInNewContext(readFileSync(resolve(assets, workerFile), 'utf8'), { self: scope, TextEncoder, TextDecoder, Blob, console, setTimeout, clearTimeout }, { timeout: 10_000 });
assert.equal(typeof scope.onmessage, 'function');
const file = (name, value) => {
  const bytes = new TextEncoder().encode(value);
  return { name, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
};
const task = { operation: 'zip', files: [file('notes.txt', 'first'), file('notes.txt', 'second'), file('__proto__', 'safe')], image: { format: 'image/jpeg', quality: .85 }, pageSize: 'a4' };
await scope.onmessage({ data: task });
const completed = replies.find(reply => reply.kind === 'success');
assert(completed, `Worker did not succeed: ${JSON.stringify(replies)}`);
assert.equal(completed.outputs.length, 1);
assert.equal(completed.outputs[0].type, 'application/zip');
const files = unzipSync(new Uint8Array(completed.outputs[0].bytes));
assert.equal(strFromU8(files['notes.txt']), 'first');
assert.equal(strFromU8(files['notes (2).txt']), 'second');
assert.equal(strFromU8(files['___proto__']), 'safe');
assert(replies.some(reply => reply.kind === 'progress'));
replies = [];
await scope.onmessage({ data: { ...task, files: [] } });
assert.equal(replies.at(-1)?.kind, 'error');
assert.match(replies.at(-1).message, /Choose at least/);
console.log('Production worker smoke checks passed: ZIP data, duplicate/special names, progress and error replies. Browser image codecs remain unverified.');
