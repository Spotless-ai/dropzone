import { createArchive } from "./archive";
import { convertImage } from "./convert";
import { createImagePdf, type PdfImage } from "./pdf";
import { formatSize, imageOutputName, LIMITS, uniqueName, validateSelection, type Output, type Task, type WorkerReply } from "./policy";

const scope = self as unknown as { onmessage: (event: MessageEvent<Task>) => void; postMessage: (message: WorkerReply, transfer?: Transferable[]) => void };
scope.onmessage = async ({ data: task }) => {
  try {
    if (!["images", "zip", "pdf"].includes(task.operation)) throw new Error("Choose a supported tool.");
    validateSelection(task.files, task.operation);
    const progress = (done: number, total = task.files.length) => scope.postMessage({ kind: "progress", done, total });
    const outputs: Output[] = [];
    if (task.operation === "zip") {
      const inputs = [];
      for (const [index, file] of task.files.entries()) {
        inputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        progress(index + 1, task.files.length + 1);
      }
      const result = createArchive(inputs);
      const renamed = result.names.filter((name, index) => name !== task.files[index].name).length;
      outputs.push({ name: "dropzone-files.zip", bytes: result.bytes, type: "application/zip", detail: `${inputs.length} files${renamed ? ` · ${renamed} names adjusted for compatibility` : ""}` });
    } else {
      const used = new Set<string>();
      const pdfImages: PdfImage[] = [];
      let generatedBytes = 0;
      for (const [index, file] of task.files.entries()) {
        try {
          const options = task.operation === "pdf" ? { format: "image/jpeg" as const, quality: 0.92, maxEdge: 2400 } : task.image;
          const result = await convertImage(file, options);
          generatedBytes += result.bytes.length;
          if (generatedBytes > LIMITS.outputBytes) throw new Error("The results exceed the 100 MB output limit. Try fewer files or a smaller image size.");
          if (task.operation === "pdf") pdfImages.push({ bytes: result.bytes, type: "image/jpeg" });
          else outputs.push({ name: uniqueName(imageOutputName(file.name, options.format), used), bytes: result.bytes, type: options.format, detail: `${result.width} × ${result.height} · original ${formatSize(file.size)}` });
          progress(index + 1, task.operation === "pdf" ? task.files.length * 2 + 1 : task.files.length);
        } catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Unable to process this image."}`); }
      }
      if (task.operation === "pdf") {
        const bytes = await createImagePdf(pdfImages, task.pageSize, done => progress(task.files.length + done, task.files.length * 2 + 1));
        outputs.push({ name: "dropzone-images.pdf", bytes, type: "application/pdf", detail: `${task.files.length} pages · ${task.pageSize === "a4" ? "A4" : "US Letter"} · images fitted to page` });
      }
    }
    scope.postMessage({ kind: "success", outputs }, outputs.map(output => output.bytes.buffer as ArrayBuffer));
  } catch (error) {
    scope.postMessage({ kind: "error", message: error instanceof Error ? error.message : "The files could not be processed. Try a smaller batch." });
  }
};
