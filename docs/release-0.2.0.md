# DropZone 0.2.0 — target-size compression

Date: 2026-08-30.

## Added

An optional per-image byte ceiling in the existing Images tool. JPEG/WebP
quality is adjusted automatically. Smaller dimensions require an explicit
checkbox; PNG only resizes, never switches formats or pretends that its
quality setting reduces size. The UI reports final dimensions, exact output
bytes versus the maximum, encoder quality when applicable and automatic resizing.

No additional production dependencies, uploads, analytics or storage. ZIP and
PDF processing are unchanged. The MIT license is unchanged.

## Automated checks

- 123 tests pass, including target-input validation, exact boundary handling,
  bounded quality/dimension search, PNG behavior, resize opt-in, the 256px
  automatic floor, unsupported encoders, empty output and codec errors.
- Conversion-control tests establish single decoding, reuse of the canvas
  between quality attempts, drawing from the original bitmap after resizing
  and cleanup after failure. Those APIs are mocked, not browser-certified.
- Worker protocol tests cover exact result details, per-image batch ceilings,
  progress messages, defensive rejection of oversized results, all-or-nothing
  failure, and separation from PDF settings.
- TypeScript, the production build, CSP/local-asset/license assertions and
  the compiled ZIP worker smoke check pass.
- The full npm audit reported no vulnerabilities on this date. This does not
  prove the absence of security issues.

## Real-codec integration check

`scripts/check-target-codecs.mjs` executes the actual production worker bundle
with a Node canvas adapter backed by Skia, using a deterministic synthetic
1600 × 1000 transparent/textured image. Outputs are reopened with Skia and
checked for dimensions, transparency/white JPEG background and exact size.
This is an independent native-codec check, **not a browser compatibility test**.

Observed outputs from a 4,107,309-byte PNG:

| Output | Maximum | Result | Dimensions |
| --- | ---: | ---: | --- |
| JPEG, resizing allowed | 100,000 bytes | 97,990 bytes | 980 × 613 |
| WebP, resizing allowed | 100,000 bytes | 99,286 bytes | 775 × 484 |
| JPEG, 800px initial edge, resizing allowed | 20,000 bytes | 19,819 bytes | 460 × 288 |
| WebP, 800px initial edge, resizing allowed | 20,000 bytes | 19,884 bytes | 338 × 211 |
| PNG, resizing allowed | 100,000 bytes | 96,718 bytes | 256 × 160 |

The script also covers already-fitting files, quality-only compression, rejected
1 KB targets, PNG's resize limit, repeated inputs with independent ceilings,
invalid targets rejected before decoding and unchanged original bytes. These
numbers are fixture/encoder-specific, not promised compression ratios.

To repeat locally, build first and provide a separately installed test-only
`@napi-rs/canvas` module path (or omit the path if locally resolvable):

```sh
npm run check
node scripts/check-target-codecs.mjs /absolute/path/to/@napi-rs/canvas
```

The adapter is not installed or shipped with DropZone. Routine CI runs the
unit/control/protocol tests without the optional native-codec dependency.

## Remaining verification

The target controls and codec loop have not been exercised in a live browser
for this release. The 0.1.0 browser checks remain historical, not evidence of
this feature's UI compatibility. Standalone browser testing, mobile memory
pressure, maximum-size batches, screen-reader behavior and perceptual quality
across varied real photographs remain follow-up work. If a browser cannot
encode a selected format or meet the limit, DropZone reports the failure and
does not substitute an oversized result.
