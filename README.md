# DropZone Web

Local image conversion, ZIP creation and images to PDF, without an installer.

[Open DropZone](https://spotless-ai.github.io/dropzone/) · [Report a problem](https://github.com/Spotless-ai/dropzone/issues)

Free and open source. Choose a tool, add your files, adjust the output settings, and download the results. No account or installation required.

## Tools

- Convert still JPEG, PNG and WebP images to JPEG, PNG or WebP; optionally reduce the longest edge. Images are never enlarged.
- Choose JPEG/WebP quality. PNG encoding is lossless; a smaller file is not guaranteed.
- Create a ZIP from selected files. Duplicate names get numbered suffixes instead of overwriting one another. Exported names are flattened and made portable; file contents are unchanged.
- Put selected images into an A4 or US Letter PDF, one image per page, with explicit ordering controls. Landscape images get landscape pages.
- Cancel processing by terminating its worker. A two-minute processing timeout prevents an indefinitely running task.
- Save generated files individually. Original files are not modified.

This is the browser edition, not a feature-for-feature port of the desktop app. Video conversion and ZIP extraction are **not implemented**. Animated images, SVG, GIF, HEIC, RAW, PDF editing, searchable/OCR text and folder selection are not supported.

## Image handling

Image headers are checked before decoding to enforce size limits and reject supported animation containers. The browser decodes and redraws accepted images. Original EXIF, GPS, IPTC and XMP fields are not copied. This is not a comprehensive anonymity guarantee: visible information remains, and an encoder may write technical metadata of its own. Browser color management may change color profiles or pixel values.

JPEG outputs use a white background for transparent pixels. PDF images are re-encoded to JPEG at 92% quality with a maximum 2400-pixel edge and a white background. PDF creation therefore is not lossless; it is intended for convenient image documents, not archival scans.

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

Image tools require `OffscreenCanvas`, `createImageBitmap` and workers. Unsupported encoding produces a visible error; it does not silently return a different format.

The first release was tested in the Codex in-app browser on Windows. Saved JPEG, PNG, WebP, ZIP and PDF outputs were independently reopened. The checks covered transparency, an EXIF orientation fixture, metadata omission, duplicate ZIP names, PDF page orientation, error recovery and cancellation. Responsive checks covered 320px, 390px and desktop widths. See [release verification](docs/release-0.1.0.md).

This is an early release, not a claim of universal browser compatibility. Standalone Chrome, Edge, Firefox and Safari testing, full keyboard/screen-reader testing, exhaustive color-profile/metadata checks and maximum-sized batches remain follow-up work. Original files are never overwritten. Keep your originals and check the result before sharing it.

## Feedback

When reporting a problem, include your browser/version, operating system, chosen tool, approximate file size and the error text. Use a small synthetic example if possible; **do not post private files or sensitive screenshots** in public issues.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`. Runtime dependencies are bundled locally. Their license notices are included in the production build.
