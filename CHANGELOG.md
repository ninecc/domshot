# Changelog

All notable changes to DOMShot are documented in this file.

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
