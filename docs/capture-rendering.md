# Capture rendering contract

`capture-request.ts` distinguishes elements, pages and viewports. `captureGeometry` owns document CSS-pixel geometry and reads it when rendering starts, after any capture delay. Retries preserve the request, not an old viewport rectangle. `capture-renderer.ts` owns engine configuration; in-page progress, history and export actions remain presentation concerns.

- Element: preserve the selected element's rendering, transparency and nested scrollports.
- Page: capture document scroll bounds using the current viewport's layout. Do not resize the live viewport or expand nested scroll containers.
- Viewport: crop the same document coordinates to the current visual viewport exactly once.
- Fixed/sticky content is captured at its observed position in document coordinates, once. A page capture is not a simulation of scrolling through the page.
- Capture is a rendering of currently available DOM/resources, not an atomic browser snapshot. It does not drive infinite scrolling or guarantee that unloaded content exists.

## Document adapter

`document-capture.ts` separates viewport scrolling from nested scrollports. It removes only auto/scroll clipping propagated to the viewport, retaining explicit hidden/clip and independent body scrolling. It moves the propagated document background to a separate layer. The original positioning area is retained while transparent borders extend the painting area, so repeating gradients are not resized with the output canvas. Background resource URLs are copied after embedding. The original background is removed from its source clone to avoid double-compositing alpha.

CSS background propagation: https://www.w3.org/TR/css-backgrounds-3/#special-backgrounds

## Engine compatibility

SnapDOM 2.24.10 wraps scrolled nodes, including document roots, in a translated and clipped element. This duplicates document-level scrolling/cropping. Public after-clone hooks are too late to prevent that wrapper.

`scripts/snapdom-compat.mjs` patches the scroll decision at build time for roots explicitly provided by the document adapter. Ordinary elements/nested containers use upstream behavior. The installed package is not edited. The dependency is pinned; the build rejects an unexpected version or patch location. When upgrading, re-evaluate and remove the patch if upstream fixes this behavior. No upstream report has been submitted yet.

## Verification

Tests must assert content and coordinates independently of alpha: an opaque blank image is not successful capture. Controlled fixtures cover document scrolling, nested clipping, page/viewport output, intentional transparency, and background positioning. Website reproductions supplement those fixtures and do not define site-specific branches.

## Image and icon-font resources

Font embedding must not skip a required font or its source URL merely because its name contains `icon`, `glyph` or `symbols`. The compatibility patch removes those exclusions only within the font-embedding pipeline; existing pseudo-element and Material icon rasterization remain unchanged. Used-family selection, unicode ranges, explicit font exclusions and the user's `embedFonts` setting still apply. This does not add a font proxy or promise support for unreadable stylesheets or dynamic font sources unavailable to the engine.

Before rendering, tracked inline images must decode successfully with nonzero intrinsic dimensions. Decode work is deduplicated per data URL and limited to six concurrent decoders, each with a three-second deadline. Load, decode and timeout failures are recorded separately. Invalid/timeout data images receive a size-preserving placeholder; only load failures with HTTP(S) sources participate in the existing permission-retry flow. This validates image decoding, not every nested dependency inside an SVG, and does not add coverage for fonts, CSS backgrounds or all generated images to the failure report.

`capture-resources.test.mjs` uses an original 720-byte fixture font mapping U+E001 to a filled triangle. It tests element capture (so the document's original font stylesheet cannot hide missing embedding), mixed direct/pseudo use, two scales, and valid/invalid inline PNG and SVG resources. The fixture contains no third-party font data.
