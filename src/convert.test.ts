import { afterEach, describe, expect, it, vi } from "vitest";
import { convertImage } from "./convert";
import { LIMITS } from "./policy";
import { png } from "./test-fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("image conversion control flow (mocked browser APIs, not codec compatibility)", () => {
  function browser(outputType = "image/jpeg", width = 20, height = 10) {
    const close = vi.fn(); const drawImage = vi.fn(); const fillRect = vi.fn(); const context = { drawImage, fillRect, fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "" };
    const convertToBlob = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: outputType }));
    const canvases: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
    vi.stubGlobal("OffscreenCanvas", class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; canvases.push(this); }
      getContext() { return context; }
      convertToBlob = convertToBlob;
    });
    return { close, drawImage, fillRect, context, convertToBlob, canvases };
  }
  const file = () => new File([new Uint8Array(png())], "photo.png", { type: "image/png" });
  it("fills JPEG transparency white and applies resize/quality settings", async () => {
    const fake = browser();
    const result = await convertImage(file(), { format: "image/jpeg", quality: .8, maxEdge: 10 });
    expect(result).toMatchObject({ width: 10, height: 5 }); expect(fake.context.fillStyle).toBe("#ffffff"); expect(fake.fillRect).toHaveBeenCalledWith(0, 0, 10, 5);
    expect(fake.convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: .8 });
    expect(fake.close).toHaveBeenCalledOnce(); expect(fake.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });
  it("does not flatten PNG transparency onto white", async () => { const fake = browser("image/png"); await convertImage(file(), { format: "image/png", quality: 1 }); expect(fake.fillRect).not.toHaveBeenCalled(); });
  it("rejects silent output format fallback and releases the bitmap", async () => { const fake = browser("image/png"); await expect(convertImage(file(), { format: "image/webp", quality: .85 })).rejects.toThrow("cannot encode"); expect(fake.close).toHaveBeenCalledOnce(); });
  it("checks decoded dimensions and releases oversized bitmaps", async () => { const fake = browser("image/png", LIMITS.edge + 1, 1); await expect(convertImage(file(), { format: "image/png", quality: 1 })).rejects.toThrow("edge limit"); expect(fake.close).toHaveBeenCalledOnce(); });
  it("rejects unsupported files before decoding", async () => { browser(); await expect(convertImage(new File(["<svg></svg>"], "fake.png", { type: "image/png" }), { format: "image/png", quality: 1 })).rejects.toThrow("not supported"); expect(createImageBitmap).not.toHaveBeenCalled(); });
  it("reports missing canvas support clearly", async () => { vi.stubGlobal("OffscreenCanvas", undefined); await expect(convertImage(file(), { format: "image/png", quality: 1 })).rejects.toThrow("requires a browser"); });
});
