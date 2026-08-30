import { describe, expect, it, vi } from "vitest";
import { fitToTarget, TARGET_SEARCH, type TargetRequest } from "./target-size";
import { targetBytesFromKB, validateImageOptions } from "./policy";

const request: TargetRequest = { width: 1600, height: 1000, format: "image/jpeg", targetBytes: 50_000 };
const blob = (size: number, type = "image/jpeg") => new Blob([new Uint8Array(size)], { type });

describe("target input validation", () => {
  it.each(["", "   "])("treats %j as no target", value => expect(targetBytesFromKB(value)).toBeUndefined());
  it.each([["1", 1000], ["500", 500_000], [" 100000 ", 100_000_000]] as const)("converts %s decimal KB to bytes", (value, expected) => expect(targetBytesFromKB(value)).toBe(expected));
  it.each(["0", "-1", "0.5", "1.5", "100001", "NaN", "Infinity", "500 KB"])("rejects invalid target %s", value => expect(() => targetBytesFromKB(value)).toThrow("whole number"));
  it.each([0, 999, -1, NaN, Infinity, 1000.5, 100_000_001])("rejects invalid byte ceiling %s", targetBytes => expect(() => validateImageOptions({ format: "image/jpeg", quality: .85, targetBytes })).toThrow("Target size"));
  it("rejects non-boolean resize consent", () => expect(() => validateImageOptions({ format: "image/jpeg", quality: .85, allowResize: "yes" as unknown as boolean })).toThrow("smaller dimensions"));
});

describe("bounded target-size search with measured encodes", () => {
  it("keeps dimensions and high quality when already within the limit", async () => {
    const encode = vi.fn(async () => blob(40_000));
    const result = await fitToTarget(request, encode);
    expect(result).toMatchObject({ width: 1600, height: 1000, quality: .95 });
    expect(result.blob.size).toBe(40_000);
    expect(encode).toHaveBeenCalledExactlyOnceWith(1600, 1000, .95);
  });
  it("accepts the exact byte ceiling without re-encoding", async () => {
    const exact = blob(request.targetBytes);
    const encode = vi.fn(async () => exact);
    expect((await fitToTarget(request, encode)).blob).toBe(exact);
    expect(encode).toHaveBeenCalledOnce();
  });
  it("searches quality and returns an actual measured candidate under the ceiling", async () => {
    const candidates: Blob[] = [];
    const encode = vi.fn(async (_w: number, _h: number, quality = 1) => {
      const result = blob(Math.round(quality * 100_000)); candidates.push(result); return result;
    });
    const attempts: number[] = [];
    const result = await fitToTarget(request, encode, attempt => attempts.push(attempt));
    expect(result.blob.size).toBeLessThanOrEqual(50_000);
    expect(result.blob.size).toBeGreaterThan(49_000);
    expect(candidates).toContain(result.blob);
    expect(encode).toHaveBeenCalledTimes(2 + TARGET_SEARCH.qualitySteps);
    expect(attempts).toEqual(Array.from({ length: encode.mock.calls.length }, (_, i) => i + 1));
    expect(encode.mock.calls.every(([w, h]) => w === 1600 && h === 1000)).toBe(true);
  });
  it("does not resize without explicit permission", async () => {
    const encode = vi.fn(async (_w: number, _h: number, _q?: number) => blob(60_000));
    await expect(fitToTarget(request, encode)).rejects.toThrow("Allow smaller dimensions");
    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls.every(args => args[0] === 1600 && args[1] === 1000)).toBe(true);
  });
  it("resizes only after the quality floor cannot fit and preserves proportions", async () => {
    const encode = vi.fn(async (w: number, h: number, q = 1) => blob(Math.ceil(w * h * q)));
    const result = await fitToTarget({ ...request, allowResize: true }, encode);
    expect(encode.mock.calls.slice(0, 2)).toEqual([[1600, 1000, .95], [1600, 1000, .4]]);
    expect(result.width).toBeLessThan(1600); expect(result.width).toBeGreaterThanOrEqual(256);
    expect(Math.abs(result.height - result.width * 1000 / 1600)).toBeLessThanOrEqual(.5);
    expect(result.blob.size).toBeLessThanOrEqual(request.targetBytes);
  });
  it("does not attempt quality compression for PNG", async () => {
    const encode = vi.fn(async (_w: number, _h: number, _q?: number) => blob(60_000, "image/png"));
    await expect(fitToTarget({ ...request, format: "image/png" }, encode)).rejects.toThrow("PNG cannot reduce quality");
    expect(encode).toHaveBeenCalledExactlyOnceWith(1600, 1000, undefined);
  });
  it("can resize PNG when allowed, without a quality argument", async () => {
    const encode = vi.fn(async (w: number, h: number, _q?: number) => blob(Math.ceil(w * h / 10), "image/png"));
    const result = await fitToTarget({ ...request, format: "image/png", allowResize: true }, encode);
    expect(result.blob.size).toBeLessThanOrEqual(request.targetBytes);
    expect(result.width).toBeLessThan(request.width);
    expect(result.quality).toBeUndefined();
    expect(encode.mock.calls.every(([, , q]) => q === undefined)).toBe(true);
  });
  it("uses the same quality search for WebP", async () => {
    const result = await fitToTarget({ ...request, format: "image/webp" }, async (_w, _h, q = 1) => blob(Math.round(q * 100_000), "image/webp"));
    expect(result.blob.type).toBe("image/webp"); expect(result.blob.size).toBeLessThanOrEqual(request.targetBytes);
  });
  it("bounds attempts and never passes the automatic minimum edge", async () => {
    const encode = vi.fn(async (_w: number, _h: number, _q?: number) => blob(50_001));
    await expect(fitToTarget({ ...request, width: 12000, height: 1, allowResize: true }, encode)).rejects.toThrow("No over-limit file was returned");
    expect(encode).toHaveBeenCalledTimes(TARGET_SEARCH.dimensionPasses * 2);
    expect(encode.mock.calls.at(-1)?.slice(0, 2)).toEqual([256, 1]);
    expect(encode.mock.calls.every(([w, h]) => w >= 256 && w <= 12000 && h === 1)).toBe(true);
  });
  it("does not enlarge or automatically shrink an image already smaller than the floor", async () => {
    const encode = vi.fn(async (_w: number, _h: number, _q?: number) => blob(50_001));
    await expect(fitToTarget({ ...request, width: 100, height: 50, allowResize: true }, encode)).rejects.toThrow("starting size if smaller");
    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls.every(([w, h]) => w === 100 && h === 50)).toBe(true);
  });
  it("returns a safe candidate even if encoded sizes are nonmonotonic", async () => {
    let count = 0;
    const result = await fitToTarget(request, async () => blob([80_000, 40_000, 60_000, 45_000, 70_000, 49_000, 55_000, 65_000][count++]));
    expect(result.blob.size).toBe(49_000);
  });
  it("rejects an empty encoded image", async () => await expect(fitToTarget(request, async () => blob(0))).rejects.toThrow("empty file"));
  it("rejects silent format substitution", async () => await expect(fitToTarget(request, async () => blob(10_000, "image/png"))).rejects.toThrow("cannot encode"));
  it("propagates encoder errors", async () => await expect(fitToTarget(request, async () => { throw new Error("Codec stopped"); })).rejects.toThrow("Codec stopped"));
  it("validates input before encoding", async () => {
    const encode = vi.fn(async () => blob(1));
    await expect(fitToTarget({ ...request, targetBytes: 0 }, encode)).rejects.toThrow("Target size");
    await expect(fitToTarget({ ...request, width: 0 }, encode)).rejects.toThrow("invalid dimensions");
    expect(encode).not.toHaveBeenCalled();
  });
});
