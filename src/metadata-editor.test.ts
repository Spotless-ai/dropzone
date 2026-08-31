import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { readImageMetadata, editImageMetadata } from "./metadata-editor";
import { pngChunk, jpegSegment, riffChunk, stripImageMetadata } from "./metadata";
import { png } from "./test-fixtures";

const ascii=(text:string)=>new TextEncoder().encode(text);
const join=(...parts:Uint8Array[])=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0; for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;};
function exif(little=true, orientation=6) {
  const bytes=new Uint8Array(256), view=new DataView(bytes.buffer);
  bytes.set(ascii(little?"II":"MM")); view.setUint16(2,42,little);view.setUint32(4,8,little);view.setUint16(8,5,little);
  const entry=(at:number,tag:number,type:number,count:number,value:number)=>{view.setUint16(at,tag,little);view.setUint16(at+2,type,little);view.setUint32(at+4,count,little);if(type===3)view.setUint16(at+8,value,little);else view.setUint32(at+8,value,little);};
  entry(10,0x10e,2,7,90); entry(22,0x10f,2,5,80); entry(34,0x112,3,1,orientation); entry(46,0x8769,4,1,120);entry(58,0x8825,4,1,200);
  bytes.set(ascii("Acme\0"),80);bytes.set(ascii("Before\0"),90);
  view.setUint16(120,2,little);entry(122,0x9003,2,20,160);entry(134,0x927c,7,5,190);bytes.set(ascii("2024:05:06 12:34:56\0"),160);bytes.set([11,22,33,44,55],190);
  view.setUint16(200,2,little);entry(202,1,2,2,0);bytes.set(ascii("N\0"),210);entry(214,2,5,3,232);
  [40,1,26,1,4612,100].forEach((n,i)=>view.setUint32(232+i*4,n,little));
  return bytes;
}
const frame=jpegSegment(0xc0,new Uint8Array([8,0,2,0,3,1,1,17,0]));
const scan=jpegSegment(0xda,new Uint8Array([1,1,0,0,63,0]));
const jpeg=(...blocks:Uint8Array[])=>join(new Uint8Array([255,216]),...blocks,frame,scan,new Uint8Array([1,2,255,0,3,255,208,4,255,217]));
const appExif=(data=exif())=>jpegSegment(0xe1,join(ascii("Exif\0\0"),data));
const pngWith=(...blocks:Uint8Array[])=>{const base=png(3,2);return join(base.subarray(0,33),...blocks,base.subarray(33));};
const textChunk=(key:string,value:string)=>pngChunk("tEXt",join(ascii(key),new Uint8Array(1),ascii(value)));
const webp=(...blocks:Uint8Array[])=>{const result=join(ascii("RIFF"),new Uint8Array(4),ascii("WEBP"),...blocks);new DataView(result.buffer).setUint32(4,result.length-8,true);return result;};
const webpFrame=()=>riffChunk("VP8L",new Uint8Array([47,2,64,0,0,10,20]));
const extended=(flags:number)=>riffChunk("VP8X",new Uint8Array([flags,0,0,0,2,0,0,1,0,0]));
const value=(source:Uint8Array,id:string)=>readImageMetadata(source).fields.find(f=>f.id===id)?.value;

describe("metadata inspector and editor",()=>{
  it.each([true,false])("reads %s-endian EXIF, nested date, GPS and maker-note presence",little=>{
    const report=readImageMetadata(jpeg(appExif(exif(little))));
    expect(report.fields.find(f=>f.id==="exif:270")).toMatchObject({value:"Before",editable:true});
    expect(report.fields.find(f=>f.label==="Date taken")).toMatchObject({value:"2024:05:06 12:34:56",editable:false});
    expect(report.fields.find(f=>f.label.startsWith("Latitude ("))?.value).toContain("46.12 (4612/100)");
    expect(report.fields.find(f=>f.label==="Maker notes")).toMatchObject({value:"5 binary bytes (not expanded)",editable:false});
  });
  it.each([true,false])("edits existing tags and adds tags while preserving all linked offsets (%s)",little=>{
    const source=jpeg(appExif(exif(little)),jpegSegment(0xfe,ascii("Keep unrelated comment"))), before=source.slice();
    const output=editImageMetadata(source,{"exif:270":"A much longer replacement description","exif:315":"Jane","exif:33432":"Copyright Jane"}).bytes;
    expect(value(output,"exif:270")).toBe("A much longer replacement description");expect(value(output,"exif:315")).toBe("Jane");expect(value(output,"exif:33432")).toBe("Copyright Jane");
    expect(value(output,"exif:271")).toBe("Acme");expect(value(output,"EXIF:36867")).toBe("2024:05:06 12:34:56");
    expect(value(output,"GPS:2")).toBe(value(source,"GPS:2"));expect(value(output,"EXIF:37500")).toBe("5 binary bytes (not expanded)");
    expect(stripImageMetadata(output).bytes).toEqual(stripImageMetadata(source).bytes);expect(source).toEqual(before);
    expect(new TextDecoder().decode(output)).toContain("Keep unrelated comment");
  });
  it.each([1,2,3,4,5,6,7,8])("does not change orientation %s",orientation=>{
    const source=jpeg(appExif(exif(true,orientation))), output=editImageMetadata(source,{"exif:315":"Writer"}).bytes;
    expect(value(output,"exif:274")).toBe(String(orientation));expect(stripImageMetadata(output).bytes).toEqual(stripImageMetadata(source).bytes);
  });
  it("adds EXIF to a metadata-free JPEG and handles short inline values",()=>{
    const source=jpeg(), output=editImageMetadata(source,{"exif:315":"A"}).bytes;
    expect(value(output,"exif:315")).toBe("A");expect(stripImageMetadata(output).bytes).toEqual(source);
  });
  it("deletes an active EXIF tag without claiming to sanitize its old bytes",()=>{
    const source=jpeg(appExif()), output=editImageMetadata(source,{"exif:270":""}).bytes;
    expect(value(output,"exif:270")).toBe("");expect(new TextDecoder().decode(output)).toContain("Before");
    expect(new TextDecoder().decode(stripImageMetadata(output).bytes)).not.toContain("Before");
  });
  it("returns an identical copy when nothing changed",()=>{
    const source=jpeg(appExif());expect(editImageMetadata(source,{"exif:270":"Before"}).bytes).toEqual(source);expect(editImageMetadata(source,{}).bytes).toEqual(source);
  });
  it("adds EXIF to simple WebP and retains its encoded payload",()=>{
    const source=webp(webpFrame()), output=editImageMetadata(source,{"exif:315":"Writer"}).bytes;
    expect(value(output,"exif:315")).toBe("Writer");expect(readImageMetadata(output)).toMatchObject({width:3,height:2});
    expect(output.slice(30,30+webpFrame().length)).toEqual(webpFrame());
  });
  it("edits extended WebP without losing XMP or orientation",()=>{
    const source=webp(extended(12),webpFrame(),riffChunk("EXIF",exif()),riffChunk("XMP ",ascii("<xmp>Keep me</xmp>")));
    const output=editImageMetadata(source,{"exif:270":"Updated"}).bytes;
    expect(value(output,"exif:270")).toBe("Updated");expect(value(output,"exif:274")).toBe("6");
    expect(new TextDecoder().decode(output)).toContain("<xmp>Keep me</xmp>");expect(output[20]&12).toBe(12);
    expect(stripImageMetadata(output).bytes).toEqual(stripImageMetadata(source).bytes);
  });
  it("reads PNG text and adds Unicode iTXt without modifying EXIF or image chunks",()=>{
    const source=pngWith(textChunk("Author","Before"),textChunk("Custom","Keep me"),pngChunk("eXIf",exif())), before=source.slice();
    const output=editImageMetadata(source,{"png:Author":"Zoë 東京","png:Description":"First line\nSecond line"}).bytes;
    expect(value(output,"png:Author")).toBe("Zoë 東京");expect(value(output,"png:Description")).toBe("First line\nSecond line");expect(value(output,"png:Custom")).toBe("Keep me");
    expect(value(output,"exif:270")).toBe("Before");expect(readImageMetadata(output).fields.find(f=>f.id==="exif:270")?.editable).toBe(false);
    expect(stripImageMetadata(output).bytes).toEqual(stripImageMetadata(source).bytes);expect(source).toEqual(before);
  });
  it("deletes active PNG text and preserves unrelated fields",()=>{
    const source=pngWith(textChunk("Author","Before"),textChunk("Comment","Keep"));
    const output=editImageMetadata(source,{"png:Author":""}).bytes;expect(value(output,"png:Author")).toBe("");expect(value(output,"png:Comment")).toBe("Keep");
    expect(new TextDecoder().decode(output)).not.toContain("Before");
  });
  it("reads compressed zTXt and compressed Unicode iTXt",()=>{
    const source=pngWith(pngChunk("zTXt",join(ascii("Author\0"),new Uint8Array([0]),zlibSync(ascii("Writer")))),pngChunk("iTXt",join(ascii("Title\0"),new Uint8Array([1,0,0,0]),zlibSync(ascii("東京")))));
    expect(value(source,"png:Author")).toBe("Writer");expect(value(source,"png:Title")).toBe("東京");
  });
  it("rejects text inflation beyond the bounded output buffer",()=>{
    const source=pngWith(pngChunk("zTXt",join(ascii("Author\0"),new Uint8Array([0]),zlibSync(new Uint8Array(1_000_000).fill(65)))));
    expect(()=>readImageMetadata(source)).toThrow("inspection limits");
  });
  it("shows duplicate PNG fields read-only rather than picking a value silently",()=>{
    const report=readImageMetadata(pngWith(textChunk("Author","One"),textChunk("Author","Two")));
    expect(report.fields.filter(f=>f.id==="png:Author").every(f=>!f.editable)).toBe(true);expect(report.notes.join()).toContain("Duplicate");
    expect(()=>editImageMetadata(pngWith(textChunk("Author","One"),textChunk("Author","Two")),{"png:Author":"Three"})).toThrow("read-only");
  });
  it.each(["GPS:2","exif:274","exif:36867","__proto__"])("rejects unsupported edit field %s",id=>{
    expect(()=>editImageMetadata(jpeg(appExif()),Object.fromEntries([[id,"1"]]))).toThrow("read-only");
  });
  it.each(["\0bad","x".repeat(2049),"😀"])("rejects invalid EXIF edit text",value=>expect(()=>editImageMetadata(jpeg(),{"exif:315":value})).toThrow());
  it.each(["2023:02:29 10:00:00","2024:04:31 10:00:00","2024:01:01 24:00:00","2024-01-01","0000:01:01 00:00:00"])("rejects invalid date %s",date=>expect(()=>editImageMetadata(jpeg(),{"exif:306":date})).toThrow("timestamp"));
  it("accepts a valid leap day",()=>expect(value(editImageMetadata(jpeg(),{"exif:306":"2024:02:29 12:34:56"}).bytes,"exif:306")).toBe("2024:02:29 12:34:56"));
  it("rejects cyclic EXIF directories and out-of-range values",()=>{
    const cycle=exif();new DataView(cycle.buffer).setUint32(66,8,true);expect(()=>readImageMetadata(jpeg(appExif(cycle)))).toThrow("damaged");
    const outside=exif();new DataView(outside.buffer).setUint32(18,999999,true);expect(()=>readImageMetadata(jpeg(appExif(outside)))).toThrow("damaged");
  });
  it("rejects oversized JPEG EXIF growth instead of truncating a segment length",()=>{
    const large=new Uint8Array(65000);large.set(exif());expect(()=>editImageMetadata(jpeg(appExif(large)),{"exif:315":"A".repeat(2048)})).toThrow("too large");
  });
  it("rejects truncated edited outputs at every offset",()=>{
    const output=editImageMetadata(png(),{"png:Author":"Writer"}).bytes;
    for(let end=0;end<output.length;end++)expect(()=>readImageMetadata(output.subarray(0,end))).toThrow();
  });
});
