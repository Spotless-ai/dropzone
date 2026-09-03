import type { MetadataEdits, MetadataReport } from "./metadata-editor";
export const MiB = 1024 * 1024;
export const LIMITS = { files: 100, totalBytes: 100 * MiB, imageBytes: 25 * MiB, pixels: 24_000_000, edge: 12_000, outputBytes: 100 * MiB } as const;
export type Operation = "images" | "metadata" | "zip" | "pdf" | "normalize-pdf";
export type ImageFormat = "image/jpeg" | "image/png" | "image/webp";
export interface InputFile { name: string; size: number }
export interface ImageOptions { format: ImageFormat; quality: number; maxEdge?: number; targetBytes?: number; allowResize?: boolean }
export interface Task { operation: Operation | "metadata-read" | "metadata-edit"; files: File[]; image: ImageOptions; pageSize: "a4" | "letter"; edits?: MetadataEdits }
export interface Output { name: string; bytes: Uint8Array; type: string; detail: string }
export type WorkerReply = { kind: "progress"; done: number; total: number; message?: string } | { kind: "success"; outputs: Output[] } | { kind: "metadata"; reports: MetadataReport[] } | { kind: "error"; message: string };

export function validateSelection(files: InputFile[], operation: Task["operation"]): void {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length > LIMITS.files) throw new Error(`Choose no more than ${LIMITS.files} files at once.`);
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error("A file has an invalid size.");
    // Enforce the 25 MB per-file limit only for image-related operations.
    if ((operation === "images" || operation === "metadata" || operation === "pdf") && file.size > LIMITS.imageBytes) throw new Error(`${file.name}: images must be 25 MB or smaller.`);
    total += file.size;
  }
  if (total > LIMITS.totalBytes) throw new Error("Choose at most 100 MB of files at once.");
}

export function validateImageOptions(options: ImageOptions): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(options.format)) throw new Error("Choose JPEG, PNG or WebP output.");
  if (!Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 1) throw new Error("Quality must be between 10% and 100%.");
  if (options.maxEdge !== undefined && (!Number.isInteger(options.maxEdge) || options.maxEdge < 1 || options.maxEdge > LIMITS.edge)) throw new Error("Longest edge must be a whole number from 1 to 12000 pixels.");
  if (options.targetBytes !== undefined && (!Number.isSafeInteger(options.targetBytes) || options.targetBytes < 1_000 || options.targetBytes > 100_000_000)) throw new Error("Target size must be between 1 and 100,000 KB (1 KB = 1,000 bytes).");
  if (options.allowResize !== undefined && typeof options.allowResize !== "boolean") throw new Error("Choose whether smaller dimensions are allowed.");
}

export function targetBytesFromKB(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const kb = Number(value);
  if (!Number.isInteger(kb) || kb < 1 || kb > 100_000) throw new Error("Target size must be a whole number from 1 to 100,000 KB.");
  return kb * 1_000;
}

export function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("The image has invalid dimensions.");
  if (width > LIMITS.edge || height > LIMITS.edge || width * height > LIMITS.pixels) throw new Error("This image exceeds the 24 megapixel or 12000 pixel edge limit.");
}

export function fitDimensions(width: number, height: number, maxEdge?: number) {
  checkDimensions(width, height);
  const scale = maxEdge === undefined ? 1 : Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function safeName(name: string): string {
  // Export flat, portable names: no paths, control characters or Windows devices.
  let clean = name.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, "_").trim().replace(/[. ]+$/g, "");
  if (!clean || /^\.+$/.test(clean)) clean = "file";
  if (Object.hasOwn(Object.prototype, clean)) clean = `_${clean}`;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean)) clean = `_${clean}`;
  const encoder = new TextEncoder();
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 && encoder.encode(clean.slice(dot)).length <= 20 ? clean.slice(dot) : "";
  const stem = extension ? clean.slice(0, dot) : clean;
  let shortened = "";
  let bytes = encoder.encode(extension).length;
  for (const character of stem) {
    bytes += encoder.encode(character).length;
    if (bytes > 200) break;
    shortened += character;
  }
  return `${shortened.replace(/[. ]+$/g, "") || "file"}${extension}`;
}

export function uniqueName(name: string, used: Set<string>): string {
  const clean = safeName(name);
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  let candidate = clean;
  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++) candidate = `${stem} (${suffix})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function imageOutputName(name: string, format: ImageFormat): string {
  const clean = safeName(name);
  const stem = clean.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[format]}`;
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < MiB) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / MiB).toFixed(1)} MB`;
}
