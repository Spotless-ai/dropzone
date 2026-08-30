import { zipSync, type Zippable } from "fflate";
import { LIMITS, uniqueName, validateSelection } from "./policy";

export interface ArchiveInput { name: string; bytes: Uint8Array }

export function createArchive(files: ArchiveInput[]): { bytes: Uint8Array; names: string[] } {
  validateSelection(files.map(file => ({ name: file.name, size: file.bytes.length })), "zip");
  const entries: Zippable = Object.create(null);
  const used = new Set<string>();
  const names: string[] = [];
  for (const file of files) {
    const name = uniqueName(file.name, used);
    names.push(name);
    entries[name] = file.bytes;
  }
  // Do not copy filesystem modification times into the archive.
  const bytes = zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0) });
  if (bytes.length > LIMITS.outputBytes) throw new Error("The ZIP exceeds the 100 MB output limit. Try fewer files.");
  return { bytes, names };
}
