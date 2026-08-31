import { unzlibSync } from "fflate";
import { stripImageMetadata, pngChunk, jpegSegment, riffChunk } from "./metadata";
import { inspectImage, type ImageInfo } from "./image-info";
import { LIMITS } from "./policy";

export interface MetadataField { id: string; group: string; label: string; value: string; editable: boolean }
export interface MetadataReport extends ImageInfo { fields: MetadataField[]; notes: string[] }
export type MetadataEdits = Record<string, string>;
const encoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const latin = (bytes: Uint8Array) => Array.from(bytes, b => String.fromCharCode(b)).join("");
const labelAt = (bytes: Uint8Array, start: number, count: number) => latin(bytes.subarray(start, start + count));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const broken = () => new Error("The metadata structure is damaged or exceeds the inspection limits. No edited copy was created.");
const join = (parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0)); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result; };
const maxText = 65_536, maxValue = 2048;
const exifEdits = new Map([[0x10e,"Description"],[0x13b,"Artist / author"],[0x8298,"Copyright"],[0x131,"Software"],[0x132,"Image timestamp"]]);
const pngEdits = ["Title", "Author", "Description", "Copyright", "Creation Time", "Software", "Source", "Comment"];
const names: Record<number,string> = { 0x100:"Image width",0x101:"Image height",0x10e:"Description",0x10f:"Camera make",0x110:"Camera model",0x112:"Orientation",0x11a:"X resolution",0x11b:"Y resolution",0x128:"Resolution unit",0x131:"Software",0x132:"Image timestamp",0x13b:"Artist / author",0x8298:"Copyright",0x829a:"Exposure time",0x829d:"F number",0x8822:"Exposure program",0x8827:"ISO",0x9000:"EXIF version",0x9003:"Date taken",0x9004:"Date digitized",0x9011:"Date taken offset",0x9201:"Shutter speed",0x9202:"Aperture",0x9204:"Exposure bias",0x9207:"Metering mode",0x9209:"Flash",0x920a:"Focal length",0x927c:"Maker notes",0x9286:"User comment",0xa001:"Color space",0xa002:"Pixel width",0xa003:"Pixel height",0xa405:"35 mm focal length",0xa431:"Camera serial number",0xa433:"Lens make",0xa434:"Lens model",0xa435:"Lens serial number" };
const gpsNames: Record<number,string> = { 0:"GPS version",1:"Latitude reference",2:"Latitude (degrees, minutes, seconds)",3:"Longitude reference",4:"Longitude (degrees, minutes, seconds)",5:"Altitude reference",6:"Altitude",7:"UTC time",16:"Direction reference",17:"Direction",18:"Map datum",29:"GPS date" };

interface Part { tag: string; raw: Uint8Array; payload: Uint8Array; marker?: number }
// Call only after the existing strict cleaner has validated the container. It is
// used for validation, not as the input to editing: unrelated bytes are preserved.
function partsOf(source: Uint8Array, format: string): Part[] {
  const parts: Part[] = [], view = viewOf(source);
  let offset = format === "image/jpeg" ? 2 : format === "image/png" ? 8 : 12;
  parts.push({ tag:"header", raw:source.subarray(0,offset), payload:new Uint8Array() });
  while (offset < source.length) {
    const start = offset;
    if (format === "image/jpeg") {
      while (source[offset] === 255) offset++;
      const marker = source[offset++];
      if (marker === 0xd9) { parts.push({tag:"end",raw:source.subarray(start,offset),payload:new Uint8Array()}); if (offset < source.length) parts.push({tag:"trailing",raw:source.subarray(offset),payload:new Uint8Array()}); break; }
      const end = marker === 1 ? offset : offset + view.getUint16(offset);
      const payload = source.subarray(offset + 2,end);
      const tag = marker === 0xe1 && labelAt(payload,0,6) === "Exif\0\0" ? "exif" : `jpeg:${marker}`;
      parts.push({ tag, marker, raw:source.subarray(start,end), payload }); offset = end;
      if (marker === 0xda) {
        const scan = offset;
        while (offset < source.length) { if (source[offset] !== 255) { offset++; continue; } let next = offset + 1; while (source[next] === 255) next++; const code = source[next]; if (code === 0 || (code >= 0xd0 && code <= 0xd7)) offset = next + 1; else break; }
        parts.push({tag:"pixels",raw:source.subarray(scan,offset),payload:new Uint8Array()});
      }
    } else {
      const isPng = format === "image/png";
      const length = view.getUint32(offset + (isPng ? 0 : 4), !isPng);
      const tag = labelAt(source,offset + (isPng ? 4 : 0),4);
      offset += length + (isPng ? 12 : 8 + length % 2);
      parts.push({tag:tag === "eXIf" || tag === "EXIF" ? "exif" : tag,raw:source.subarray(start,offset),payload:source.subarray(start+8,start+8+length)});
      if (tag === "IEND") { if (offset < source.length) parts.push({tag:"trailing",raw:source.subarray(offset),payload:new Uint8Array()}); break; }
    }
    if (parts.length > 20_000) throw broken();
  }
  return parts;
}

interface Entry { tag: number; type: number; count: number; raw: Uint8Array; data: Uint8Array }
interface Tiff { bytes: Uint8Array; little: boolean; root: Entry[]; next: number; fields: MetadataField[] }
function readTiff(input: Uint8Array): Tiff {
  const bytes = labelAt(input,0,6) === "Exif\0\0" ? input.subarray(6) : input;
  const view = viewOf(bytes), little = labelAt(bytes,0,2) === "II";
  if (bytes.length < 8 || (!little && labelAt(bytes,0,2) !== "MM") || view.getUint16(2,little) !== 42) throw broken();
  const fields: MetadataField[] = [], visited = new Set<number>();
  const sizes: Record<number,number> = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
  function directory(offset: number, group: string, depth: number): { entries: Entry[]; next: number } {
    if (depth > 4 || offset < 8 || offset + 2 > bytes.length || visited.has(offset)) throw broken();
    visited.add(offset);
    const count = view.getUint16(offset,little), entries: Entry[] = [], tags = new Set<number>();
    if (count > 256 || offset + 2 + count * 12 + 4 > bytes.length) throw broken();
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = view.getUint16(at,little), type = view.getUint16(at+2,little), n = view.getUint32(at+4,little);
      const length = sizes[type] * n;
      if (!sizes[type] || tags.has(tag)) throw broken();
      tags.add(tag);
      const start = length <= 4 ? at+8 : view.getUint32(at+8,little);
      if (start + length > bytes.length || (length > 4 && start < 8)) throw broken();
      const data = bytes.subarray(start,start+length), entry = { tag,type,count:n,raw:bytes.subarray(at,at+12),data }; entries.push(entry);
      if ([0x8769,0x8825,0xa005].includes(tag)) {
        if (type !== 4 || n !== 1) throw broken();
        directory(view.getUint32(at+8,little),tag === 0x8825 ? "GPS" : tag === 0xa005 ? "Interoperability" : "EXIF",depth+1);
        continue;
      }
      let value: string;
      if (type === 2) value = latin(data.subarray(0,4096)).replace(/\0+$/g,"") + (data.length > 4096 ? " [truncated]" : "");
      else if (type === 7 || n > 32) value = `${n} ${type === 7 ? "binary bytes" : "values"} (not expanded)`;
      else {
        const d = viewOf(data), values: string[] = [];
        for (let j = 0; j < n; j++) {
          const p = j*sizes[type];
          if (type === 5 || type === 10) { const a = type === 5 ? d.getUint32(p,little) : d.getInt32(p,little), b = type === 5 ? d.getUint32(p+4,little) : d.getInt32(p+4,little); values.push(b ? `${Number((a/b).toPrecision(8))} (${a}/${b})` : `${a}/0`); }
          else { const x = type === 1 ? d.getUint8(p) : type === 6 ? d.getInt8(p) : type === 3 ? d.getUint16(p,little) : type === 8 ? d.getInt16(p,little) : type === 4 || type === 13 ? d.getUint32(p,little) : type === 9 ? d.getInt32(p,little) : type === 11 ? d.getFloat32(p,little) : d.getFloat64(p,little); values.push(String(x)); }
        }
        value = values.join(", ");
      }
      const editable = group === "Image / IFD0" && exifEdits.has(tag) && type === 2 && n <= maxValue+1 && !/[^\x20-\x7e\r\n\t]/.test(value);
      fields.push({id:group === "Image / IFD0" ? `exif:${tag}` : `${group}:${tag}`, group, label:(group === "GPS" ? gpsNames[tag] : names[tag]) ?? `Tag 0x${tag.toString(16).padStart(4,"0")}`, value, editable});
      if (fields.length > 512) throw broken();
    }
    const next = view.getUint32(offset+2+count*12,little);
    if (next) directory(next, "Thumbnail / next IFD",depth+1);
    return {entries,next};
  }
  const root = directory(view.getUint32(4,little),"Image / IFD0",0);
  return {bytes,little,root:root.entries,next:root.next,fields};
}

interface PngText { key: string; value: string }
function pngText(part: Part): PngText {
  const data = part.payload, zero = data.indexOf(0);
  if (zero < 1 || zero > 79) throw broken();
  const key = latin(data.subarray(0,zero));
  let content = data.subarray(zero+1), unicode = false, compressed = false;
  if (part.tag === "zTXt") { if (content[0] !== 0) throw broken(); compressed = true; content = content.subarray(1); }
  if (part.tag === "iTXt") {
    if (content.length < 4 || content[0] > 1 || content[1] !== 0) throw broken();
    compressed = content[0] === 1; unicode = true;
    let index = content.indexOf(0,2); if (index < 0) throw broken();
    index = content.indexOf(0,index+1); if (index < 0) throw broken(); content = content.subarray(index+1);
  }
  if (content.length > maxText) throw broken();
  // A caller-supplied output buffer prevents inflate from allocating unbounded
  // output. The extra byte detects truncation at the display limit.
  if (compressed) content = unzlibSync(content, {out:new Uint8Array(maxText+1)});
  if (content.length > maxText) throw broken();
  return { key, value: unicode ? decode(content) : latin(content) };
}
function parsed(source: Uint8Array) {
  const validated = stripImageMetadata(source);
  const info = {format:validated.format,width:validated.width,height:validated.height};
  return {info,parts:partsOf(source,info.format)};
}
export function readImageMetadata(source: Uint8Array): MetadataReport {
  const {info,parts} = parsed(source), fields: MetadataField[] = [], notes: string[] = [];
  let textBytes = 0;
  for (const [index,part] of parts.entries()) {
    if (part.tag === "exif") fields.push(...readTiff(part.payload).fields);
    else if (["tEXt","zTXt","iTXt"].includes(part.tag)) {
      const text = pngText(part); textBytes += text.value.length;
      fields.push({id:`png:${text.key}`,group:"PNG text",label:text.key,value:text.value.slice(0,4096)+(text.value.length>4096?" [truncated]":""),editable:pngEdits.includes(text.key) && text.value.length <= maxValue});
    } else if (part.tag === "XMP " || (part.marker === 0xe1 && labelAt(part.payload,0,29) === "http://ns.adobe.com/xap/1.0/\0") || part.marker === 0xfe) {
      const data = part.marker === 0xe1 ? part.payload.subarray(29) : part.payload;
      fields.push({id:`packet:${index}`,group:part.marker === 0xfe ? "JPEG comment" : "XMP packet (read-only)",label:"Text",value:new TextDecoder().decode(data.subarray(0,4096))+(data.length>4096?" [truncated]":""),editable:false});
    } else if (["ICCP","iCCP"].includes(part.tag) || (part.marker === 0xe2 && labelAt(part.payload,0,12) === "ICC_PROFILE\0")) notes.push(`Color profile present (${part.payload.length} bytes); preserved, not expanded.`);
    else if (part.marker === 0xed) notes.push("Photoshop/IPTC metadata present; preserved but not decoded by this inspector.");
    else if (part.tag === "trailing") notes.push(`${part.raw.length} trailing bytes are present. Editing preserves them; metadata removal discards them.`);
    if (fields.length > 512 || textBytes > 262144) throw broken();
  }
  const groups = new Map<string,MetadataField[]>();
  for (const field of fields) { const group = groups.get(field.id) ?? []; group.push(field); groups.set(field.id,group); }
  for (const duplicates of groups.values()) if (duplicates.length > 1) { for (const field of duplicates) field.editable = false; notes.push(`Duplicate ${duplicates[0].label} tags are read-only to avoid ambiguous edits.`); }
  if (info.format === "image/png") {
    // PNG native text is Unicode-capable. EXIF is shown but stays read-only in PNG.
    for (const field of fields) if (field.group !== "PNG text") field.editable = false;
    for (const key of pngEdits) if (!groups.has(`png:${key}`)) fields.push({id:`png:${key}`,group:"PNG text",label:key,value:"",editable:true});
  } else for (const [tag,label] of exifEdits) if (!groups.has(`exif:${tag}`)) fields.push({id:`exif:${tag}`,group:"Image / IFD0",label,value:"",editable:true});
  return {...info,fields,notes:[...new Set(notes)]};
}

function rewriteTiff(input: Uint8Array | undefined, changes: MetadataEdits): Uint8Array {
  const tiff = input ? readTiff(input) : {bytes:new Uint8Array([73,73,42,0,8,0,0,0,0,0,0,0,0,0]),little:true,root:[],next:0,fields:[]};
  const {little} = tiff, replacing = new Set(Object.keys(changes).map(id=>Number(id.slice(5))));
  const retained = tiff.root.filter(entry=>!replacing.has(entry.tag));
  const additions = Object.entries(changes).filter(([,value])=>value !== "").map(([id,value])=>({tag:Number(id.slice(5)),data:encoder.encode(value+"\0")}));
  const offset = (tiff.bytes.length+1)&~1, count = retained.length + additions.length;
  if (count > 256) throw broken();
  const dataStart = offset+2+count*12+4;
  const result = new Uint8Array(dataStart+additions.reduce((n,e)=>n+(e.data.length>4?e.data.length+(e.data.length%2):0),0));
  result.set(tiff.bytes); const view = viewOf(result); view.setUint32(4,offset,little); view.setUint16(offset,count,little);
  let dataAt = dataStart;
  const records = retained.map(entry=>({tag:entry.tag,raw:entry.raw}));
  for (const addition of additions) {
    const raw = new Uint8Array(12), v = viewOf(raw); v.setUint16(0,addition.tag,little); v.setUint16(2,2,little); v.setUint32(4,addition.data.length,little);
    if (addition.data.length <= 4) raw.set(addition.data,8);
    else { v.setUint32(8,dataAt,little); result.set(addition.data,dataAt); dataAt += addition.data.length+addition.data.length%2; }
    records.push({tag:addition.tag,raw});
  }
  records.sort((a,b)=>a.tag-b.tag).forEach((entry,i)=>result.set(entry.raw,offset+2+i*12));
  view.setUint32(offset+2+count*12,tiff.next,little);
  // Preserve all original offsets for maker notes and linked EXIF/GPS/thumbnail
  // directories. Old unreferenced values may remain: edits are NOT sanitization.
  return result;
}
export function editImageMetadata(source: Uint8Array, edits: MetadataEdits): { bytes: Uint8Array; report: MetadataReport } {
  const report = readImageMetadata(source);
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) throw new Error("Provide supported metadata fields to edit.");
  const available = new Map(report.fields.filter(field=>field.editable).map(field=>[field.id,field]));
  const changes: MetadataEdits = {};
  for (const [id,value] of Object.entries(edits)) {
    if (!available.has(id)) throw new Error("This metadata field is read-only or unsupported.");
    if (typeof value !== "string" || value.length > maxValue || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Use text up to 2048 characters without control characters.");
    if (id.startsWith("exif:") && /[^\x20-\x7e\r\n\t]/.test(value)) throw new Error("EXIF text in JPEG/WebP must use basic Latin characters. PNG text supports Unicode.");
    if (id === "exif:306" && value && !validDate(value)) throw new Error("Use a valid image timestamp: YYYY:MM:DD HH:MM:SS, without a time zone.");
    if (value !== available.get(id)!.value) changes[id] = value;
  }
  if (!Object.keys(changes).length) return {bytes:source.slice(),report};
  const {parts} = parsed(source), output: Uint8Array[] = [];
  if (report.format === "image/png") {
    for (const part of parts) {
      if (["tEXt","zTXt","iTXt"].includes(part.tag) && Object.hasOwn(changes,`png:${pngText(part).key}`)) continue;
      if (part.tag === "IEND") for (const [id,value] of Object.entries(changes)) if (value) output.push(pngChunk("iTXt",join([encoder.encode(id.slice(4)),new Uint8Array(5),encoder.encode(value)])));
      output.push(part.raw);
    }
  } else {
    const old = parts.find(part=>part.tag === "exif"), tiff = rewriteTiff(old?.payload,changes);
    if (report.format === "image/jpeg") {
      const block = jpegSegment(0xe1,join([encoder.encode("Exif\0\0"),tiff]));
      let inserted = false;
      for (const part of parts) { if (part.tag === "exif") { output.push(block); inserted = true; } else { if (!old && !inserted && part.tag !== "header" && part.marker !== 0xe0) { output.push(block); inserted = true; } output.push(part.raw); } }
    } else {
      let extended = parts.find(part=>part.tag === "VP8X");
      if (!extended) {
        const payload = new Uint8Array(10), frame = parts.find(part=>part.tag === "VP8L"); payload[0] = frame && (frame.payload[4]&16) ? 16 : 0;
        for (let i=0;i<3;i++) { payload[4+i] = (report.width-1) >>> (8*i); payload[7+i] = (report.height-1) >>> (8*i); }
        extended = {tag:"VP8X",payload,raw:riffChunk("VP8X",payload)};
      }
      const header = extended.payload.slice(); header[0] |= 8;
      output.push(parts[0].raw.slice(),riffChunk("VP8X",header));
      let inserted = false;
      for (const part of parts.slice(1)) {
        if (part.tag === "VP8X") continue;
        if (part.tag === "exif") { if (!inserted) { output.push(riffChunk("EXIF",tiff)); inserted=true; } }
        else { if (part.tag === "XMP " && !old && !inserted) { output.push(riffChunk("EXIF",tiff)); inserted=true; } output.push(part.raw); }
      }
      if (!inserted) output.push(riffChunk("EXIF",tiff));
      viewOf(output[0]).setUint32(4,output.reduce((n,p)=>n+p.length,0)-8,true);
    }
  }
  const bytes = join(output);
  if (bytes.length > LIMITS.imageBytes) throw new Error("The edited image exceeds the 25 MB limit.");
  const updated = readImageMetadata(bytes);
  for (const [id,value] of Object.entries(changes)) if ((updated.fields.find(field=>field.id === id)?.value ?? "") !== value) throw new Error("Metadata verification failed. No edited copy was created.");
  const info = inspectImage(bytes); if (info.width !== report.width || info.height !== report.height) throw broken();
  return {bytes,report:updated};
}
function validDate(value: string): boolean {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [y,m,d,h,min,s] = match.slice(1).map(Number), leap = y%4===0 && (y%100!==0 || y%400===0);
  return y>=1 && m>=1 && m<=12 && d>=1 && d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1] && h<24 && min<60 && s<60;
}
