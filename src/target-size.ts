import { checkDimensions, fitDimensions, validateImageOptions, type ImageFormat } from "./policy";

export const TARGET_SEARCH = { minQuality: .4, maxQuality: .95, qualitySteps: 6, dimensionPasses: 8, minEdge: 256 } as const;
export interface TargetRequest { width: number; height: number; format: ImageFormat; targetBytes: number; allowResize?: boolean }
export interface FittedImage { blob: Blob; width: number; height: number; quality?: number }
export type ImageEncoder = (width: number, height: number, quality?: number) => Promise<Blob>;

/** Bounded search. Only measured candidates at or below the byte ceiling succeed. */
export async function fitToTarget(request: TargetRequest, encode: ImageEncoder, onAttempt?: (attempt: number) => void): Promise<FittedImage> {
  const { width, height, format, targetBytes, allowResize = false } = request;
  checkDimensions(width, height);
  validateImageOptions({ format, quality: TARGET_SEARCH.maxQuality, targetBytes, allowResize });
  const lossless = format === "image/png";
  const initialEdge = Math.max(width, height);
  const minimumEdge = Math.min(initialEdge, TARGET_SEARCH.minEdge);
  let edge = initialEdge;
  let attempts = 0;
  const candidate = async (w: number, h: number, quality?: number): Promise<FittedImage> => {
    onAttempt?.(++attempts);
    const blob = await encode(w, h, quality);
    if (blob.type !== format) throw new Error("This browser cannot encode the selected format. Choose JPEG or PNG instead.");
    if (!blob.size) throw new Error("The image encoder returned an empty file.");
    return { blob, width: w, height: h, quality };
  };

  for (let pass = 0; pass < TARGET_SEARCH.dimensionPasses; pass++) {
    const dimensions = fitDimensions(width, height, edge);
    const highest = await candidate(dimensions.width, dimensions.height, lossless ? undefined : TARGET_SEARCH.maxQuality);
    if (highest.blob.size <= targetBytes) return highest;
    let smallest = highest;
    if (!lossless) {
      const lowest = await candidate(dimensions.width, dimensions.height, TARGET_SEARCH.minQuality);
      smallest = lowest.blob.size < highest.blob.size ? lowest : highest;
      if (lowest.blob.size <= targetBytes) {
        let best = lowest;
        let low: number = TARGET_SEARCH.minQuality;
        let high: number = TARGET_SEARCH.maxQuality;
        for (let step = 0; step < TARGET_SEARCH.qualitySteps; step++) {
          const quality = (low + high) / 2;
          const probe = await candidate(dimensions.width, dimensions.height, quality);
          if (probe.blob.size <= targetBytes) { best = probe; low = quality; }
          else high = quality;
        }
        // Return the exact measured Blob; a second encode may produce different bytes.
        return best;
      }
    }
    if (!allowResize || edge === minimumEdge) break;
    // Always resample the original bitmap, keep its aspect ratio, and bound work.
    const scale = Math.min(.85, Math.sqrt(targetBytes / smallest.blob.size) * .9);
    edge = pass === TARGET_SEARCH.dimensionPasses - 2 ? minimumEdge : Math.max(minimumEdge, Math.floor(edge * scale));
  }
  const suggestion = !allowResize
    ? lossless ? "PNG cannot reduce quality. Allow smaller dimensions or choose JPEG/WebP." : "Allow smaller dimensions or increase the target size."
    : "Increase the target size or set a smaller longest edge. Automatic resizing stops at a 256px longest edge, or the starting size if smaller.";
  throw new Error(`Could not meet the ${(targetBytes / 1000).toLocaleString("en-US")} KB target within the quality and resize limits. ${suggestion} No over-limit file was returned.`);
}
