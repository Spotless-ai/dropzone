# DropZone 0.4.0 — metadata inspection and editing

Verified 31 August 2026. The existing Metadata removal mode is retained under
**Metadata → Remove metadata**. **View and edit** is the default metadata action.
No runtime dependency, external request, account, backend or installer was added.
The interface extends the existing system-font/light-and-dark panel styling.

## Scope

- Read EXIF/GPS/linked directories, PNG text, JPEG comments and raw XMP packets.
- Edit five descriptive EXIF IFD0 tags in JPEG/WebP and eight native text keys in
  PNG. Other fields are read-only. This is not arbitrary tag or camera/GPS editing.
- Save a separate copy. Encoded image data is not passed through a decoder or
  encoder. Unrelated metadata is retained. EXIF edits can retain old unreferenced
  values: the interface and README explicitly distinguish editing from cleaning.
- Bound metadata sizes, recursion, directories, field values and decompression.
  Duplicate fields are shown read-only. A post-write parse verifies changed values
  before output is returned. Originals are never overwritten.

## Checks completed

- **222 automated tests**: existing conversion/archive/PDF/removal regressions plus
  metadata inspection/editing, both TIFF byte orders, GPS/EXIF directory traversal,
  unknown-data preservation, all eight orientations, Unicode PNG text, compressed
  text, duplicate fields, malformed offsets, cyclic directories, excessive inflate,
  invalid dates/control characters, segment growth limits and truncated input.
- DOM event tests exercise the real page markup and application controller with
  a mocked Worker: read-before-edit, correct selected-file patch, draft retention,
  cancellation, discarded-edit confirmation, cancelled pickers, clearing stale
  downloads, removal mode and inert rendering of malicious-looking text. JSDOM is
  a pinned test-only MIT dependency, not part of the app bundle.
- TypeScript checks, production build, CSP/local-asset/license assertions and the
  compiled ZIP-worker smoke check pass. `npm audit` reports zero advisories at
  verification time; this is not an independent security audit.
- The actual compiled production worker processed real synthetic JPEG, PNG and
  WebP files. For **all eight orientations in each format**, Skia reopened both
  cleaned and edited outputs with identical decoded pixels/orientation. Edited
  author values read back correctly, and original file bytes were unchanged.
- A separate **Pillow** reader verified the saved author values in all 24 edited
  files, confirmed the existing description and orientation, and compared identical
  decoded RGBA pixels. PNG Unicode author text was read independently.
- Existing native-codec target-size regression checks passed for JPEG/PNG/WebP:
  actual ceilings, transparency, resizing, impossible limits and independent batch
  outputs still behave as documented.

## Reproduce the native checks

After `npm run check`, provide a test-only installation of `@napi-rs/canvas`:

```sh
node scripts/check-metadata-codecs.mjs /path/to/@napi-rs/canvas /path/to/private-qa-output
python scripts/check-metadata-pillow.py /path/to/private-qa-output
node scripts/check-target-codecs.mjs /path/to/@napi-rs/canvas
```

The Python check requires Pillow. The optional output directory contains only
generated, original synthetic test pictures. These are not user photos and are
not published with the app. Neither test library is a browser runtime dependency.

## Limits of verification

These are DOM simulation and native-codec integration checks, not new live-browser
interaction, visual, mobile-device or cross-browser certification. Existing browser
coverage remains recorded in the earlier release notes. No maximum-batch stress
test, full accessibility audit or exhaustive camera/maker-note compatibility claim
is made. Unknown vendor metadata with non-standard offset conventions may behave
differently in other software. Keep originals and check exported copies in the
application where you intend to use them.
