// Build first. Pass a test-only @napi-rs/canvas module path as argv[2].
// Reopens actual worker outputs with Skia; not a browser/UI compatibility test.
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
assert(workerFile, 'Build first.');
let replies = [];
const scope = { postMessage(reply) { replies.push(reply); } };
// No canvas or bitmap global is provided: metadata cleaning must not need one.
runInNewContext(readFileSync(resolve(assets, workerFile), 'utf8'), { self: scope, TextEncoder, TextDecoder, Blob, console, setTimeout, clearTimeout }, { timeout: 10_000 });
const concat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const secret = Buffer.from('PRIVATE camera serial GPS owner caption thumbnail');
const exif = orientation => {
  const bytes = Buffer.alloc(120);
  bytes.write('II'); bytes.writeUInt16LE(42,2); bytes.writeUInt32LE(8,4); bytes.writeUInt16LE(2,8);
  bytes.writeUInt16LE(0x112,10); bytes.writeUInt16LE(3,12); bytes.writeUInt32LE(1,14); bytes.writeUInt16LE(orientation,18);
  bytes.writeUInt16LE(0x10e,22); bytes.writeUInt16LE(2,24); bytes.writeUInt32LE(secret.length+1,26); bytes.writeUInt32LE(40,30); secret.copy(bytes,40);
  return bytes;
};
const segment = (marker,payload) => {
  const header = Buffer.from([255,marker,0,0]); header.writeUInt16BE(payload.length+2,2); return concat(header,payload);
};
const pngChunk = (tag,payload) => {
  const bytes = Buffer.alloc(payload.length+12); bytes.writeUInt32BE(payload.length); bytes.write(tag,4); payload.copy(bytes,8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4,bytes.length-4)) { crc ^= byte; for (let bit=0; bit<8; bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  bytes.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length-4); return bytes;
};
const riff = (tag,payload) => {
  const bytes = Buffer.alloc(payload.length+8+payload.length%2); bytes.write(tag); bytes.writeUInt32LE(payload.length,4); payload.copy(bytes,8); return bytes;
};
function tagImage(raw,format,orientation) {
  if (format==='jpeg') return concat(raw.subarray(0,2),segment(0xe1,concat(Buffer.from('Exif\0\0'),exif(orientation))),segment(0xfe,secret),raw.subarray(2),secret);
  if (format==='png') return concat(raw.subarray(0,33),pngChunk('eXIf',exif(orientation)),pngChunk('tEXt',concat(Buffer.from('Comment\0'),secret)),raw.subarray(33),secret);
  const chunks=[];
  let flags=0;
  for (let offset=12; offset<raw.length;) {
    const length=raw.readUInt32LE(offset+4), end=offset+8+length+length%2, tag=raw.toString('ascii',offset,offset+4);
    if (tag==='VP8X') flags=raw[offset+8];
    else chunks.push(raw.subarray(offset,end));
    if (tag==='VP8L' && (raw[offset+12]&16)) flags|=16;
    offset=end;
  }
  const header=Buffer.alloc(10); header[0]=flags|12; header.writeUIntLE(95,4,3); header.writeUIntLE(59,7,3);
  const result=concat(Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),riff('VP8X',header),...chunks,riff('EXIF',exif(orientation)),riff('XMP ',secret));
  result.writeUInt32LE(result.length-8,4); return result;
}
async function pixels(bytes) {
  const image=await loadImage(Buffer.from(bytes));
  const canvas=createCanvas(image.width,image.height), ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
  return { width:image.width,height:image.height,data:Buffer.from(ctx.getImageData(0,0,image.width,image.height).data) };
}
const source=createCanvas(96,60), ctx=source.getContext('2d');
ctx.fillStyle='#d42131'; ctx.fillRect(0,0,48,60); ctx.fillStyle='#12a077'; ctx.fillRect(48,0,48,30);
ctx.fillStyle='#163ccc'; ctx.fillRect(48,30,48,30); ctx.clearRect(0,0,8,8);
for (const format of ['jpeg','png','webp']) {
  const raw=Buffer.from(await source.encode(format));
  for (const orientation of [1,2,3,4,5,6,7,8]) {
    const tagged=tagImage(raw,format,orientation), original=Buffer.from(tagged);
    replies=[];
    const input=new File([tagged],`example.${format}`);
    await scope.onmessage({data:{operation:'metadata',files:[input],image:{format:'image/jpeg',quality:.1,targetBytes:1000,maxEdge:1},pageSize:'a4'}});
    const last=replies.at(-1);
    assert.equal(last?.kind,'success',`${format}/${orientation}: ${JSON.stringify(last)}`);
    const output=last.outputs[0];
    assert.equal(output.type,`image/${format}`); assert(!Buffer.from(output.bytes).includes(secret));
    assert.deepEqual(await pixels(output.bytes),await pixels(tagged),`${format}/${orientation}: decoded pixels/orientation changed`);
    assert.deepEqual(Buffer.from(await input.arrayBuffer()),original,'Original was modified');
    assert(output.bytes.length<tagged.length,'Metadata was not removed');
  }
  console.log(`${format}: all 8 orientations reopen with identical decoded pixels; personal tags absent; originals unchanged.`);
}
console.log('Metadata production-worker native-codec checks passed. No canvas/bitmap API used for cleaning.');
