import { describe, expect, it } from "vitest";
import { checkDimensions, fitDimensions, formatSize, imageOutputName, LIMITS, MiB, safeName, uniqueName, validateImageOptions, validateSelection } from "./policy";

describe("input and image limits", () => {
  it("requires a selection", () => expect(() => validateSelection([], "zip")).toThrow("Choose at least"));
  it("allows empty files inside ZIPs", () => expect(() => validateSelection([{ name: "empty", size: 0 }], "zip")).not.toThrow());
  it("limits file count", () => expect(() => validateSelection(Array.from({ length: 101 }, () => ({ name: "a", size: 0 })), "zip")).toThrow("100 files"));
  it("limits total input bytes", () => expect(() => validateSelection([{ name: "a", size: LIMITS.totalBytes + 1 }], "zip")).toThrow("100 MB"));
  it("limits individual images", () => expect(() => validateSelection([{ name: "a.png", size: 26 * MiB }], "images")).toThrow("25 MB"));
  it("applies the same image limit to PDFs", () => expect(() => validateSelection([{ name: "a.png", size: 26 * MiB }], "pdf")).toThrow("25 MB"));
  it.each([-1, NaN, Infinity, 0.5])("rejects invalid file size %s", size => expect(() => validateSelection([{ name: "a", size }], "zip")).toThrow("invalid size"));
  it("checks pixel count before drawing", () => expect(() => checkDimensions(6000, 5000)).toThrow("24 megapixel"));
  it("checks very long edges", () => expect(() => checkDimensions(12001, 1)).toThrow("edge limit"));
  it.each([[0, 1], [1, -1], [NaN, 1], [1.5, 1]])("rejects invalid dimensions %s by %s", (w, h) => expect(() => checkDimensions(w, h)).toThrow("invalid dimensions"));
  it("keeps original dimensions without a target", () => expect(fitDimensions(3000, 2000)).toEqual({ width: 3000, height: 2000 }));
  it("fits the longest edge without changing aspect ratio", () => expect(fitDimensions(3000, 2000, 1500)).toEqual({ width: 1500, height: 1000 }));
  it("does not upscale", () => expect(fitDimensions(100, 50, 1000)).toEqual({ width: 100, height: 50 }));
  it("keeps narrow outputs at least one pixel", () => expect(fitDimensions(12000, 1, 1)).toEqual({ width: 1, height: 1 }));
  it.each([0, -1, NaN, Infinity, 2.5, 12001])("rejects invalid edge %s", maxEdge => expect(() => validateImageOptions({ format: "image/jpeg", quality: .85, maxEdge })).toThrow("Longest edge"));
  it.each([NaN, 0, 1.1])("rejects invalid quality %s", quality => expect(() => validateImageOptions({ format: "image/png", quality })).toThrow("Quality"));
});

describe("portable output names", () => {
  it.each(["../secret.txt", "C:\\secret.txt", "/absolute", "line\nfeed", "bad:name", "bad\u202ename"])("flattens unsafe path %s", name => expect(safeName(name)).not.toMatch(/[\x00-\x1f/\\:\u202e]/));
  it.each(["CON", "con.txt", "NUL", "COM1.csv", "LPT0.txt"])("escapes device name %s", name => expect(safeName(name)).toMatch(/^_/));
  it("removes trailing dots/spaces and handles empty names", () => { expect(safeName("test. ")).toBe("test"); expect(safeName("...")).toBe("file"); });
  it("preserves Unicode without splitting characters or exceeding filesystem byte limits", () => expect(safeName("🧰".repeat(121))).toBe("🧰".repeat(50)));
  it("preserves extensions when shortening long names", () => { const name = safeName("🧰".repeat(121) + ".png"); expect(name.endsWith(".png")).toBe(true); expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200); });
  it("escapes object-prototype names used by ZIP internals", () => expect(safeName("__proto__")).toBe("___proto__"));
  it("retains every duplicate including case variants", () => { const used = new Set<string>(); expect(["Photo.JPG", "photo.jpg", "photo (2).jpg"].map(name => uniqueName(name, used))).toEqual(["Photo.JPG", "photo (2).jpg", "photo (2) (2).jpg"]); });
  it("replaces image extensions", () => expect(imageOutputName("photo.jpeg", "image/webp")).toBe("photo.webp"));
  it("formats bytes without pretending they are network uploads", () => { expect(formatSize(0)).toBe("0 B"); expect(formatSize(MiB)).toBe("1.0 MB"); });
});
