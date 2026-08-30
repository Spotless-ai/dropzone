# Browser QA — 2026-08-30

Local production preview only. No public deployment or release approval.
Browser: Codex in-app browser on Windows; exact engine/version not recorded.
These results do not establish Chrome, Edge, Firefox or Safari compatibility.

## Defect and fix

Clearing the selection disabled the focused Clear button, leaving focus on the
document body. A corrupt-image worker failure also left focus on the body.
Clear now focuses Choose files; reported errors focus the error paragraph
(`tabindex="-1"` keeps it outside normal tab order). Starting processing focuses
Cancel. Existing successful completion and cancellation focus remain intact.
No format, conversion, privacy, license or visual styling changes.

## Checks completed

Synthetic fixtures only: 640 × 480 transparent PNG, 640 × 480 JPEG, plain text,
a deliberately corrupt PNG, and 64 MiB of generated random bytes.

- Real worker JPEG, PNG and WebP conversion completed for both images at a
  320-pixel longest edge. UI reported two 320 × 240 outputs for each format.
- PNG disabled the quality slider. PDF generation reported two A4 pages.
- PDF Move up changed the visible file order correctly when clicked.
- After rebuilding, corrupt PNG and mixed text/image processing showed useful
  errors, focused `error`, and produced no successful result panel.
- Clear removed the selection/results and focused `files`.
- Processing the 64 MiB ZIP fixture focused `cancel`. Clicking Cancel stopped
  the job, reported cancellation, and focused `run`.
- A subsequent small ZIP completed (two files, 561 bytes), proving recovery.
- Successful processing focused the results heading.
- At 390-pixel viewport width, content and client width both measured 375 pixels
  (scrollbar excluded). A 320-pixel screenshot showed legible wrapped controls,
  but content measured 320 versus a 305-pixel client area: minor horizontal
  overflow with the Windows scrollbar remains to investigate.
- No captured browser warning/error logs in the exercised flows. This is **not**
  a network audit.
- `npm run check`: 77 tests pass, TypeScript and production build pass, static
  CSP/relative-assets/license assertions pass, compiled ZIP worker smoke passes.
- `git diff --check` passes. Patch adds no dependencies, assets, telemetry or
  private fixture data; existing MIT/license notices are unchanged.

## Incomplete checks / limitations

Clicking Save for a generated JPEG did not produce an observable download event
within ten seconds. The page remained intact with no captured errors. Download
success is unverified; this may be a browser integration limitation or an app
issue. Do not equate a generated result link with a verified saved file.

The browser automation's Enter actions focused buttons but did not activate
them (including a native key attempt). Mouse-driven focus transitions were
verified; full keyboard activation and screen-reader announcements were not.

Saved output bytes/pixels, transparency, metadata removal, EXIF orientation,
independent ZIP/PDF interoperability, complete large-batch processing, timeout,
network behavior and named-browser compatibility remain release gates. The
64 MiB test establishes cancellation/recovery only, not batch completion.

Public scope still needs confirmation: this preview has image conversion,
ZIP creation and images-to-PDF, without video conversion or ZIP extraction.
