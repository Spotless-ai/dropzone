# DropZone Web

Local image conversion, ZIP creation and images to PDF, without an installer.

**Unpublished preview.** This is a new browser implementation, not a verified port of the desktop DropZone app. There is no public web release yet.

## Included in this preview

- Convert still JPEG, PNG and WebP images to JPEG, PNG or WebP; optionally reduce the longest edge. Images are never enlarged.
- Choose JPEG/WebP quality. PNG encoding is lossless; a smaller file is not guaranteed.
- Create a ZIP from selected files. Duplicate names get numbered suffixes instead of overwriting one another. Exported names are flattened and made portable; file contents are unchanged.
- Put selected images into an A4 or US Letter PDF, one image per page, with explicit ordering controls. Landscape images get landscape pages.
- Cancel processing by terminating its worker. A two-minute processing timeout prevents an indefinitely running task.
- Save generated files individually. Original files are not modified.

Video conversion and ZIP extraction are **not implemented**. Animated images, SVG, GIF, HEIC, RAW, PDF editing, searchable/OCR text and folder selection are not supported. Adding these is not implied by the preview.

## Image handling

Image headers are checked before decoding to enforce size limits and reject supported animation containers. The browser decodes and redraws accepted images. Original EXIF, GPS, IPTC and XMP fields are not copied. This is not a comprehensive anonymity guarantee: visible information remains, and an encoder may write technical metadata of its own. Browser color management may change color profiles or pixel values.

JPEG outputs use a white background for transparent pixels. PDF images are re-encoded to JPEG at 92% quality with a maximum 2400-pixel edge and a white background. PDF creation therefore is not lossless; it is intended for convenient image documents, not archival scans.

## Privacy and limits

File processing happens in a dedicated browser worker. There is no upload endpoint, account, telemetry, external font or runtime CDN dependency. Files and outputs are kept in memory, not IndexedDB or local storage. Navigating away clears the selection and generated download URLs.

Loading the app makes ordinary requests to its host. The production page uses a Content Security Policy with `connect-src 'none'`; development permits same-origin connections for hot reload. Source inspection and build assertions check these properties; a real-browser network audit remains a release requirement. No offline service worker/cache is included yet.

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

The build produces static files in `dist/`, with relative asset paths for GitHub Pages. A manually triggered Pages workflow is provided, but no remote repository or Pages deployment has been created. Do not publish until the release checklist is complete and first-release scope is confirmed.

## Before a public release

- Confirm which desktop features the first browser release should include, especially video and ZIP extraction.
- Test actual conversion, metadata behavior, image orientation/color, transparency, corrupt input, cancellation and downloads in current Chrome, Edge, Firefox and Safari. Record versions; do not claim support for untested browsers.
- Check mobile layouts, keyboard operation, focus, screen-reader announcements and real-browser network activity.
- Try small and large real files, malformed/animated files, duplicate names, ZIP interoperability and PDF output in independent readers.
- Review the final license/security notices and generated files for unintended personal data.
- Remove the preview/noindex markers only when ready; configure GitHub Pages and verify the deployed URL and asset paths.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`. Runtime dependencies are bundled locally. Their license notices are included in the production build.
