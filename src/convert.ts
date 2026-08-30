import { inspectImage } from "./image-info";
import { checkDimensions, fitDimensions, LIMITS, validateImageOptions, type ImageOptions } from "./policy";
import { fitToTarget } from "./target-size";

export async function convertImage(file: File, options: ImageOptions, onAttempt?: (attempt: number) => void): Promise<{ bytes: Uint8Array; width: number; height: number; quality?: number; resizedToFit?: boolean }> {
  validateImageOptions(options);
  if (file.size > LIMITS.imageBytes) throw new Error("Images must be 25 MB or smaller.");
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") throw new Error("Image processing requires a browser with OffscreenCanvas and createImageBitmap support. Try a current Chrome, Edge or Firefox browser.");
  const source = new Uint8Array(await file.arrayBuffer());
  const info = inspectImage(source);
  // Explicit format from the file signature, not the file name or supplied MIME type.
  const bitmap = await createImageBitmap(new Blob([source], { type: info.format }), { imageOrientation: "from-image" });
  let canvas: OffscreenCanvas | undefined;
  try {
    checkDimensions(bitmap.width, bitmap.height);
    const initial = fitDimensions(bitmap.width, bitmap.height, options.maxEdge);
    const encode = async (width: number, height: number, quality?: number) => {
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        if (!canvas) canvas = new OffscreenCanvas(width, height);
        else { canvas.width = width; canvas.height = height; }
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The browser could not create an image canvas.");
        if (options.format === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, 0, 0, width, height);
      }
      return canvas.convertToBlob({ type: options.format, quality });
    };
    if (options.targetBytes !== undefined) {
      const result = await fitToTarget({ ...initial, format: options.format, targetBytes: options.targetBytes, allowResize: options.allowResize }, encode, onAttempt);
      return { bytes: new Uint8Array(await result.blob.arrayBuffer()), width: result.width, height: result.height, quality: result.quality, resizedToFit: result.width !== initial.width || result.height !== initial.height };
    }
    const output = await encode(initial.width, initial.height, options.quality);
    if (output.type !== options.format) throw new Error("This browser cannot encode the selected format. Choose JPEG or PNG instead.");
    if (output.size > LIMITS.outputBytes) throw new Error("The converted image exceeds the 100 MB output limit.");
    return { bytes: new Uint8Array(await output.arrayBuffer()), ...initial };
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
