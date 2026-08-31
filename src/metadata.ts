import { inspectImage, type ImageInfo } from "./image-info";
import { LIMITS } from "./policy";

// Container surgery only: encoded image/alpha data is never decoded or re-encoded.
// This is a metadata cleaner, not an anonymity or malicious-file sanitizer.
export interface MetadataResult extends ImageInfo {
  bytes: Uint8Array;
  changed: boolean;
  orientationKept: boolean;
  colorProfileKept: boolean;
}
const invalid = () => new Error("This image has an unsupported or damaged structure. No cleaned file was created.");
const text = (bytes: Uint8Array, start = 0, size = bytes.length) => new TextDecoder("latin1").decode(bytes.subarray(start, start + size));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i]);
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

// Read only IFD0 orientation. Do not carry over EXIF directories, pointers,
// thumbnails, maker notes, GPS, camera IDs or free-text fields.
function orientationOf(input: Uint8Array): number | undefined {
  const bytes = text(input, 0, 6) === "Exif\0\0" ? input.subarray(6) : input;
  const little = text(bytes, 0, 2) === "II";
  const view = viewOf(bytes);
  if (bytes.length < 8 || (!little && text(bytes, 0, 2) !== "MM") || view.getUint16(2, little) !== 42) throw invalid();
  const offset = view.getUint32(4, little);
  if (offset < 8 || offset + 2 > bytes.length) throw invalid();
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 + 4 > bytes.length) throw invalid();
  let orientation: number | undefined;
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    if (orientation !== undefined || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) throw invalid();
    orientation = view.getUint16(entry + 8, little);
    if (orientation < 1 || orientation > 8) throw invalid();
  }
  return orientation;
}

function orientationExif(orientation: number): Uint8Array {
  // Canonical little-endian TIFF, a single SHORT tag, no next IFD.
  return new Uint8Array([73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngChunk(tag: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.length + 12);
  const view = viewOf(result);
  view.setUint32(0, payload.length);
  result.set(new TextEncoder().encode(tag), 4); result.set(payload, 8);
  view.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)));
  return result;
}
export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 65533) throw new Error("The edited JPEG metadata block is too large.");
  const result = new Uint8Array(payload.length + 4);
  result.set([255, marker]); viewOf(result).setUint16(2, payload.length + 2); result.set(payload, 4);
  return result;
}
export function riffChunk(tag: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.length + 8 + payload.length % 2);
  result.set(new TextEncoder().encode(tag)); viewOf(result).setUint32(4, payload.length, true); result.set(payload, 8);
  return result;
}

export function stripImageMetadata(source: Uint8Array): MetadataResult {
  if (source.length > LIMITS.imageBytes) throw new Error("Images must be 25 MB or smaller.");
  const info = inspectImage(source);
  const view = viewOf(source);
  const parts: Uint8Array[] = [];
  let orientation: number | undefined;
  let exifSeen = false;
  let colorProfileKept = false;
  const cleanExif = (payload: Uint8Array) => {
    if (exifSeen) throw invalid();
    exifSeen = true;
    orientation = orientationOf(payload);
    return orientation && orientation !== 1 ? orientationExif(orientation) : undefined;
  };

  if (info.format === "image/jpeg") {
    parts.push(source.subarray(0, 2));
    let offset = 2, scans = 0, frames = 0, ended = false;
    while (offset < source.length) {
      if (source[offset++] !== 255) throw invalid();
      while (source[offset] === 255) offset++;
      const marker = source[offset++];
      if (marker === 0xd9) { parts.push(new Uint8Array([255, 217])); ended = true; break; }
      if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) throw invalid();
      if (marker === 0x01) { parts.push(new Uint8Array([255, marker])); continue; }
      if (offset + 2 > source.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > source.length) throw invalid();
      const payload = source.subarray(offset + 2, offset + length);
      const segment = join([new Uint8Array([255, marker]), source.subarray(offset, offset + length)]);
      offset += length;
      if (marker === 0xe1 && text(payload, 0, 6) === "Exif\0\0") {
        const exif = cleanExif(payload);
        if (exif) parts.push(jpegSegment(marker, join([new Uint8Array([69,120,105,102,0,0]), exif])));
      } else if (marker === 0xe0 && text(payload, 0, 5) === "JFIF\0") {
        if (payload.length < 14 || payload.length !== 14 + 3 * payload[12] * payload[13]) throw invalid();
        const header = payload.slice(0, 14); header[12] = 0; header[13] = 0;
        parts.push(jpegSegment(marker, header)); // Keep density; remove thumbnail pixels.
      } else if (marker === 0xe2 && text(payload, 0, 12) === "ICC_PROFILE\0") {
        if (payload.length < 14 || payload[12] < 1 || payload[12] > payload[13]) throw invalid();
        colorProfileKept = true; parts.push(segment);
      } else if (marker === 0xe2 && text(payload, 0, 4) === "MPF\0") {
        throw new Error("Multi-picture or HDR gain-map JPEGs are not supported by metadata removal. Keep the original.");
      } else if (marker === 0xee && text(payload, 0, 5) === "Adobe") {
        if (payload.length !== 12) throw invalid();
        parts.push(segment); // Color transform, including CMYK/YCCK interpretation.
      } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
        // Drop APP metadata (including XMP, IPTC, JUMBF) and COM segments.
      } else {
        if (![0xc0,0xc1,0xc2,0xc4,0xdb,0xdd,0xda].includes(marker)) throw invalid();
        if ([0xc0,0xc1,0xc2].includes(marker)) { if (++frames !== 1) throw invalid(); }
        parts.push(segment);
      }
      if (marker === 0xda) {
        if (!frames || payload.length < 4) throw invalid();
        scans++;
        const start = offset;
        while (offset < source.length) {
          if (source[offset] !== 255) { offset++; continue; }
          let next = offset + 1;
          while (source[next] === 255) next++;
          const code = source[next];
          if (code === 0 || (code >= 0xd0 && code <= 0xd7)) { offset = next + 1; continue; }
          break;
        }
        if (offset === start) throw invalid();
        parts.push(source.subarray(start, offset));
      }
    }
    if (!ended || !scans || frames !== 1) throw invalid();
  } else if (info.format === "image/png") {
    parts.push(source.subarray(0, 8));
    const keep = new Set(["IHDR","PLTE","IDAT","IEND","tRNS","gAMA","cHRM","sRGB","iCCP","sBIT","bKGD","cICP","mDCV","cLLI"]);
    let offset = 8, idat = false, afterIdat = false, ended = false;
    const seen = new Set<string>();
    while (offset + 12 <= source.length) {
      const length = view.getUint32(offset), end = offset + 12 + length;
      if (end > source.length) throw invalid();
      const tag = text(source, offset + 4, 4);
      if (!/^[A-Za-z]{4}$/.test(tag) || (source[offset + 6] & 32) || view.getUint32(end - 4) !== crc32(source.subarray(offset + 4, end - 4))) throw invalid();
      if (["acTL","fcTL","fdAT"].includes(tag)) throw new Error("Animated PNG is not supported. Choose a still image.");
      if (!keep.has(tag) && !(source[offset + 4] & 32)) throw invalid();
      if (tag === "IHDR" && offset !== 8) throw invalid();
      if (tag === "IDAT") { if (afterIdat) throw invalid(); idat = true; }
      else if (idat) afterIdat = true;
      if (keep.has(tag) && tag !== "IDAT") {
        if (seen.has(tag)) throw invalid();
        seen.add(tag);
      }
      if (["PLTE","tRNS","gAMA","cHRM","sRGB","iCCP","sBIT","bKGD","cICP","mDCV","cLLI"].includes(tag) && idat) throw invalid();
      if (tag === "eXIf") {
        const exif = cleanExif(source.subarray(offset + 8, end - 4));
        if (exif) parts.push(pngChunk(tag, exif));
      } else if (keep.has(tag)) {
        if (tag === "iCCP") colorProfileKept = true;
        parts.push(source.subarray(offset, end));
      }
      offset = end;
      if (tag === "IEND") { if (length !== 0 || !idat) throw invalid(); ended = true; break; }
    }
    if (!ended) throw invalid();
  } else {
    parts.push(source.slice(0, 12));
    let offset = 12, frame = false, alpha = false;
    let extended: Uint8Array | undefined;
    let retainedExif: Uint8Array | undefined;
    const seen = new Set<string>();
    while (offset + 8 <= source.length) {
      const tag = text(source, offset, 4), length = view.getUint32(offset + 4, true);
      const end = offset + 8 + length + length % 2;
      if (end > source.length) throw invalid();
      const payload = source.subarray(offset + 8, offset + 8 + length);
      if (["VP8X","ICCP","ALPH","VP8 ","VP8L","EXIF","XMP "].includes(tag)) {
        if (seen.has(tag)) throw invalid();
        seen.add(tag);
      }
      if (tag === "VP8X") {
        if (offset !== 12 || length !== 10 || (payload[0] & 0xc3) || payload[1] || payload[2] || payload[3]) throw invalid();
        extended = riffChunk(tag, payload); parts.push(extended);
      } else if (tag === "ANIM" || tag === "ANMF") throw new Error("Animated WebP is not supported. Choose a still image.");
      else if (tag === "ICCP") {
        if (!extended || frame || alpha || !length) throw invalid();
        colorProfileKept = true; parts.push(riffChunk(tag, payload));
      } else if (tag === "ALPH") {
        if (!extended || frame || !length) throw invalid();
        alpha = true; parts.push(riffChunk(tag, payload));
      } else if (tag === "VP8 " || tag === "VP8L") {
        if (frame || (tag === "VP8L" && alpha)) throw invalid();
        frame = true;
        if (tag === "VP8L") alpha = Boolean(payload[4] & 16);
        parts.push(riffChunk(tag, payload));
      } else if (tag === "EXIF") {
        if (!extended || !frame) throw invalid();
        retainedExif = cleanExif(payload);
      } else if (tag === "XMP " && (!extended || !frame)) throw invalid();
      offset = end;
    }
    if (offset !== source.length || !frame) throw invalid();
    if (extended) {
      const u24 = (index: number) => extended![index] + extended![index + 1] * 256 + extended![index + 2] * 65536;
      if (u24(12) + 1 !== info.width || u24(15) + 1 !== info.height) throw invalid();
      extended[8] = (colorProfileKept ? 32 : 0) | (alpha ? 16 : 0) | (retainedExif ? 8 : 0);
    }
    if (retainedExif) parts.push(riffChunk("EXIF", retainedExif));
    viewOf(parts[0]).setUint32(4, parts.reduce((sum, part) => sum + part.length, 0) - 8, true);
  }
  const bytes = join(parts);
  return { ...info, bytes, changed: !equal(bytes, source), orientationKept: Boolean(orientation && orientation !== 1), colorProfileKept };
}
