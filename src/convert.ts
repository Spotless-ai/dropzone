import { inspectImage } from "./image-info";
import { checkDimensions, fitDimensions, LIMITS, validateImageOptions, type ImageOptions } from "./policy";

export async function convertImage(file: File, options: ImageOptions): Promise<{ bytes: Uint8Array; width: number; height: number }> {
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
    const dimensions = fitDimensions(bitmap.width, bitmap.height, options.maxEdge);
    canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create an image canvas.");
    if (options.format === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, dimensions.width, dimensions.height); }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const output = await canvas.convertToBlob({ type: options.format, quality: options.quality });
    if (output.type !== options.format) throw new Error("This browser cannot encode the selected format. Choose JPEG or PNG instead.");
    if (output.size > LIMITS.outputBytes) throw new Error("The converted image exceeds the 100 MB output limit.");
    return { bytes: new Uint8Array(await output.arrayBuffer()), ...dimensions };
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
