// @vitest-environment jsdom
/// <reference types="vite/client" />
// DOM event tests with a mocked Worker. These do not claim browser codec coverage.
import html from "../index.html?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readImageMetadata } from "./metadata-editor";
import { png } from "./test-fixtures";
import type { Task, WorkerReply } from "./policy";

let workers: FakeWorker[];
class FakeWorker {
  task?: Task; onmessage?: (event: {data:WorkerReply})=>void; onerror?: ()=>void; terminated=false;
  constructor(){workers.push(this);}
  postMessage(task:Task){this.task=task;}
  terminate(){this.terminated=true;}
  reply(data:WorkerReply){this.onmessage?.({data});}
}
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const click=(id:string)=>get<HTMLButtonElement>(id).click();
function choose(...names:string[]) {
  Object.defineProperty(get("files"),"files",{configurable:true,value:names.map(name=>new File([new Uint8Array(png(3,2))],name,{type:"image/png"}))});
  get("files").dispatchEvent(new Event("change",{bubbles:true}));
}
function inspect(...names:string[]) {
  document.querySelector<HTMLButtonElement>('[data-operation="metadata"]')!.click();choose(...names);click("run");
  const reports=names.map(()=>readImageMetadata(png(3,2)));
  workers.at(-1)!.reply({kind:"metadata",reports});return reports;
}
function author(value:string){const input=document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!;input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}
beforeEach(async()=>{
  vi.resetModules();workers=[];document.documentElement.innerHTML=html;
  vi.stubGlobal("Worker",FakeWorker);vi.stubGlobal("confirm",vi.fn(()=>true));
  vi.stubGlobal("URL",class extends URL {static createObjectURL=vi.fn(()=>"blob:qa-output");static revokeObjectURL=vi.fn();});
  await import("./main");
});
afterEach(()=>{workers.forEach(worker=>worker.reply({kind:"error",message:"Test cleanup"}));vi.unstubAllGlobals();});

describe("metadata workspace DOM events",()=>{
  it("reads before editing and names the exact source file",()=>{
    inspect("one.png");expect(workers[0].task?.operation).toBe("metadata-read");expect(get("metadata-editor").hidden).toBe(false);
    expect(get("metadata-file").textContent).toBe("one.png");expect(get<HTMLButtonElement>("run").disabled).toBe(true);expect(get<HTMLButtonElement>("save-metadata").disabled).toBe(true);
  });
  it("sends only changed fields from the selected image and renders the download",()=>{
    inspect("one.png","two.png");author("First author");
    get<HTMLSelectElement>("metadata-file").value="1";get("metadata-file").dispatchEvent(new Event("change"));author("Second author");click("save-metadata");
    const writer=workers.at(-1)!;expect(writer.task?.operation).toBe("metadata-edit");expect(writer.task?.files.map(file=>file.name)).toEqual(["two.png"]);expect(writer.task?.edits).toEqual({"png:Author":"Second author"});
    expect(get<HTMLSelectElement>("metadata-file").disabled).toBe(true);
    writer.reply({kind:"success",outputs:[{name:"two-edited.png",bytes:png(),type:"image/png",detail:"Metadata edited"}]});
    expect(get("results-panel").hidden).toBe(false);expect(document.querySelector<HTMLAnchorElement>("#results a")?.download).toBe("two-edited.png");
    get<HTMLSelectElement>("metadata-file").value="0";get("metadata-file").dispatchEvent(new Event("change"));expect(document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!.value).toBe("First author");
  });
  it("preserves drafts across tool switches and cancellation",()=>{
    inspect("one.png");author("Keep draft");document.querySelector<HTMLButtonElement>('[data-operation="images"]')!.click();expect(get("metadata-editor").hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-operation="metadata"]')!.click();expect(document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!.value).toBe("Keep draft");
    click("save-metadata");click("cancel");expect(workers.at(-1)!.terminated).toBe(true);expect(document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!.value).toBe("Keep draft");
    expect(get<HTMLButtonElement>("save-metadata").disabled).toBe(false);
  });
  it("clears stale output links on a subsequent edit",()=>{
    inspect("one.png");author("A");click("save-metadata");workers.at(-1)!.reply({kind:"success",outputs:[{name:"copy.png",bytes:png(),type:"image/png",detail:"edited"}]});
    author("B");expect(get("results-panel").hidden).toBe(true);expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("asks before dropping drafts and respects cancellation",()=>{
    inspect("one.png");author("Keep draft");vi.mocked(confirm).mockReturnValue(false);click("clear");
    expect(get("metadata-editor").hidden).toBe(false);expect(get("file-count").textContent).toContain("1 ·");
    choose("two.png");expect(get("file-count").textContent).toContain("1 ·");expect(document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!.value).toBe("Keep draft");
    vi.mocked(confirm).mockReturnValue(true);click("clear");expect(get("metadata-editor").hidden).toBe(true);
  });
  it("does not discard drafts when the file picker is cancelled",()=>{
    inspect("one.png");author("Keep draft");choose();expect(confirm).not.toHaveBeenCalled();expect(document.querySelector<HTMLTextAreaElement>('[data-field="png:Author"]')!.value).toBe("Keep draft");
  });
  it("keeps full removal available without applying pending descriptive edits",()=>{
    inspect("one.png");author("Draft");get<HTMLSelectElement>("metadata-mode").value="remove";get("metadata-mode").dispatchEvent(new Event("change"));
    expect(get("metadata-editor").hidden).toBe(true);expect(get("run").textContent).toBe("Remove metadata");click("run");expect(workers.at(-1)!.task?.operation).toBe("metadata");expect(workers.at(-1)!.task?.edits).toBeUndefined();
  });
  it("renders filenames and packet text as inert text, not HTML",()=>{
    const reports=inspect('<img src=x onerror="alert(1)">.png');reports[0].fields.push({id:"packet:1",group:"XMP",label:"<svg onload=alert(1)>",value:"<img src=x onerror=alert(1)>",editable:false});
    workers[0].reply({kind:"metadata",reports});expect(get("metadata-file").querySelector("img")).toBeNull();expect(get("metadata-values").querySelector("img,svg")).toBeNull();expect(get("metadata-values").textContent).toContain("<img src=x");
  });
});
