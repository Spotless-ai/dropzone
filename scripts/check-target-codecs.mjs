// Optional integration check using real Skia codecs through a canvas adapter.
// This is NOT a browser/UI compatibility test. No network requests or private files.
// Build first, then: node scripts/check-target-codecs.mjs /path/to/@napi-rs/canvas
// @napi-rs/canvas is a test-only prerequisite; it is not bundled with the app.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(process.argv[2] ?? '@napi-rs/canvas');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'dist/assets');
const workerFile = readdirSync(assets).find(name => /^worker-.*\.js$/.test(name));
assert(workerFile, 'Run npm run build first.');

// Deterministic image with texture, smooth regions and a transparent corner.
const width = 1600, height = 1000;
const source = createCanvas(width, height);
const context = source.getContext('2d');
const pixels = context.createImageData(width, height);
let seed = 1234567;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const i = (y * width + x) * 4;
  const noise = (seed >>> 24) / 3;
  pixels.data[i] = x * 170 / width + noise;
  pixels.data[i + 1] = y * 170 / height + noise;
  pixels.data[i + 2] = 100 + noise;
  pixels.data[i + 3] = x < 100 && y < 100 ? 0 : 255;
}
context.putImageData(pixels, 0, 0);
const originalBytes = await source.encode('png');
const input = new File([originalBytes], 'synthetic.png', { type: 'image/png' });

let replies = [];
let encodes = 0;
let decodes = 0;
let closes = 0;
const scope = { postMessage(reply) { replies.push(reply); }, onmessage: undefined };
class CanvasAdapter {
  constructor(w, h) { this.canvas = createCanvas(w, h); }
  get width() { return this.canvas.width; }
  set width(value) { this.canvas.width = value; }
  get height() { return this.canvas.height; }
  set height(value) { this.canvas.height = value; }
  getContext(kind) { return this.canvas.getContext(kind); }
  async convertToBlob({ type, quality }) {
    encodes++;
    const format = type.split('/')[1];
    const bytes = format === 'png' ? await this.canvas.encode('png') : await this.canvas.encode(format, Math.round(quality * 100));
    return new Blob([bytes], { type });
  }
}
runInNewContext(readFileSync(resolve(assets, workerFile), 'utf8'), {
  self: scope, TextEncoder, TextDecoder, Blob, console, setTimeout, clearTimeout,
  OffscreenCanvas: CanvasAdapter,
  async createImageBitmap(blob) {
    decodes++;
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
    image.close = () => { closes++; };
    return image;
  }
}, { timeout: 10_000 });

async function convert(label, image, expectError, files = [input]) {
  replies = []; encodes = 0; decodes = 0; closes = 0;
  await scope.onmessage({ data: { operation: 'images', files, image: { quality: .85, ...image }, pageSize: 'a4' } });
  const final = replies.at(-1);
  assert.equal(closes, decodes, 'Every decoded image must be released.');
  if (expectError) {
    assert.equal(final?.kind, 'error', `${label}: expected a failure`);
    assert.match(final.message, expectError);
    assert(!replies.some(reply => reply.kind === 'success'));
    console.log(`${label}: correctly rejected; ${encodes} encodes`);
    return;
  }
  assert.equal(final?.kind, 'success', `${label}: ${JSON.stringify(final)}`);
  assert.equal(final.outputs.length, files.length);
  for (const output of final.outputs) {
    assert.equal(output.type, image.format);
    if (image.targetBytes !== undefined) assert(output.bytes.length <= image.targetBytes, `${label}: over budget`);
    const decoded = await loadImage(Buffer.from(output.bytes));
    assert(decoded.width > 0 && decoded.height > 0, 'Encoded result must reopen.');
    assert(decoded.width <= width && decoded.height <= height, 'No upscaling.');
    if (!image.allowResize && !image.maxEdge) assert.equal(decoded.width, width);
    if (image.maxEdge) assert(Math.max(decoded.width, decoded.height) <= image.maxEdge);
    if (image.targetBytes !== undefined) assert(output.detail.includes(`${output.bytes.length.toLocaleString('en-US')} / ${image.targetBytes.toLocaleString('en-US')} bytes maximum`));
    const preview = createCanvas(decoded.width, decoded.height);
    const ctx = preview.getContext('2d'); ctx.drawImage(decoded, 0, 0);
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    if (image.format === 'image/jpeg') assert(corner[0] > 245 && corner[1] > 245 && corner[2] > 245 && corner[3] === 255, 'JPEG background must be white.');
    else assert.equal(corner[3], 0, 'PNG/WebP must retain transparent corner.');
    console.log(`${label}: ${output.bytes.length} bytes, ${decoded.width} × ${decoded.height}; ${encodes} encodes`);
  }
  return final.outputs[0];
}

console.log(`Real-codec worker checks. Synthetic original: ${originalBytes.length} bytes, ${width} × ${height}.`);
for (const format of ['image/jpeg', 'image/webp']) {
  const high = await convert(`${format}: normal conversion`, { format });
  await convert(`${format}: already fits`, { format, targetBytes: 10_000_000 });
  await convert(`${format}: target 600 KB without resizing`, { format, targetBytes: 600_000 });
  await convert(`${format}: target 100 KB`, { format, targetBytes: 100_000, allowResize: true });
  await convert(`${format}: target 20 KB + max edge`, { format, targetBytes: 20_000, allowResize: true, maxEdge: 800 });
  await convert(`${format}: impossible 1 KB, no resize`, { format, targetBytes: 1000 }, /No over-limit file/);
  assert(high.bytes.length > 100_000, 'Fixture should exercise compression.');
}
await convert('PNG: already fits without resizing', { format: 'image/png', targetBytes: 10_000_000 });
await convert('PNG: target 100 KB + resize', { format: 'image/png', targetBytes: 100_000, allowResize: true });
await convert('PNG: target 1 KB + resize floor', { format: 'image/png', targetBytes: 1000, allowResize: true }, /No over-limit file/);
await convert('PNG: target 100 KB, no resize', { format: 'image/png', targetBytes: 100_000 }, /PNG cannot reduce quality/);
await convert('JPEG: independent batch targets', { format: 'image/jpeg', targetBytes: 50_000, allowResize: true }, undefined, [input, input]);
await convert('Invalid target rejected before decoding', { format: 'image/jpeg', targetBytes: -1 }, /Target size/);
assert.equal(decodes, 0);
assert.deepEqual(new Uint8Array(await input.arrayBuffer()), new Uint8Array(originalBytes), 'Source bytes must stay unchanged.');
console.log('Passed: real JPEG/PNG/WebP sizes, dimensions, transparency, limits, batch output and source preservation. UI/browser compatibility not tested by this script.');
