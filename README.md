# DOMShot

English · [简体中文](./README_CN.md)

DOMShot is a Chrome Manifest V3 extension for capturing individual DOM elements or complete pages as PNG, JPG, and WebP images.

**Powered by [SnapDOM](https://snapdom.dev/).** DOMShot uses [`@zumer/snapdom`](https://www.npmjs.com/package/@zumer/snapdom) as its DOM rendering and image generation engine. DOMShot is an independent project and is not an official ZumerLab or SnapDOM product, nor is it endorsed by them.

## Features

- Highlight and inspect elements before capturing them.
- Capture exactly what is visible in the current viewport.
- Capture one element or the complete page DOM.
- Export PNG, JPG, or WebP at 1×, 2×, or 3× scale.
- Preview, copy, and download images without leaving the page.
- Optionally keep up to 10 recent captures locally for previewing, copying, downloading, or deleting; saving is off by default and the oldest capture is removed automatically at the limit.
- Save or remove an individual capture from its preview or post-copy/download notice without changing the global history preference; when history is turned off, choose whether to keep or delete existing captures.
- Keep extension UI stable across browser page zoom and pinch zoom.
- Process images locally in the browser without uploading them.

## Install from source

Requirements: Node.js 20.11+ and Google Chrome 120+.

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory.

Open DOMShot on a regular web page, choose **Capture element**, **Capture visible area**, or **Capture full page**, then copy or download the result from the in-page preview. Press `Esc` to leave element selection.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Format | PNG | PNG preserves transparency; JPG and WebP use a white background. |
| Scale | 2× | Multiplies the exported pixel dimensions by 1×, 2×, or 3×. |
| JPG/WebP quality | 92% | Controls lossy export quality and appears only for JPG or WebP. |
| Language | Auto | Uses Chinese for Chinese browser locales and English otherwise; a manual choice overrides the browser. |
| Appearance | Auto | Follows the system theme or forces Light or Dark across popup, preview, selector, toast, and permission UI. |
| After capture | Preview | Shows the preview, copies automatically, or downloads automatically after a successful capture. |
| File names | Smart | Uses the page title for full pages and the element label for element captures; page-title and timestamp-only modes are also available. |
| Add captures to history automatically | Off | Keeps up to 10 captures in this browser for quick access. Individual captures can still be added from the preview; turning this off offers to keep or delete existing captures. |
| Embed web fonts | On | Improves custom font fidelity, with additional processing time. |
| Reconcile layout | Off | Improves text wrapping in inline and table-cell elements, but can roughly double capture time. |
| Keep outer shadows | Off | Includes shadows and outlines around the captured root element. |
| Optimize embedded images | On | Downsamples embedded raster images to their displayed resolution to reduce file size. |
| Capture delay | None | Waits 0.5, 1, or 2 seconds before capture for pages that need time to settle. |

Settings are saved automatically.

## Privacy and permissions

DOMShot does not request persistent access to every website and contains no telemetry or image-upload service. Recent capture saving is off by default. When enabled, up to 10 captures stay in local browser storage, are removed when the extension is uninstalled, and can be cleared at any time from Recent captures.

- `activeTab`: access the current tab after a user action.
- `scripting`: inject the capture script when requested.
- `storage`: remember capture settings.
- `clipboardWrite`: copy generated images.

## Development and tests

```bash
npm run dev       # rebuild on source changes
npm run typecheck # check TypeScript
npm test          # build and run browser behaviour tests
npm run check     # typecheck, changelog validation, and tests
```

Browser tests use `puppeteer-core` with the locally installed Chrome. Set `DOMSHOT_CHROME_PATH` to use another Chrome or Chromium executable. See [test/README.md](./test/README.md) for details.

## Changelog and releases

Every pull request must add a reviewed JSON fragment under [`.changes`](./.changes/README.md), or use the `changelog: skip` label for internal-only work. Fragments describe observable user results and are schema checked by `npm run changelog:check`; contributors do not edit `CHANGELOG.md` directly.

To prepare a release locally:

```bash
npm run release:prepare -- 0.2.0
```

The command validates and consumes all fragments, writes the new [`CHANGELOG.md`](./CHANGELOG.md) section, and synchronizes the version in `package.json`, `package-lock.json`, and `public/manifest.json`. The **Prepare release** GitHub workflow performs the same operation and opens a `release/v*` pull request for review.

Repository maintainers must create the `changelog: skip` label, allow GitHub Actions to create pull requests, and protect `main` with the `CI / check` status check. The release workflow explicitly dispatches CI for its generated pull request.

## Limitations

- Protected pages such as `chrome://` pages and extension stores do not allow script injection.
- Cross-origin images and fonts without suitable CORS headers may not be embedded.
- Very large pages are limited by browser memory and maximum Canvas dimensions.
- Video, Canvas, WebGL, animations, and highly dynamic content may differ from the visible page.

## License

DOMShot is released under the [MIT License](./LICENSE), which is also included in every build.

SnapDOM is provided by ZumerLab under the MIT License. Its copyright notice and license are included in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and copied into every build.
