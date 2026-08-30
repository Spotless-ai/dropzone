# DropZone 0.1.0 verification

Date: 2026-08-30. Public browser-edition scope approved: still-image conversion,
ZIP creation and images-to-PDF. No video, ZIP extraction or desktop feature parity.

## Saved outputs, not just result links

The production build was exercised in the Codex in-app browser on Windows.
Exact embedded engine/version was not available; this is not a standalone
Chrome/Edge/Firefox/Safari certification. All fixtures were synthetic.

- JPEG, PNG and WebP downloads saved successfully and reopened with Pillow.
- A 320 × 200 transparent PNG became opaque white-background JPEG. PNG and
  WebP outputs retained zero-alpha pixels in the transparent region.
- A JPEG with EXIF orientation 6 became 60 × 100 from a stored 100 × 60 image.
  Expected corner colors confirmed the rotation. Original EXIF fields and the
  synthetic description marker were absent from the downloaded JPEG.
- A three-entry ZIP reopened with Python's independent `zipfile` reader.
  CRC checks passed, duplicate filenames received a numbered suffix, and all
  decompressed bytes matched their source files.
- The downloaded PDF reopened in `pypdf` and Poppler. It contained two A4 pages,
  landscape followed by portrait, each with one image and no text layer.
  Both pages were rendered and visually checked for orientation and clipping.
- No warning/error logs were captured in these production-build flows.

The earlier download-event timeout did not mean the save failed: its JPEG was
found in Downloads. New test saves were verified directly on disk.

## Existing verification retained

- 77 automated core tests, TypeScript/build, static CSP/local asset/license
  assertions, and the compiled production ZIP worker smoke test.
- Corrupt/mixed-image errors, selection clearing, PDF reorder and focus recovery.
- Cancellation of a 64 MiB synthetic ZIP input followed by a successful small
  ZIP. This establishes cancellation, not large-batch completion.
- 320px and 390px layouts have no measured horizontal overflow; desktop layout
  checked. More details in the dated browser and interface QA notes.
- No reported vulnerabilities in the full npm dependency audit on this date.
  This is not a guarantee that the app or dependencies have no vulnerabilities.
- MIT app license and complete notices for bundled dependencies are distributed.

## Limits of this verification

No claim of exhaustive metadata removal/anonymity, exact color-profile retention,
maximum-batch performance, certified accessibility or universal browser support.
Standalone named-browser and full keyboard/screen-reader checks remain open.
The local-processing claim is supported by source inspection, worker architecture
and a restrictive production CSP; a comprehensive network capture was not made.
The app does not scan input files for malware and does not implement an offline
cache. Preserve original files and inspect outputs before relying on them.

Older QA notes describe the state at the time they were written. This note
supersedes their saved-download uncertainty and pending public-scope approval.
