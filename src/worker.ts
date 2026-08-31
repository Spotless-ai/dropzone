import { createArchive } from "./archive";
import { convertImage } from "./convert";
import { stripImageMetadata } from "./metadata";
import { readImageMetadata, editImageMetadata } from "./metadata-editor";
import { createImagePdf, type PdfImage } from "./pdf";
import { formatSize, imageOutputName, LIMITS, uniqueName, validateSelection, type ImageOptions, type Output, type Task, type WorkerReply } from "./policy";

const scope = self as unknown as { onmessage: (event: MessageEvent<Task>) => void; postMessage: (message: WorkerReply, transfer?: Transferable[]) => void };
scope.onmessage = async ({ data: task }) => {
  try {
    if (!["images", "metadata", "metadata-read", "metadata-edit", "zip", "pdf"].includes(task.operation)) throw new Error("Choose a supported tool.");
    validateSelection(task.files, task.operation);
    const progress = (done: number, total = task.files.length) => scope.postMessage({ kind: "progress", done, total });
    const outputs: Output[] = [];
    if (task.operation === "metadata-read") {
      const reports = []; let textSize = 0;
      for (const [index,file] of task.files.entries()) {
        try {
          const report = readImageMetadata(new Uint8Array(await file.arrayBuffer()));
          textSize += JSON.stringify(report).length;
          if (textSize > 2_000_000) throw new Error("Too much metadata to display in one batch. Try fewer files.");
          reports.push(report); progress(index+1);
        } catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Unable to read metadata."}`); }
      }
      scope.postMessage({kind:"metadata",reports}); return;
    }
    if (task.operation === "metadata-edit") {
      if (task.files.length !== 1 || !task.edits || !Object.keys(task.edits).length) throw new Error("Choose one inspected image and change at least one supported field.");
      const file = task.files[0];
      try {
        const result = editImageMetadata(new Uint8Array(await file.arrayBuffer()), task.edits);
        outputs.push({name:imageOutputName(file.name,result.report.format).replace(/(\.[^.]+)$/,"-edited$1"),bytes:result.bytes,type:result.report.format,detail:"Metadata edited · no re-encoding · other metadata kept"});
      } catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Unable to edit metadata."}`); }
      scope.postMessage({kind:"success",outputs},outputs.map(output=>output.bytes.buffer as ArrayBuffer)); return;
    }
    if (task.operation === "zip") {
      const inputs = [];
      for (const [index, file] of task.files.entries()) {
        inputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        progress(index + 1, task.files.length + 1);
      }
      const result = createArchive(inputs);
      const renamed = result.names.filter((name, index) => name !== task.files[index].name).length;
      outputs.push({ name: "dropzone-files.zip", bytes: result.bytes, type: "application/zip", detail: `${inputs.length} file${inputs.length === 1 ? "" : "s"}${renamed ? ` · ${renamed} name${renamed === 1 ? "" : "s"} adjusted for compatibility` : ""}` });
    } else {
      const used = new Set<string>();
      const pdfImages: PdfImage[] = [];
      let generatedBytes = 0;
      for (const [index, file] of task.files.entries()) {
        try {
          if (task.operation === "metadata") {
            const result = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
            generatedBytes += result.bytes.length;
            if (generatedBytes > LIMITS.outputBytes) throw new Error("The results exceed the 100 MB output limit. Try fewer files.");
            const kept = [result.orientationKept ? "orientation" : "", result.colorProfileKept ? "color profile" : ""].filter(Boolean);
            const cleanName = imageOutputName(file.name, result.format).replace(/(\.[^.]+)$/, "-clean$1");
            outputs.push({ name: uniqueName(cleanName, used), type: result.format, bytes: result.bytes, detail: `${result.changed ? "Metadata cleaned" : "No metadata changes needed"} · no re-encoding${kept.length ? ` · ${kept.join(" and ")} kept` : ""} · original ${formatSize(file.size)}` });
            progress(index + 1);
            continue;
          }
          const options: ImageOptions = task.operation === "pdf" ? { format: "image/jpeg", quality: 0.92, maxEdge: 2400 } : task.image;
          const result = await convertImage(file, options, options.targetBytes === undefined ? undefined : attempt => scope.postMessage({ kind: "progress", done: index, total: task.files.length, message: `Fitting image ${index + 1} of ${task.files.length} · attempt ${attempt}…` }));
          if (options.targetBytes !== undefined && result.bytes.length > options.targetBytes) throw new Error("The result exceeded the target size. No over-limit file was returned.");
          generatedBytes += result.bytes.length;
          if (generatedBytes > LIMITS.outputBytes) throw new Error("The results exceed the 100 MB output limit. Try fewer files or a smaller image size.");
          if (task.operation === "pdf") pdfImages.push({ bytes: result.bytes, type: "image/jpeg" });
          else {
            const targetDetail = options.targetBytes === undefined ? "" : ` · ${result.bytes.length.toLocaleString("en-US")} / ${options.targetBytes.toLocaleString("en-US")} bytes maximum${result.quality === undefined ? "" : ` · quality ${Math.round(result.quality * 100)}%`}${result.resizedToFit ? " · resized to fit" : ""}`;
            outputs.push({ name: uniqueName(imageOutputName(file.name, options.format), used), bytes: result.bytes, type: options.format, detail: `${result.width} × ${result.height} · original ${formatSize(file.size)}${targetDetail}` });
          }
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
