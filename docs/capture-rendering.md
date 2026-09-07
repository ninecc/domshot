# Capture rendering contract

`capture-request.ts` distinguishes elements, pages and viewports. `captureGeometry` owns document CSS-pixel geometry and reads it when rendering starts, after any capture delay. Retries preserve the request, not an old viewport rectangle. `capture-renderer.ts` owns engine configuration; in-page progress, history and export actions remain presentation concerns.

- Element: preserve the selected element's rendering, transparency and nested scrollports.
- Page: capture document scroll bounds using the current viewport's layout. Do not resize the live viewport or expand nested scroll containers.
- Viewport: crop the same document coordinates to the current visual viewport exactly once.
- Fixed/sticky content is captured at its observed position in document coordinates, once. A page capture is not a simulation of scrolling through the page.
- Capture is a rendering of currently available DOM/resources, not an atomic browser snapshot. It does not drive infinite scrolling or guarantee that unloaded content exists.

