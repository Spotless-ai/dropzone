import "./style.css";
import { formatSize, validateImageOptions, validateSelection, type Operation, type Task, type WorkerReply } from "./policy";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>("tool-form");
const picker = element<HTMLInputElement>("files");
const operation = element<HTMLSelectElement>("operation");
const format = element<HTMLSelectElement>("format");
const quality = element<HTMLInputElement>("quality");
const run = element<HTMLButtonElement>("run");
const cancel = element<HTMLButtonElement>("cancel");
const clear = element<HTMLButtonElement>("clear");
const status = element<HTMLSpanElement>("status");
const error = element<HTMLParagraphElement>("error");
const progress = element<HTMLProgressElement>("progress");
let files: File[] = [];
let worker: Worker | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let urls: string[] = [];

function showError(message: string) { error.textContent = message; error.hidden = false; }
function clearError() { error.textContent = ""; error.hidden = true; }
function revokeResults() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  element("results").replaceChildren();
  element("results-panel").hidden = true;
}
function updateQuality() {
  const lossless = format.value === "image/png";
  quality.disabled = Boolean(worker) || lossless;
  element("quality-value").textContent = lossless ? "Lossless" : `${quality.value}%`;
  element<HTMLFieldSetElement>("image-options").disabled = Boolean(worker) || operation.value !== "images";
  element<HTMLFieldSetElement>("pdf-options").disabled = Boolean(worker) || operation.value !== "pdf";
}
function renderFiles() {
  const list = element<HTMLOListElement>("file-list");
  list.replaceChildren();
  files.forEach((file, index) => {
    const row = document.createElement("li");
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "small";
    size.textContent = formatSize(file.size);
    info.append(name, size);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const button = (label: string, title: string, disabled: boolean, click: () => void) => {
      const control = document.createElement("button");
      control.type = "button"; control.textContent = label; control.setAttribute("aria-label", `${title}: ${file.name}`); control.disabled = Boolean(worker) || disabled;
      control.addEventListener("click", click); actions.append(control);
    };
    if (operation.value === "pdf") {
      button("Move up", "Move up", index === 0, () => { [files[index - 1], files[index]] = [files[index], files[index - 1]]; renderFiles(); focusRow(index - 1); });
      button("Move down", "Move down", index === files.length - 1, () => { [files[index + 1], files[index]] = [files[index], files[index + 1]]; renderFiles(); focusRow(index + 1); });
    }
    button("Remove", "Remove file", false, () => { files.splice(index, 1); renderFiles(); focusRow(Math.min(index, files.length - 1)); });
    row.append(info, actions); list.append(row);
  });
  element("empty-list").hidden = files.length > 0;
  element("file-count").textContent = `(${files.length} · ${formatSize(files.reduce((sum, file) => sum + file.size, 0))})`;
  run.disabled = Boolean(worker) || files.length === 0;
  clear.disabled = Boolean(worker) || files.length === 0;
}
function focusRow(index: number) {
  const row = element("file-list").children[index];
  const control = row?.querySelector<HTMLButtonElement>("button:not(:disabled)");
  (control ?? picker).focus();
}
function setBusy(busy: boolean) {
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) control.disabled = busy;
  cancel.disabled = false; cancel.hidden = !busy;
  progress.hidden = !busy;
  form.setAttribute("aria-busy", String(busy));
  updateQuality(); renderFiles();
}
function stopWorker() {
  worker?.terminate(); worker = undefined;
  if (deadline !== undefined) clearTimeout(deadline);
  deadline = undefined;
  setBusy(false);
}
function addFiles(incoming: File[]) {
  if (worker) return;
  const combined = [...files, ...incoming];
  try { validateSelection(combined, operation.value as Operation); }
  catch (problem) { showError((problem as Error).message); return; }
  files = combined; clearError(); renderFiles();
  status.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected.`;
}
picker.addEventListener("change", () => { addFiles(Array.from(picker.files ?? [])); picker.value = ""; });
clear.addEventListener("click", () => { files = []; revokeResults(); clearError(); renderFiles(); status.textContent = "Choose files to begin."; });
const drop = element("drop-area");
// Prevent accidental navigation when a file is dropped outside the target.
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
document.addEventListener("drop", event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
drop.addEventListener("dragover", event => { event.preventDefault(); if (!worker) drop.classList.add("dragging"); });
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", event => {
  event.preventDefault(); drop.classList.remove("dragging");
  if (event.dataTransfer) addFiles(Array.from(event.dataTransfer.files));
});
operation.addEventListener("change", () => {
  const labels = { images: "Convert images", zip: "Create ZIP", pdf: "Images to PDF" };
  const mode = operation.value as Operation;
  element("tool-title").textContent = labels[mode]; run.textContent = labels[mode];
  element("tool-description").textContent = { images: "Save JPEG, PNG or WebP images in a different format or size.", zip: "Combine files into one ZIP for sharing. Files stay on this device.", pdf: "Put still images into one PDF, in the order you choose." }[mode];
  element("image-options").hidden = mode !== "images";
  element("pdf-options").hidden = mode !== "pdf";
  element("zip-note").hidden = mode !== "zip";
  picker.accept = mode === "zip" ? "" : "image/jpeg,image/png,image/webp";
  element("file-help").textContent = mode === "zip" ? "Up to 100 files · 100 MB total · file contents are not changed" : "JPEG, PNG or WebP · up to 25 MB per image · 100 MB total";
  clearError(); updateQuality(); renderFiles();
});
format.addEventListener("change", updateQuality);
quality.addEventListener("input", updateQuality);
cancel.addEventListener("click", () => { stopWorker(); status.textContent = "Cancelled. Original files were not changed."; run.focus(); });

form.addEventListener("submit", event => {
  event.preventDefault();
  if (worker) return;
  clearError();
  const maxEdge = element<HTMLInputElement>("max-edge").value;
  const task: Task = { operation: operation.value as Operation, files: [...files], image: { format: format.value as Task["image"]["format"], quality: Number(quality.value) / 100, maxEdge: maxEdge.trim() ? Number(maxEdge) : undefined }, pageSize: element<HTMLSelectElement>("page-size").value as Task["pageSize"] };
  try {
    validateSelection(files, task.operation);
    if (task.operation === "images") validateImageOptions(task.image);
    revokeResults();
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    setBusy(true); progress.value = 0; progress.max = 1;
    status.textContent = "Processing on this device…";
    worker.onerror = () => { stopWorker(); status.textContent = "Processing stopped."; showError("The processing worker stopped unexpectedly. Try a smaller batch in a current browser."); };
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.kind === "progress") { progress.max = data.total; progress.value = data.done; status.textContent = `Processing: ${data.done} of ${data.total} steps…`; return; }
      stopWorker();
      if (data.kind === "error") { status.textContent = "No results were generated."; showError(data.message); return; }
      for (const output of data.outputs) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(output.bytes)], { type: output.type })); urls.push(url);
        const row = document.createElement("li");
        const info = document.createElement("div");
        const name = document.createElement("strong"); name.textContent = output.name;
        const details = document.createElement("span"); details.className = "small"; details.textContent = `${formatSize(output.bytes.length)} · ${output.detail}`;
        const save = document.createElement("a"); save.className = "save-button"; save.href = url; save.download = output.name; save.textContent = "Save"; save.setAttribute("aria-label", `Save ${output.name}`);
        info.append(name, details); row.append(info, save); element("results").append(row);
      }
      element("results-panel").hidden = false;
      status.textContent = `${data.outputs.length} result${data.outputs.length === 1 ? "" : "s"} ready. Save below.`;
      element("results-title").focus();
    };
    deadline = setTimeout(() => { stopWorker(); status.textContent = "Processing stopped."; showError("The task exceeded two minutes. Try fewer or smaller files."); }, 120_000);
    worker.postMessage(task);
  } catch (problem) { stopWorker(); showError(problem instanceof Error ? problem.message : "Unable to start processing."); }
});
window.addEventListener("pagehide", () => { stopWorker(); files = []; revokeResults(); renderFiles(); status.textContent = "Choose files to begin."; });
updateQuality(); renderFiles();
