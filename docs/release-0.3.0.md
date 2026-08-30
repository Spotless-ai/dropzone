# DropZone 0.3.0 — metadata removal without recompression

Date: 2026-08-30.

## Added

A separate **Remove metadata** tool for still JPEG, PNG and WebP files. It
downloads same-format `-clean` copies without decoding/re-encoding the image,
resizing, changing originals or using conversion-tab settings. Files without
removable metadata are identified rather than implying a successful reduction.

EXIF is replaced by a minimal orientation-only block when needed. ICC profiles
and recognized display/color chunks remain. GPS/camera tags, XMP, IPTC, comments,
embedded thumbnails and other descriptive container metadata are discarded.
Copyright and provenance records may be removed. Filenames, visible/hidden
pixel data and descriptive fields within color profiles remain: this is not an
anonymity guarantee, forensic scrubber or malware scanner.

Animation and recognized multi-picture/HDR gain-map JPEGs are rejected. PNG
checksums, structural boundaries, duplicate/invalid EXIF orientation and relevant
chunk ordering are checked. Compressed bitstreams are copied, not fully decoded
and validated. An error stops the batch without returning partial success.

No additional runtime dependencies, uploads, analytics or storage. MIT and the
existing dependencies/license notices remain unchanged. The navigation wraps
on narrow screens; the established interface is otherwise retained.

## Checks performed

- 173 tests pass: all 123 prior tests plus 50 metadata/parser/protocol cases.
- Exact preservation of image payloads, PNG display chunks, JPEG ICC/Adobe
  markers and WebP alpha/color data; JPEG markers between multiple scans;
  EXIF both byte orders and all eight orientations; text/thumbnail omission;
  idempotence; PNG/JPEG trailing data removal; WebP size/flag/padding updates.
- Invalid CRCs, unknown critical chunks, duplicate frames/EXIF, mismatched
  canvas size, bad chunk order, incomplete structures, and truncation at every
  byte boundary for three synthetic containers are rejected.
- Worker tests check same-format naming, duplicate names, progress, unchanged
  inputs, no conversion/PDF calls, settings isolation and whole-batch failure.
- TypeScript, production build, local-worker/CSP/license assertions and compiled
  worker ZIP smoke checks pass. Runtime npm audit: no known vulnerabilities
  reported on this date (not proof that the app is vulnerability-free).
- `scripts/check-metadata-codecs.mjs` runs the actual compiled worker without
  canvas or bitmap globals, using synthetic real JPEG/PNG/WebP input files.
  All 24 format/orientation cases reopen in Skia with exactly identical decoded
  pixels and dimensions to their inputs; injected personal text is absent,
  files are smaller and originals are unchanged.

To repeat the optional independent codec check, build first and supply a
separately installed test-only `@napi-rs/canvas` module path:

```sh
npm run check
node scripts/check-metadata-codecs.mjs /absolute/path/to/@napi-rs/canvas
node scripts/check-target-codecs.mjs /absolute/path/to/@napi-rs/canvas
```

## Limits of verification

The native-codec adapter is not browser/UI testing and is not shipped with
DropZone. No new live-browser interaction/visual QA was performed for this
release. Earlier browser QA remains historical. Standalone browser coverage,
screen-reader testing, diverse real-world ICC/CMYK/HDR images and maximum-sized
batches are not certified. Keep originals and inspect results before sharing.

Specifications used: [PNG](https://www.w3.org/TR/png-3/),
[WebP RIFF](https://developers.google.com/speed/webp/docs/riff_container),
[JFIF](https://www.w3.org/Graphics/JPEG/jfif3.pdf).
