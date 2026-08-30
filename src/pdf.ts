import { PDFDocument } from "pdf-lib";
import { checkDimensions, LIMITS } from "./policy";

export interface PdfImage { bytes: Uint8Array; type: "image/jpeg" | "image/png" }

export function pageLayout(width: number, height: number, size: "a4" | "letter") {
  checkDimensions(width, height);
  const portrait = size === "a4" ? [595.28, 841.89] : [612, 792];
  const [pageWidth, pageHeight] = width > height ? [portrait[1], portrait[0]] : portrait;
  const scale = Math.min((pageWidth - 48) / width, (pageHeight - 48) / height);
  return { pageWidth, pageHeight, width: width * scale, height: height * scale, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2 };
}

export async function createImagePdf(images: PdfImage[], size: "a4" | "letter", progress?: (done: number) => void): Promise<Uint8Array> {
  if (!images.length || images.length > LIMITS.files) throw new Error("Choose between 1 and 100 images for the PDF.");
  if (size !== "a4" && size !== "letter") throw new Error("Choose A4 or US Letter pages.");
  if (images.reduce((total, image) => total + image.bytes.length, 0) > LIMITS.outputBytes) throw new Error("The PDF images exceed the 100 MB limit. Try fewer images.");
  const document = await PDFDocument.create();
  document.setProducer("DropZone / pdf-lib");
  document.setCreator("DropZone");
  document.setTitle("Images");
  for (const [index, input] of images.entries()) {
    const image = input.type === "image/png" ? await document.embedPng(input.bytes) : await document.embedJpg(input.bytes);
    const layout = pageLayout(image.width, image.height, size);
    const page = document.addPage([layout.pageWidth, layout.pageHeight]);
    page.drawImage(image, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
    progress?.(index + 1);
  }
  const bytes = await document.save();
  if (bytes.length > LIMITS.outputBytes) throw new Error("The PDF exceeds the 100 MB output limit. Try fewer images.");
  return bytes;
}
