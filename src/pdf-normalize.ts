import { PDFDocument } from "pdf-lib";

// Attempt to load and re-save a PDF to produce a normalized, clean serialization.
// If loading fails, try to locate an embedded PDF slice by scanning for %PDF and %%EOF markers.
export async function normalizePdf(bytes: Uint8Array): Promise<{ bytes: Uint8Array; repaired: boolean }> {
  try {
    const doc = await PDFDocument.load(bytes);
    const out = await doc.save();
    return { bytes: new Uint8Array(out), repaired: true };
  } catch (firstError) {
    // Try to locate a PDF header/footer inside the blob and re-run.
    try {
      const decoder = new TextDecoder("latin1");
      const text = decoder.decode(bytes);
      const start = text.indexOf("%PDF-");
      const end = text.lastIndexOf("%%EOF");
      if (start >= 0 && end >= 0 && end > start) {
        const slice = bytes.slice(start, end + 5);
        const doc = await PDFDocument.load(slice);
        const out = await doc.save();
        return { bytes: new Uint8Array(out), repaired: true };
      }
    } catch (e) {
      // fall through to final error below
    }
    throw new Error("Unable to parse or normalize this PDF.");
  }
}
