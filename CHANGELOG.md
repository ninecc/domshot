# Changelog

All notable changes to DOMShot are documented in this file.

## [0.2.2] - 2026-09-07

### Changed

- **build:** Reduce the packaged extension size by excluding development source maps from production builds

### Fixed

- **capture:** Capture the current visible area when a delayed capture starts instead of using an outdated viewport position
- **capture:** Preserve off-screen content, document backgrounds, and viewport coordinates when capturing horizontally scrollable pages
- **capture:** Prevent phantom pseudo-element borders and preserve content spacing when reconstructing styled pages
- **capture:** Preserve direct icon-font glyphs when web-font embedding is enabled, and report undecodable inline images instead of treating them as successfully loaded

## [0.2.1] - 2026-09-05

### Fixed

- **capture:** Keep capture progress visible without adding transparent padding to screenshots, and include page content that shares DOMShot UI identifiers
- **capture:** Preserve same-name page elements when opening or closing DOMShot controls and clean up inactive element pickers

## [0.2.0] - 2026-09-02

### Added

- **settings:** Manage output, post-capture actions, file naming, rendering options, language, and light or dark appearance in a dedicated settings panel
- **history:** Optionally keep up to 10 recent captures locally, with saving off by default, preview and reuse controls, undoable deletion, and clear-all management
- **capture:** Capture the current visible viewport alongside page elements and complete pages

### Changed

- **permissions:** Clarify how optional image-source access is requested, used, retained, and removed
- **i18n:** Use concise, natural English and Chinese across capture controls, settings, errors, permissions, and recent capture history

### Fixed

- **history:** Keep large recent captures available reliably across extension updates, repeated previews, deletion, and recovery
- **preview:** Keep preview controls stable on hover and show copy, download, and error feedback inside the relevant buttons

## [0.1.0] - 2026-08-26

Initial public release of DOMShot, a Chrome extension for capturing DOM elements and complete pages as images.

### Added

- **Capture:** Select an element directly on the page or capture the complete document, with live highlighting and element details before capture.
- **Export:** Generate PNG, JPG, or WebP images at 1×, 2×, or 3× output scale.
- **Preview:** Review captures in a page-level preview, then copy them to the clipboard or download them without leaving the current tab.
- **Rendering:** Optionally embed web fonts and enable precise layout reconciliation for improved text wrapping in inline and table content.
- **Image sources:** Detect cross-origin images that could not be embedded, request optional access only when needed, and retry the original capture after authorization.
- **Privacy:** Process captures locally without telemetry or image uploads, using active-tab access and optional image-source permissions.

### Fixed

- **Viewport stability:** Keep the selector and capture preview consistently sized and positioned across page zoom, pinch zoom, live zoom changes, and page scrolling.
- **Capture feedback:** Clearly report images that could not be loaded and show copy confirmation inside the action button without resizing the preview.
