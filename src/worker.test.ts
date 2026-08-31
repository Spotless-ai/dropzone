import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertImage } from "./convert";
import { createImagePdf } from "./pdf";
import type { Task, WorkerReply } from "./policy";
import { png } from "./test-fixtures";

vi.mock("./convert", () => ({ convertImage: vi.fn() }));
vi.mock("./pdf", () => ({ createImagePdf: vi.fn() }));
const converted = vi.mocked(convertImage);
const madePdf = vi.mocked(createImagePdf);
let replies: WorkerReply[];
let scope: { onmessage?: (event: { data: Task }) => Promise<void>; postMessage: (reply: WorkerReply) => void };
const task = (): Task => ({ operation: "images", files: [new File(["fixture"], "photo.png")], image: { format: "image/jpeg", quality: .85, targetBytes: 50_000, allowResize: true }, pageSize: "a4" });

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); replies = [];
  scope = { postMessage: reply => replies.push(reply) };
  vi.stubGlobal("self", scope);
  await import("./worker");
});

describe("metadata worker protocol", () => {
  it("returns inspection reports without converting images", async()=>{
    const input=task();input.operation="metadata-read";input.files=[new File([new Uint8Array(png())],"photo.png")];
    await scope.onmessage!({data:input});expect(replies.at(-1)).toMatchObject({kind:"metadata",reports:[{format:"image/png",width:1,height:1}]});expect(converted).not.toHaveBeenCalled();
  });
  it("edits one image and returns a separate named copy",async()=>{
    const input=task();input.operation="metadata-edit";input.files=[new File([new Uint8Array(png())],"photo.png")];input.edits={"png:Author":"Writer"};
    await scope.onmessage!({data:input});expect(replies.at(-1)).toMatchObject({kind:"success",outputs:[{name:"photo-edited.png",type:"image/png"}]});expect(converted).not.toHaveBeenCalled();expect(new Uint8Array(await input.files[0].arrayBuffer())).toEqual(png());
  });
  it("rejects edit requests with multiple files or technical tags",async()=>{
    const input=task();input.operation="metadata-edit";input.files=[new File([new Uint8Array(png())],"photo.png")];input.edits={"exif:274":"8"};
    await scope.onmessage!({data:input});expect(replies.at(-1)).toMatchObject({kind:"error",message:expect.stringContaining("read-only")});
    input.files.push(input.files[0]);await scope.onmessage!({data:input});expect(replies.at(-1)).toMatchObject({kind:"error",message:expect.stringContaining("one inspected image")});
  });
  it("returns same-format clean copies without invoking conversion or PDF codecs", async () => {
    const input = task(); input.operation = "metadata";
    input.files = [new File([new Uint8Array(png())], "picture.png"), new File([new Uint8Array(png())], "picture.png")];
    input.image.targetBytes = -1; input.image.maxEdge = 1;
    await scope.onmessage!({ data: input });
    expect(converted).not.toHaveBeenCalled(); expect(madePdf).not.toHaveBeenCalled();
    expect(replies.filter(reply => reply.kind === "progress")).toHaveLength(2);
    const success = replies.find(reply => reply.kind === "success");
    expect(success?.outputs.map(output => output.name)).toEqual(["picture-clean.png", "picture-clean (2).png"]);
    expect(success?.outputs[0]).toMatchObject({ type: "image/png", bytes: png(), detail: expect.stringContaining("No metadata changes needed · no re-encoding") });
    expect(new Uint8Array(await input.files[0].arrayBuffer())).toEqual(png());
  });
  it("rejects a damaged file with its name and returns no partial batch", async () => {
    const input = task(); input.operation = "metadata";
    input.files = [new File([new Uint8Array(png())], "okay.png"),new File(["broken"],"bad.jpg")];
    await scope.onmessage!({ data: input });
    expect(replies.at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("bad.jpg:") });
    expect(replies.some(reply => reply.kind === "success")).toBe(false);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("image target worker protocol", () => {
  it("passes options, reports fit attempts and returns exact byte/dimension details", async () => {
    converted.mockImplementation(async (_file, _options, onAttempt) => { onAttempt?.(1); return { bytes: new Uint8Array(49_250), width: 600, height: 400, quality: .8, resizedToFit: true }; });
    const input = task(); await scope.onmessage!({ data: input });
    expect(converted).toHaveBeenCalledWith(input.files[0], input.image, expect.any(Function));
    expect(replies[0]).toMatchObject({ kind: "progress", done: 0, total: 1, message: "Fitting image 1 of 1 · attempt 1…" });
    const success = replies.find(reply => reply.kind === "success");
    expect(success?.outputs[0]).toMatchObject({ name: "photo.jpg", type: "image/jpeg" });
    expect(success?.outputs[0].detail).toContain("49,250 / 50,000 bytes maximum");
    expect(success?.outputs[0].detail).toContain("600 × 400");
    expect(success?.outputs[0].detail).toContain("resized to fit");
  });
  it("defensively rejects an over-limit result", async () => {
    converted.mockResolvedValue({ bytes: new Uint8Array(50_001), width: 600, height: 400 });
    await scope.onmessage!({ data: task() });
    expect(replies).toEqual([{ kind: "error", message: expect.stringContaining("No over-limit file was returned") }]);
  });
  it("does not return a partial batch after one image fails", async () => {
    converted.mockResolvedValueOnce({ bytes: new Uint8Array(1000), width: 600, height: 400 }).mockRejectedValueOnce(new Error("Could not meet the target"));
    const input = task(); input.files.push(new File(["fixture"], "second.png"));
    await scope.onmessage!({ data: input });
    expect(replies.some(reply => reply.kind === "success")).toBe(false);
    expect(replies.at(-1)).toEqual({ kind: "error", message: "second.png: Could not meet the target" });
  });
  it("applies the ceiling individually to every image, not to the batch", async () => {
    converted.mockResolvedValue({ bytes: new Uint8Array(40_000), width: 600, height: 400 });
    const input = task(); input.files.push(new File(["fixture"], "photo.png"));
    await scope.onmessage!({ data: input });
    const success = replies.find(reply => reply.kind === "success");
    expect(success?.outputs.map(output => output.name)).toEqual(["photo.jpg", "photo (2).jpg"]);
    expect(success?.outputs.every(output => output.bytes.length === 40_000)).toBe(true);
  });
  it("leaves manual quality conversion unchanged when no target is set", async () => {
    converted.mockResolvedValue({ bytes: new Uint8Array(1000), width: 600, height: 400 });
    const input = task(); delete input.image.targetBytes; await scope.onmessage!({ data: input });
    expect(converted).toHaveBeenCalledWith(input.files[0], input.image, undefined);
    const success = replies.find(reply => reply.kind === "success");
    expect(success?.outputs[0].detail).not.toContain("maximum");
  });
  it("keeps target settings out of PDF processing", async () => {
    converted.mockResolvedValue({ bytes: new Uint8Array(1000), width: 600, height: 400 });
    madePdf.mockResolvedValue(new Uint8Array(1234));
    const input = task(); input.operation = "pdf"; input.image.targetBytes = -1;
    await scope.onmessage!({ data: input });
    expect(converted).toHaveBeenCalledWith(input.files[0], { format: "image/jpeg", quality: .92, maxEdge: 2400 }, undefined);
    expect(replies.at(-1)).toMatchObject({ kind: "success", outputs: [{ name: "dropzone-images.pdf" }] });
  });
});
