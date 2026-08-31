import type { MetadataEdits, MetadataReport } from "./metadata-editor";

export function createMetadataWorkspace(options: { onSave: (file: File, edits: MetadataEdits) => void; onChange: () => void }) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = get("metadata-editor"), select = get<HTMLSelectElement>("metadata-file"), save = get<HTMLButtonElement>("save-metadata");
  let files: File[] = [], reports: MetadataReport[] = [], drafts: MetadataEdits[] = [], busy = false, visible = false;
  const changes = (index: number) => Object.fromEntries(Object.entries(drafts[index] ?? {}).filter(([id,value])=>value !== reports[index]?.fields.find(field=>field.id===id)?.value));
  const dirty = () => reports.some((_,i)=>Object.keys(changes(i)).length>0);
  const controls = () => { select.disabled=busy; save.disabled=busy || !Object.keys(changes(Number(select.value))).length; for (const input of panel.querySelectorAll<HTMLTextAreaElement>("textarea")) input.disabled=busy; };
  const text = (tag: string, value: string) => { const element=document.createElement(tag); element.textContent=value; return element; };
  function render() {
    panel.hidden = !visible || reports.length===0;
    const index=Number(select.value), report=reports[index];
    const editable=get("metadata-fields"), readonly=get("metadata-values"); editable.replaceChildren(); readonly.replaceChildren();
    if (!report) return;
    get("metadata-summary").textContent=`${report.format.replace("image/","").toUpperCase()} · ${report.width} × ${report.height} · inspection of the original file`;
    get("metadata-edit-help").textContent=report.format==="image/png" ? "PNG text supports Unicode. Other groups below are read-only. Emptying a field removes its active tag." : "Editable EXIF fields use basic Latin text (up to 2048 characters). The image timestamp is YYYY:MM:DD HH:MM:SS; it is not the camera’s Date taken field. Emptying a field removes its active tag.";
    for (const field of report.fields) {
      if (field.editable) {
        const label=document.createElement("label"), input=document.createElement("textarea"); label.append(text("span",field.label));
        input.value=drafts[index]?.[field.id] ?? field.value; input.rows=2; input.maxLength=2048; input.dataset.field=field.id;
        input.setAttribute("aria-label",`${field.group}: ${field.label}`);
        input.addEventListener("input",()=>{ drafts[index][field.id]=input.value; options.onChange(); controls(); });
        label.append(input); editable.append(label);
      } else {
        const row=document.createElement("tr"), key=document.createElement("th"), value=document.createElement("td"); key.scope="row"; key.append(text("strong",field.label),text("span",field.group)); value.textContent=field.value || "(empty)"; row.append(key,value); readonly.append(row);
      }
    }
    get("metadata-no-readonly").hidden=readonly.children.length>0;
    get("metadata-notes").replaceChildren(...report.notes.map(note=>text("li",note)));
    controls();
  }
  select.addEventListener("change",render);
  save.addEventListener("click",()=>{ const index=Number(select.value); if (!busy && files[index] && Object.keys(changes(index)).length) options.onSave(files[index],changes(index)); });
  return {
    show(value: boolean) { visible=value; panel.hidden=!visible || !reports.length; },
    setBusy(value: boolean) { busy=value; controls(); },
    complete: () => reports.length>0,
    dirty,
    discard(force=false) { if (!force && dirty() && !confirm("Discard the pending metadata edits? Your original files will not change.")) return false; files=[]; reports=[]; drafts=[]; select.replaceChildren(); render(); return true; },
    receive(inputs: File[], data: MetadataReport[]) {
      files=[...inputs]; reports=data; drafts=data.map(()=>({}));
      select.replaceChildren(...files.map((file,i)=>{ const option=document.createElement("option"); option.value=String(i); option.textContent=file.name; return option; }));
      render(); get("metadata-heading").focus();
    },
  };
}
