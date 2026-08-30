import { checkDimensions, type ImageFormat } from "./policy";

export interface ImageInfo { format: ImageFormat; width: number; height: number }
const invalid = () => new Error("Use a valid, non-animated JPEG, PNG or WebP image. SVG, GIF, HEIC and RAW are not supported.");

export function inspectImage(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const finish = (format: ImageFormat, width: number, height: number): ImageInfo => {
    checkDimensions(width, height);
    return { format, width, height };
  };
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) {
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== "IHDR") throw invalid();
    let ended = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw invalid();
      const tag = ascii(offset + 4, 4);
      if (tag === "acTL") throw new Error("Animated PNG is not supported. Choose a still image.");
      offset += length + 12;
      if (tag === "IEND") { ended = true; break; }
    }
    if (!ended) throw invalid();
    return finish("image/png", view.getUint32(16), view.getUint32(20));
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) throw invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw invalid();
        return finish("image/jpeg", view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    throw invalid();
  }
  if (bytes.length >= 20 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw invalid();
    let info: ImageInfo | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = ascii(offset, 4);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (length > bytes.length - start) throw invalid();
      if (tag === "ANIM" || tag === "ANMF" || (tag === "VP8X" && (bytes[start] & 2))) throw new Error("Animated WebP is not supported. Choose a still image.");
      if (tag === "VP8 " && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) info = finish("image/webp", view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
      if (tag === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        info = finish("image/webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (tag === "VP8X" && length >= 10) {
        const u24 = (index: number) => bytes[index] + bytes[index + 1] * 256 + bytes[index + 2] * 65536;
        // Check the canvas size even if the embedded bitstream reports less.
        checkDimensions(u24(start + 4) + 1, u24(start + 7) + 1);
      }
      offset = start + length + (length % 2);
    }
    if (info) return info;
  }
  throw invalid();
}
