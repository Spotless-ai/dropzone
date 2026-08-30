import { zlibSync } from "fflate";

// Tiny deterministic RGBA PNG fixtures generated locally; no external assets.
export function png(width = 1, height = 1, animated = false): Uint8Array {
  const chunk = (tag: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set(new TextEncoder().encode(tag), 4); result.set(data, 8);
    let crc = 0xffffffff;
    for (const value of result.subarray(4, result.length - 4)) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
  };
  const header = new Uint8Array(13); const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const pixels = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([210, 20, 40, 255], y * (width * 4 + 1) + 1 + x * 4);
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...(animated ? [chunk("acTL", new Uint8Array(8))] : []), chunk("IDAT", zlibSync(pixels)), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of chunks) { result.set(part, offset); offset += part.length; }
  return result;
}
