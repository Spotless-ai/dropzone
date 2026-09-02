import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "./metadata";
import { png } from "./test-fixtures";

const ascii = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
function chunk(tag: string, payload: Uint8Array, kind = "png") {
  const bytes = new Uint8Array(payload.length + (kind === "png" ? 12 : 8 + payload.length % 2));
  const view = new DataView(bytes.buffer);
  if (kind === "png") {
    view.setUint32(0, payload.length); bytes.set(ascii(tag), 4); bytes.set(payload, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, bytes.length - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  } else { bytes.set(ascii(tag)); view.setUint32(4, payload.length, true); bytes.set(payload, 8); }
  return bytes;
}
function segment(marker: number, payload: Uint8Array) {
  return join(new Uint8Array([255, marker, (payload.length + 2) >>> 8, (payload.length + 2) & 255]), payload);
}
function exif(orientation = 6, little = true) {
  // IFD0 contains orientation plus a description pointer; next IFD points at a
  // synthetic thumbnail. Both non-orientation fields must disappear entirely.
  const result = new Uint8Array(80);
  const view = new DataView(result.buffer);
  result.set(ascii(little ? "II" : "MM")); view.setUint16(2, 42, little); view.setUint32(4, 8, little);
  view.setUint16(8, 2, little);
  view.setUint16(10, 0x112, little); view.setUint16(12, 3, little); view.setUint32(14, 1, little); view.setUint16(18, orientation, little);
  view.setUint16(22, 0x10e, little); view.setUint16(24, 2, little); view.setUint32(26, 10, little); view.setUint32(30, 40, little);
  view.setUint32(34, 60, little); result.set(ascii("PRIVATE GPS CAMERA THUMBNAIL"), 40);
  return result;
}
const frame = segment(0xc0, new Uint8Array([8,0,2,0,3,1,1,17,0]));
const scan = segment(0xda, new Uint8Array([1,1,0,0,63,0]));
const entropy = new Uint8Array([1,2,255,0,3,255,208,4,255,255,209,5]);
const jpeg = (...metadata: Uint8Array[]) => join(new Uint8Array([255,216]), ...metadata, frame, scan, entropy, new Uint8Array([255,217]));
const webpFrame = chunk("VP8L", new Uint8Array([47,2,64,0,0,10,20]), "webp");
const extended = (flags = 0) => chunk("VP8X", new Uint8Array([flags,0,0,0,2,0,0,1,0,0]), "webp");
function webp(...chunks: Uint8Array[]) {
  const result = join(ascii("RIFF"), new Uint8Array(4), ascii("WEBP"), ...chunks);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
const pngWith = (...chunks: Uint8Array[]) => { const image = png(3, 2); return join(image.subarray(0,33), ...chunks, image.subarray(33)); };

describe("lossless metadata removal", () => {
  it("leaves a metadata-free PNG byte-identical and does not mutate its input", () => {
    const source = png(3,2), before = source.slice(), result = stripImageMetadata(source);
    expect(result.bytes).toEqual(before); expect(source).toEqual(before); expect(result.changed).toBe(false);
  });
  it.each(["tEXt","zTXt","iTXt","tIME","pHYs","caBX","vpAg"])("removes PNG %s, preserving all image chunks exactly", tag => {
    const base = png(3,2), result = stripImageMetadata(pngWith(chunk(tag, ascii("PRIVATE"))));
    expect(result.bytes).toEqual(base); expect(result.changed).toBe(true);
  });
  it.each(["gAMA","cHRM","sRGB","iCCP","sBIT","bKGD","cICP","mDCV","cLLI","tRNS"])("retains PNG display chunk %s unchanged", tag => {
    const original = pngWith(chunk(tag, new Uint8Array([0,1,2,3])));
    expect(stripImageMetadata(original).bytes).toEqual(original);
  });
  it("retains only PNG orientation from EXIF, not camera/location/thumbnail strings", () => {
    const result = stripImageMetadata(pngWith(chunk("eXIf", exif())));
    expect(result.orientationKept).toBe(true);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("PRIVATE");
    expect(stripImageMetadata(result.bytes).bytes).toEqual(result.bytes);
  });
  it("drops bytes after PNG IEND", () => expect(stripImageMetadata(join(png(), ascii("PRIVATE"))).bytes).toEqual(png()));
  it("rejects corrupt PNG CRCs, unknown critical chunks and duplicate IHDR", () => {
    const bad = png(); bad[bad.length - 1] ^= 1;
    expect(() => stripImageMetadata(bad)).toThrow("damaged");
    expect(() => stripImageMetadata(pngWith(chunk("ZZZZ", ascii("x"))))).toThrow("damaged");
    expect(() => stripImageMetadata(pngWith(png().subarray(8,33)))).toThrow("damaged");
  });
  it("rejects PNG IDAT chunks split by another chunk", () => {
    const base = png();
    const bytes = join(base.subarray(0,base.length-12), chunk("tEXt", ascii("x")), chunk("IDAT", new Uint8Array()), base.subarray(base.length-12));
    expect(() => stripImageMetadata(bytes)).toThrow("damaged");
  });
  it("rejects animation", () => {
    expect(() => stripImageMetadata(png(1,1,true))).toThrow("Animated PNG");
    expect(() => stripImageMetadata(webp(extended(2),webpFrame))).toThrow("Animated WebP");
  });
  it("removes JPEG XMP, IPTC, COM, JUMBF and private APP blocks, preserving scan bytes", () => {
    const result = stripImageMetadata(jpeg(...[0xe1,0xed,0xfe,0xeb,0xe5].map(marker => segment(marker, ascii("PRIVATE")))));
    expect(result.bytes).toEqual(jpeg());
  });
  it.each([true,false])("reads %s-endian EXIF and preserves only orientation", little => {
    const result = stripImageMetadata(jpeg(segment(0xe1, join(ascii("Exif\0\0"), exif(6,little)))));
    expect(result.orientationKept).toBe(true);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("PRIVATE");
    expect(stripImageMetadata(result.bytes).bytes).toEqual(result.bytes);
    expect(result.bytes.length).toBeLessThan(jpeg(segment(0xe1, exif())).length);
  });
  it.each([2,3,4,5,6,7,8])("keeps JPEG orientation %s", orientation => {
    const result = stripImageMetadata(jpeg(segment(0xe1, join(ascii("Exif\0\0"), exif(orientation)))));
    expect(result.bytes[30]).toBe(orientation); expect(result.orientationKept).toBe(true);
  });
  it("removes orientation 1 without adding replacement EXIF", () => {
    expect(stripImageMetadata(jpeg(segment(0xe1, join(ascii("Exif\0\0"), exif(1))))).bytes).toEqual(jpeg());
  });
  it("rejects invalid and duplicate EXIF orientation instead of silently rotating images", () => {
    expect(() => stripImageMetadata(jpeg(segment(0xe1, join(ascii("Exif\0\0"), exif(9)))))).toThrow("damaged");
    const app = segment(0xe1, join(ascii("Exif\0\0"), exif()));
    expect(() => stripImageMetadata(jpeg(app,app))).toThrow("damaged");
    expect(() => stripImageMetadata(jpeg(segment(0xe1, ascii("Exif\0\0bad"))))).toThrow("damaged");
  });
  it("keeps JPEG ICC and Adobe color-transform segments", () => {
    const original = jpeg(segment(0xe2, join(ascii("ICC_PROFILE\0"), new Uint8Array([1,1,5,6]))), segment(0xee,join(ascii("Adobe"),new Uint8Array(7))));
    expect(stripImageMetadata(original).bytes).toEqual(original);
    expect(stripImageMetadata(original).colorProfileKept).toBe(true);
  });
  it("removes a JFIF embedded thumbnail but keeps density settings", () => {
    const payload = join(ascii("JFIF\0"),new Uint8Array([1,2,1,0,72,0,72,1,1,10,20,30]));
    const expected = payload.slice(0,14); expected[12]=0; expected[13]=0;
    expect(stripImageMetadata(jpeg(segment(0xe0,payload))).bytes).toEqual(jpeg(segment(0xe0,expected)));
  });
  it("cleans comments between progressive scans and after scans without changing entropy", () => {
    const base = jpeg();
    const tail = join(segment(0xfe,ascii("PRIVATE")),scan,entropy,segment(0xfe,ascii("PRIVATE")),new Uint8Array([255,217]));
    const result = stripImageMetadata(join(base.subarray(0,base.length-2),tail,ascii("PRIVATE")));
    expect(result.bytes).toEqual(join(base.subarray(0,base.length-2),scan,entropy,new Uint8Array([255,217])));
  });
  it("keeps the primary SDR JPEG while removing MPF auxiliary pictures and JFIF vendor data", () => {
    const jfif = join(ascii("JFIF\0"),new Uint8Array([1,2,1,0,72,0,72,0,0]),ascii("AMPF"));
    const primary = jpeg(segment(0xe0,jfif),segment(0xe2,ascii("MPF\0PRIVATE INDEX")));
    const result = stripImageMetadata(join(primary,jpeg(segment(0xe1,ascii("PRIVATE AUXILIARY")))));
    const cleanJfif = join(ascii("JFIF\0"),new Uint8Array([1,2,1,0,72,0,72,0,0]));
    expect(result.bytes).toEqual(jpeg(segment(0xe0,cleanJfif)));
    expect(result.auxiliaryImagesRemoved).toBe(true);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("PRIVATE");
  });
  it("rejects JPEGs without completed scan data", () => {
    expect(() => stripImageMetadata(jpeg().subarray(0,jpeg().length-2))).toThrow("damaged");
    expect(() => stripImageMetadata(join(new Uint8Array([255,216]),frame,new Uint8Array([255,217])))).toThrow("damaged");
  });
  it("removes WebP XMP/EXIF/private chunks and corrects size and feature flags", () => {
    const result = stripImageMetadata(webp(extended(12),webpFrame,chunk("EXIF",exif(1),"webp"),chunk("XMP ",ascii("PRIVATE"),"webp"),chunk("priv",ascii("PRIVATE"),"webp")));
    expect(result.bytes).toEqual(webp(extended(0),webpFrame));
    expect(new DataView(result.bytes.buffer).getUint32(4,true)).toBe(result.bytes.length-8);
  });
  it("preserves WebP orientation while dropping other EXIF", () => {
    const source = webp(extended(8),webpFrame,chunk("EXIF",exif(),"webp"));
    const result = stripImageMetadata(source);
    expect(result.orientationKept).toBe(true); expect(result.bytes[20]).toBe(8);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("PRIVATE");
    expect(stripImageMetadata(result.bytes).bytes).toEqual(result.bytes);
  });
  it("keeps WebP ICC and alpha payloads byte-identical", () => {
    const vp8 = chunk("VP8 ",new Uint8Array([0,0,0,157,1,42,3,0,2,0,1]),"webp");
    const source = webp(extended(48),chunk("ICCP",ascii("test profile"),"webp"),chunk("ALPH",new Uint8Array([1,2,3]),"webp"),vp8);
    const result = stripImageMetadata(source);
    expect(result.bytes).toEqual(source); expect(result.colorProfileKept).toBe(true);
  });
  it("normalizes WebP padding to zero without touching payload", () => {
    const source = webp(webpFrame); source[source.length-1] = 123;
    expect(stripImageMetadata(source).bytes).toEqual(webp(webpFrame));
  });
  it("rejects duplicate WebP frames, canvas mismatches, invalid order and truncated chunks", () => {
    expect(() => stripImageMetadata(webp(webpFrame,webpFrame))).toThrow("damaged");
    const bad = extended(); bad[12] = 9;
    expect(() => stripImageMetadata(webp(bad,webpFrame))).toThrow("damaged");
    expect(() => stripImageMetadata(webp(extended(8),chunk("EXIF",exif(),"webp"),webpFrame))).toThrow("damaged");
    const incomplete = webp(webpFrame,new Uint8Array([1,2]));
    expect(() => stripImageMetadata(incomplete)).toThrow("damaged");
  });
  it.each([jpeg(),png(),webp(webpFrame)])("never mutates an input or a view of a larger buffer", source => {
    const padded = join(new Uint8Array([1,2]),source,new Uint8Array([3,4]));
    const before = padded.slice(); stripImageMetadata(padded.subarray(2,padded.length-2));
    expect(padded).toEqual(before);
  });
  it("rejects random/truncated bytes without unbounded loops or partial output", () => {
    for (const source of [jpeg(),png(),webp(extended(),webpFrame)]) {
      for (let end=0; end<source.length; end++) expect(() => stripImageMetadata(source.subarray(0,end))).toThrow();
    }
  });
});
