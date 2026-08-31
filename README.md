# DropZone Web

Local image conversion, metadata inspection/editing/removal, ZIP creation and images to PDF, without an installer.

[Open DropZone](https://spotless-ai.github.io/dropzone/) · [Report a problem](https://github.com/Spotless-ai/dropzone/issues)

Free and open source. Choose a tool, add your files, adjust the output settings, and download the results. No account or installation required.

## Tools

- Convert still JPEG, PNG and WebP images to JPEG, PNG or WebP; optionally reduce the longest edge. Images are never enlarged.
- Choose JPEG/WebP quality. PNG encoding is lossless; a smaller file is not guaranteed.
- Set a maximum size per image in KB. Automatic quality adjustment and optional resizing help fit upload limits.
- Remove descriptive metadata from still JPEG, PNG and WebP files without re-encoding their image data. Orientation and color information are kept for display.
- Read EXIF/GPS values and embedded text; edit supported descriptive fields and save a separate image copy without recompression.
- Create a ZIP from selected files. Duplicate names get numbered suffixes instead of overwriting one another. Exported names are flattened and made portable; file contents are unchanged.
- Put selected images into an A4 or US Letter PDF, one image per page, with explicit ordering controls. Landscape images get landscape pages.
- Cancel processing by terminating its worker. A two-minute processing timeout prevents an indefinitely running task.
- Save generated files individually. Original files are not modified.

This is the browser edition, not a feature-for-feature port of the desktop app. Video conversion and ZIP extraction are **not implemented**. Animated images, SVG, GIF, HEIC, RAW, PDF editing, searchable/OCR text and folder selection are not supported.

## Image handling

For conversion, image headers are checked before decoding to enforce size limits and reject supported animation containers. The browser decodes and redraws accepted images. Original EXIF, GPS, IPTC and XMP fields are not copied. This is not a comprehensive anonymity guarantee: visible information remains, and an encoder may write technical metadata of its own. Browser color management may change color profiles or pixel values.

JPEG outputs use a white background for transparent pixels. PDF images are re-encoded to JPEG at 92% quality with a maximum 2400-pixel edge and a white background. PDF creation therefore is not lossless; it is intended for convenient image documents, not archival scans.

### Target size

In **Images**, enter a whole-number **Target size**, such as `500` for a 500 KB
limit. Leave it empty to use the ordinary quality control. Here 1 KB means
1,000 bytes; the result also shows its exact byte count against the ceiling.
The limit applies to each image separately, not to the batch, ZIP or PDF.

- JPEG and WebP try quality settings from 95% down to 40% at the current
  dimensions. The manual quality slider is disabled while a target is set.
- **Allow smaller dimensions** is off by default. With it enabled, images
  that cannot fit at 40% quality are resized from the original decoded picture
  and tested again. PNG cannot lower quality; it can only try smaller dimensions.
- Automatic resizing stops at a 256-pixel longest edge, or the starting size
  if already smaller. **Longest edge** still applies first and never enlarges
  an image; you can explicitly set it below 256 if that is what you need.
- The search is bounded to eight dimension attempts and six quality-refinement
  steps per successful dimension. Quality numbers are encoder settings, not
  a visual-quality score. Different browsers can produce different results.
- Only an actual encoded file at or below the requested byte ceiling is
  returned. This is a maximum, not padding to an exact file size or a promise
  to find the mathematically optimal compression. Output can still be larger
  than an already-small original.
- If the limit cannot be met, increase it or allow resizing. No oversized
  download or partial batch is presented as a success. Originals stay unchanged.

### Remove metadata without recompression

Choose **Metadata → Remove metadata**, add still JPEG, PNG or WebP images, and download
the `-clean` copies. This mode edits the file container, not the encoded picture:
it never calls an image encoder, changes format, resizes or modifies originals.
Target-size and quality settings from the Images tab do not apply.

- Removes EXIF camera/GPS tags, IPTC, XMP, comments, embedded EXIF/JFIF
  thumbnails, PNG text/time chunks, unknown ancillary metadata and JPEG/PNG
  trailing data. WebP unknown chunks and XMP are removed as well.
- Replaces EXIF with an orientation-only block when a rotation or reflection
  is needed. Keeps ICC profiles and recognized color/display information,
  including PNG transparency/HDR color chunks and JPEG color-transform markers.
  The encoded JPEG scans, PNG image chunks and WebP image/alpha payloads remain
  unchanged. Applications can still differ in how they display an image.
- Color profiles may contain descriptive fields; they are intentionally kept.
  Filenames, visible information and hidden data within pixels are not removed.
  This is **not an anonymity guarantee**, malware scanner or forensic scrubber.
- Copyright tags and embedded provenance/content credentials may be removed.
  Keep the original when those records matter.
- Only supported still-image structures are accepted. Animation, multi-picture
  and recognized HDR gain-map JPEG containers are rejected. Damaged metadata,
  invalid PNG checksums, incomplete containers and unsupported structures stop
  the batch; this parser does not fully validate compressed image bitstreams.
- Already-clean files are labeled **No metadata changes needed**. Size savings
  depend on the original metadata; this is not an image compression mode.

Implementation references: [PNG specification](https://www.w3.org/TR/png-3/),
[WebP container specification](https://developers.google.com/speed/webp/docs/riff_container),
and [JFIF structure](https://www.w3.org/Graphics/JPEG/jfif3.pdf).

### View and edit metadata

Choose **Metadata → View and edit**, add images and press **Read metadata**.
Select a file in the inspection workspace, change supported fields, then choose
**Save edited copy**. Each download has an `-edited` suffix. Pending edits are
kept when switching between inspected files or tools; changing the file selection
asks before discarding them. Editing is per image, not a bulk overwrite.

| Format | Editable fields | Text support |
| --- | --- | --- |
| JPEG and WebP | EXIF IFD0 description, artist/author, copyright, software, image timestamp | Basic Latin/ASCII, up to 2048 characters per field |
| PNG | Native Title, Author, Description, Copyright, Creation Time, Software, Source, Comment | Unicode, up to 2048 characters per field |

The EXIF image timestamp is `YYYY:MM:DD HH:MM:SS` without a time zone; it is not
the separate camera **Date taken** field. Blank editable fields remove their
active tags. Already-empty fields are not written. Unsupported fields remain
read-only. EXIF embedded in PNG is displayed but not edited; native PNG text is
edited instead. Different groups can contain contradictory values; this does not
synchronize EXIF, XMP and IPTC fields automatically.

The inspector reads bounded EXIF IFD0, EXIF/GPS/interoperability and linked
thumbnail directories, PNG text (including bounded compressed text), JPEG
comments and XMP text packets. XMP packets are displayed as plain text, not
executed or editable XML. Binary maker notes, Photoshop/IPTC and color-profile
contents are not expanded. Unknown EXIF tags show their numeric ID; large values
are summarized or truncated. Duplicate/unsupported fields are read-only. This is
not a complete metadata dump or a forensic inspector.

**Editing is not privacy cleaning.** Encoded image data and unrelated metadata
are preserved. For EXIF edits, a replacement IFD0 is appended inside the EXIF
container while original offsets remain stable for linked directories and opaque
maker notes. Old unreferenced EXIF values can remain in the file. Use **Remove
metadata** when you want descriptive metadata removed; editing a field to blank
is not secure erasure. Any metadata edit can invalidate content credentials.
Keep originals when provenance matters.

Parsing is capped at 256 entries per EXIF directory, 512 displayed fields,
four nested directory levels, 64 KiB decoded per PNG text chunk and 2 MB of
inspection reports per batch. Damaged/out-of-bounds structures and excessive
metadata fail explicitly. JPEG EXIF growth must fit its segment size, and edited
files must stay under 25 MiB. These checks do not validate every compressed image
bitstream. See [0.4.0 verification](docs/release-0.4.0.md).

## Privacy and limits

File processing happens in a dedicated browser worker. There is no upload endpoint, account, telemetry, external font or runtime CDN dependency. Files and outputs are kept in memory, not IndexedDB or local storage. Navigating away clears the selection and generated download URLs.

Loading the app makes ordinary requests to GitHub Pages. The production page uses a Content Security Policy with `connect-src 'none'`; development permits same-origin connections for hot reload. Source inspection and build assertions check these properties; they are not a comprehensive network audit. No offline service worker/cache is included.

- Up to 100 files and 100 MiB total input.
- Up to 25 MiB per image, 24 megapixels, and 12000 pixels per edge.
- Up to 100 MiB of generated outputs.
- Browser memory limits vary; these limits are ceilings, not a guarantee every permitted batch will complete.
- An invalid image fails the batch; partial PDFs are not offered as successful outputs.
- ZIP creation does not inspect contents for malware or remove metadata from the files inside it.

## Development

Requires Node.js 22.12 or later and npm.

```sh
npm ci --ignore-scripts
npm run dev
npm run check
npm run preview
```

`npm run check` runs automated core tests, TypeScript checks, a production build and static build-policy assertions. Codec-control tests mock browser APIs and are labeled as such; they do not establish browser compatibility.

The build produces static files in `dist/`, with relative asset paths for GitHub Pages. The Pages workflow is manually triggered and publishes only after the checks pass. Pushes and pull requests run checks without automatically deploying.

## Compatibility and verification

Image conversion and PDF creation require `OffscreenCanvas`, `createImageBitmap` and workers. Metadata removal needs a worker but no image encoder or canvas API. Unsupported encoding produces a visible error; it does not silently return a different format.

The first release was tested in the Codex in-app browser on Windows. Saved JPEG, PNG, WebP, ZIP and PDF outputs were independently reopened. The checks covered transparency, an EXIF orientation fixture, metadata omission, duplicate ZIP names, PDF page orientation, error recovery and cancellation. Responsive checks covered 320px, 390px and desktop widths. See [release verification](docs/release-0.1.0.md).

Target-size compression has automated search, conversion-control and worker
protocol tests, plus a production-worker check using real Skia JPEG/PNG/WebP
codecs through a Node canvas adapter. That additional check is not browser/UI
testing. See [0.2.0 verification](docs/release-0.2.0.md) for scope and commands.

This is an early release, not a claim of universal browser compatibility. Standalone Chrome, Edge, Firefox and Safari testing, full keyboard/screen-reader testing, exhaustive color-profile/metadata checks and maximum-sized batches remain follow-up work. Original files are never overwritten. Keep your originals and check the result before sharing it.

Metadata removal has byte-preservation, malformed-container, orientation,
metadata omission and worker-protocol tests. A separate native-codec check
reopens cleaned JPEG/PNG/WebP outputs and compares decoded pixels at all eight
EXIF orientations. See [0.3.0 verification](docs/release-0.3.0.md); these are not
new browser/UI compatibility checks.

## Feedback

When reporting a problem, include your browser/version, operating system, chosen tool, approximate file size and the error text. Use a small synthetic example if possible; **do not post private files or sensitive screenshots** in public issues.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`. Runtime dependencies are bundled locally. Their license notices are included in the production build.
