import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { createArchive } from "./archive";
import { inspectImage } from "./image-info";
import { createImagePdf, pageLayout } from "./pdf";
import { png } from "./test-fixtures";

describe("ZIP export", () => {
  it("round-trips names and exact bytes, including zero-length files", () => {
    const input = [{ name: "notes.txt", bytes: new TextEncoder().encode("hello 🌍") }, { name: "empty", bytes: new Uint8Array() }, { name: "binary.bin", bytes: new Uint8Array([0, 255, 12, 34]) }];
    const { bytes, names } = createArchive(input); const output = unzipSync(bytes);
    expect(names).toEqual(input.map(file => file.name));
    for (const file of input) expect(output[file.name]).toEqual(file.bytes);
  });
  it("does not silently overwrite duplicate names", () => {
    const { bytes } = createArchive([{ name: "a.txt", bytes: new TextEncoder().encode("first") }, { name: "a.txt", bytes: new TextEncoder().encode("second") }]);
    const output = unzipSync(bytes); expect(strFromU8(output["a.txt"])).toBe("first"); expect(strFromU8(output["a (2).txt"])).toBe("second");
  });
  it("treats prototype-like file names as files", () => {
    const { bytes } = createArchive(["__proto__", "constructor", "toString"].map(name => ({ name, bytes: new Uint8Array([1]) })));
    expect(Object.keys(unzipSync(bytes))).toEqual(["___proto__", "_constructor", "_toString"]);
  });
  it("cannot create path-traversing archive members", () => {
    const { bytes } = createArchive([{ name: "../../private.txt", bytes: new Uint8Array([9]) }]);
    expect(Object.keys(unzipSync(bytes))[0]).not.toMatch(/[/\\]/);
  });
  it("produces repeatable archives rather than leaking current file times", () => {
    const files = [{ name: "a", bytes: new Uint8Array([1, 2, 3]) }]; expect(createArchive(files).bytes).toEqual(createArchive(files).bytes);
  });
});

describe("image header checks", () => {
  it("reads real generated PNG dimensions", () => expect(inspectImage(png(3, 2))).toEqual({ format: "image/png", width: 3, height: 2 }));
  it("works with nonzero byte offsets", () => { const image = png(); const padded = new Uint8Array(image.length + 4); padded.set(image, 4); expect(inspectImage(padded.subarray(4)).width).toBe(1); });
  it("rejects APNG instead of silently flattening animation", () => expect(() => inspectImage(png(1, 1, true))).toThrow("Animated PNG"));
  it("checks PNG dimensions without decoding large pixel data", () => { const image = png(); new DataView(image.buffer).setUint32(16, 999999); expect(() => inspectImage(image)).toThrow("edge limit"); });
  it("rejects truncated PNG data", () => expect(() => inspectImage(png().subarray(0, 33))).toThrow("valid"));
  it("rejects impossible PNG chunk lengths", () => { const image = png(); new DataView(image.buffer).setUint32(33, 0xffffffff); expect(() => inspectImage(image)).toThrow("valid"); });
  it.each(["<svg xmlns='http://www.w3.org/2000/svg'></svg>", "GIF89a", "not an image", ""])("rejects unsupported data %s", text => expect(() => inspectImage(new TextEncoder().encode(text))).toThrow("not supported"));
  it("reads basic JPEG frame dimensions", () => expect(inspectImage(new Uint8Array([255,216,255,192,0,11,8,0,2,0,3,1,1,17,0,255,217]))).toEqual({ format: "image/jpeg", width: 3, height: 2 }));
  it("rejects corrupt JPEG segment lengths", () => expect(() => inspectImage(new Uint8Array([255,216,255,224,255,255]))).toThrow("valid"));
  it("reads lossless WebP dimensions", () => {
    const bytes = new Uint8Array([82,73,70,70,18,0,0,0,87,69,66,80,86,80,56,76,5,0,0,0,47,2,64,0,0,0]);
    expect(inspectImage(bytes)).toEqual({ format: "image/webp", width: 3, height: 2 });
  });
  it("rejects animated WebP even with a valid embedded still frame", () => {
    const bytes = new Uint8Array([82,73,70,70,14,0,0,0,87,69,66,80,65,78,73,77,2,0,0,0,0,0]);
    expect(() => inspectImage(bytes)).toThrow("Animated WebP");
  });
});

describe("ordered image PDF", () => {
  it("makes a real parseable PDF with page order and orientation intact", async () => {
    const bytes = await createImagePdf([{ type: "image/png", bytes: png(1, 2) }, { type: "image/png", bytes: png(2, 1) }], "a4");
    const output = await PDFDocument.load(bytes);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getWidth()).toBeCloseTo(595.28);
    expect(output.getPage(1).getWidth()).toBeCloseTo(841.89);
    expect(output.getTitle()).toBe("Images");
  });
  it("keeps the drawing inside margins", () => { const layout = pageLayout(4000, 3000, "letter"); expect(layout.x).toBeGreaterThanOrEqual(24); expect(layout.y).toBeGreaterThanOrEqual(24); expect(layout.width + layout.x).toBeLessThanOrEqual(layout.pageWidth - 24); });
  it("uses US Letter dimensions", () => expect(pageLayout(1, 2, "letter")).toMatchObject({ pageWidth: 612, pageHeight: 792 }));
  it("rejects empty PDFs", async () => { await expect(createImagePdf([], "a4")).rejects.toThrow("Choose between"); });
  it("rejects malformed image bytes without generating an empty result", async () => { await expect(createImagePdf([{ type: "image/png", bytes: new Uint8Array([1,2]) }], "a4")).rejects.toBeDefined(); });
});
