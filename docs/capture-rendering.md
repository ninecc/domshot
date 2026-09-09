# Capture rendering contract

`capture-request.ts` distinguishes elements, pages and viewports. `captureGeometry` owns document CSS-pixel geometry and reads it when rendering starts, after any capture delay. Retries preserve the request, not an old viewport rectangle. `capture-renderer.ts` owns engine configuration; in-page progress, history and export actions remain presentation concerns.

- Element: preserve the selected element's rendering, transparency and nested scrollports.
- Page: capture document scroll bounds using the current viewport's layout. Do not resize the live viewport or expand nested scroll containers.
- Viewport: crop the same document coordinates to the current visual viewport exactly once. The crop uses the smaller positive visual-viewport and root client dimensions, so pinch zoom remains authoritative while classic layout scrollbars stay outside the image.
- Fixed/sticky content is captured at its observed position in document coordinates, once. A page capture is not a simulation of scrolling through the page.
- Capture is a rendering of currently available DOM/resources, not an atomic browser snapshot. It does not drive infinite scrolling or guarantee that unloaded content exists.

## Document adapter

`document-capture.ts` separates viewport scrolling from nested scrollports. It removes only auto/scroll clipping propagated to the viewport, retaining explicit hidden/clip and independent body scrolling. It moves the propagated document background to a separate layer. The original positioning area is retained while transparent borders extend the painting area, so repeating gradients are not resized with the output canvas. Background resource URLs are copied after embedding. The original background is removed from its source clone to avoid double-compositing alpha.

CSS background propagation: https://www.w3.org/TR/css-backgrounds-3/#special-backgrounds

## Engine compatibility

DOMShot pins SnapDOM 2.24.17. `scripts/snapdom-compat.mjs` applies version-guarded build-time fixes without editing the installed package. The build rejects an unexpected dependency version, a moved patch location, or a missing compatibility entry. Every retained patch has a focused regression and an explicit removal condition:

| Compatibility fix | Upstream status | Regression / removal condition |
| --- | --- | --- |
| Do not wrap document-scrolling `html` / `body` roots as nested scrollers | Not filed. [#393](https://github.com/zumerlab/snapdom/issues/393) is related iframe scroll work, not the same top-level document case. | `a body that participates in document scrolling is not frozen as a nested scroller`; remove when it passes against unpatched SnapDOM. |
| Embed an icon-font family and resource when ordinary captured text still uses it | Related [#146](https://github.com/zumerlab/snapdom/issues/146). The [#493](https://github.com/zumerlab/snapdom/issues/493) fix in 2.24.16 prevents one Symbols family from discarding an entire mixed stylesheet, but still filters individual icon families. | `loaded icon fonts retain direct glyphs alongside pseudo-element icons`; remove when it passes unpatched. |
| Apply computed `font-style` when a one-character PUA pseudo-element is rasterized through canvas | Not filed. | `icon fonts select the matching face when one PUA codepoint has multiple glyphs`; remove when it passes unpatched. |
| Skip non-generated `::before` / `::after` boxes with `display:none` or `content:none/normal` | Not filed. Existing [#418/#419](https://github.com/zumerlab/snapdom/pull/423) cover the opposite case: valid empty generated boxes. | `only generated pseudo-elements contribute decoration to captures`; remove when it passes unpatched. |

The scroll patch changes only roots explicitly supplied by the document adapter; ordinary elements and nested containers keep upstream behavior. The three unfiled cases have submit-ready minimal fixtures in the named tests. On each future SnapDOM upgrade, disable one patch at a time, run its focused regression, and remove it only when the unpatched dependency satisfies the same contract.

The CSS background adapter is a different seam rather than a source patch. SnapDOM 2.24.17 correctly preserves CORS-accessible multi-layer backgrounds, while DOMShot supplies Chrome host-permission resolution, redirect-aware origins, resource limits and failure reporting. It should be reduced when SnapDOM exposes a host-level resource resolver; its product permission policy remains in DOMShot.

## Verification

Tests must assert content and coordinates independently of alpha: an opaque blank image is not successful capture. Controlled fixtures cover document scrolling, nested clipping, page/viewport output, intentional transparency, and background positioning. Website reproductions supplement those fixtures and do not define site-specific branches.

The visible-area contract includes classic non-overlay scrollbars: the crop excludes layout space occupied by those scrollbars while a smaller visual viewport remains authoritative during pinch zoom. The automated fixture reproduces the browser geometry seam (`visualViewport` 800×600 versus root client area 785×585), and separate CDP coverage verifies 2× pinch zoom at 400×300. The current macOS test host uses overlay scrollbars, so native Windows scrollbar painting has not been visually exercised on this host.

## Image and icon-font resources

Font embedding must not skip a required font or its source URL merely because its name contains `icon`, `glyph` or `symbols`. The compatibility patch removes those exclusions only within the font-embedding pipeline; existing pseudo-element and Material icon rasterization remain unchanged. Used-family selection, unicode ranges, explicit font exclusions and the user's `embedFonts` setting still apply. This does not add a font proxy or promise support for unreadable stylesheets or dynamic font sources unavailable to the engine.

Before rendering, tracked inline images must decode successfully with nonzero intrinsic dimensions. Decode work is deduplicated per data URL and limited to six concurrent decoders, each with a three-second deadline. Load, decode and timeout failures are recorded separately. Invalid/timeout data images receive a size-preserving placeholder; only confirmed host-permission failures participate in the permission-retry flow.

HTTP(S) `background-image` URLs actually used by captured elements and generated `::before`/`::after` boxes share the image resolver's deduplication, concurrency and 64-URL boundary. The boundary applies once across inline images and backgrounds for the capture: URLs beyond it are not paged or proxied in that capture and are reported as missing without offering authorization. Successful proxy responses replace only their CSS `url()` tokens; each replacement is merged into the engine's current layer so other layers already inlined through CORS remain intact. Multi-layer order and the browser-computed position, size, repeat, origin, clip, attachment and blend values remain unchanged, including sprite crops and propagated document backgrounds. Data URLs stay on SnapDOM's native path, and an already-inlined generated background is not requested again. Same-origin HTTP(S) entries are still submitted so a redirect to a different CDN origin can return the precise permission target; if the engine resolves them directly, they are not reported as failures. Permission failures are retryable; fetch, timeout, size, format and URL-limit failures are reported without requesting broader access. Discovery uses computed styles and clone mappings, not direct stylesheet-rule access, so cross-origin stylesheets do not need to be readable. This still does not proxy masks, border images, fonts, URLs hidden inside an SVG, or generated content other than `::before`/`::after` backgrounds.

`capture-resources.test.mjs` uses an original 720-byte fixture font mapping U+E001 to a filled triangle. It tests element capture (so the document's original font stylesheet cannot hide missing embedding), mixed direct/pseudo use, two scales, and valid/invalid inline PNG and SVG resources. The fixture contains no third-party font data.

## Generated content and style isolation

`::before`/`::after` with `content: none` or `normal`, and pseudos with `display: none`, do not generate a painted box. The engine compatibility patch enforces that boundary while retaining empty-string decorations and first-letter styling.

`snapshot-styles.ts` removes mapped source HTML stylesheets immediately before rendering, after clone and resource plugins have inspected the tree. Source selectors must not reapply to a reconstructed tree containing synthetic pseudo-element nodes. Engine styles/font embeddings and SVG styles are retained. Tests protect visible decorations and meaningful content spacing; the product does not promise pixel-identical browser screenshots.
