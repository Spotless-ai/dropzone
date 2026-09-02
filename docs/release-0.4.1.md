# DropZone 0.4.1 — phone HDR JPEG metadata cleanup

Verified 2 September 2026. This patch fixes metadata removal for a valid JPEG
structure used by current phone cameras. Some Apple and Android HDR JPEGs append
vendor data to the JFIF header and store a gain map or another auxiliary image
through an MPF index. DropZone previously rejected that structure before making
a cleaned copy.

## Changed behavior

- A valid JFIF header may contain vendor bytes after its declared thumbnail.
  DropZone keeps the standard density fields and removes both the thumbnail and
  the extra vendor bytes.
- An MPF index is removed instead of causing the batch to fail. The cleaned JPEG
  ends at the primary image's EOI marker, so the legacy-compatible SDR photo is
  kept byte-for-byte while appended gain maps, depth maps or extra pictures are
  discarded.
- The result row says when auxiliary picture data was removed. The interface and
  README explain that HDR display, depth or refocus behavior can be lost.
- Malformed segment lengths, missing image scans, unfinished JPEGs and the prior
  PNG/WebP checks still fail without returning a partial batch.

This remains container-only metadata removal: the primary encoded JPEG scan is
not decoded or re-encoded. The original file is never changed.

## Checks completed

- All **223 automated tests** pass, including a regression that combines an
  Apple-style JFIF extension, MPF metadata and an appended auxiliary JPEG. The
  expected output contains only the original primary scan and canonical JFIF
  display header, with all injected private markers absent.
- TypeScript, production build, relative-asset, local-worker, restrictive-CSP,
  license-notice and compiled ZIP-worker checks pass.
- Two real Apple gain-map JPEG fixtures from Google's `libultrahdr` test suite
  reproduce the previous exact error on 0.4.0. Both now clean successfully to a
  384 × 512 JPEG. Their 50,824-byte and 50,742-byte inputs produce the same
  41,925-byte primary SDR image with SHA-256
  `ce61b2f4c4048e510a80da955d5764344520ae4541fb677d2b9a2f68878335f6`.
- The actual browser workflow processed both fixtures and offered separate
  `-clean.jpg` downloads. The downloaded bytes exactly matched the direct parser
  output, opened as the expected photo, retained `ICC_PROFILE`, and contained no
  `MPF`, `AMPF`, EXIF, XMP or injected test-private marker.
- The test fixtures and downloaded results were used only for local verification
  and are not included in the repository or release.

## Limits

This patch deliberately converts a multi-picture/HDR JPEG into its compatible
primary SDR JPEG during metadata removal. It does not preserve an HDR gain map,
depth image, refocus data or burst/stereo auxiliary picture. HEIC, HEIF, AVIF,
RAW, animation and malformed metadata remain unsupported. Keep originals and
check the cleaned copy before sharing it.

Format references:

- [Android Ultra HDR image format](https://developer.android.com/media/platform/hdr-image-format)
- [Google libultrahdr reference codec and fixtures](https://github.com/google/libultrahdr)
- [JFIF structure](https://www.w3.org/Graphics/JPEG/jfif3.pdf)
