# Tests

DOMShot uses Node's built-in test runner and `puppeteer-core` for Chrome behaviour tests.

## Run

```bash
npm test
```

The command builds `dist/` first, then runs test files serially so Chrome instances do not compete for resources. `npm run check` runs the TypeScript check before the same test suite.

## Browser requirement

Tests use the locally installed stable Google Chrome through Puppeteer's `chrome` channel. `puppeteer-core` is intentionally used instead of the full `puppeteer` package, so dependency installation does not download a large browser binary or depend on access to the Chrome for Testing CDN.

To run against Chrome for Testing, Chromium, or a non-standard installation, provide its executable path:

```bash
DOMSHOT_CHROME_PATH=/absolute/path/to/chrome npm test
```

CI must either install Google Chrome or set `DOMSHOT_CHROME_PATH` to a provisioned browser executable.

## Tooling rationale

Puppeteer is preferred here because DOMShot targets Chrome MV3, uses CDP-specific zoom emulation, and keeps `node:test` as the single test runner. A migration to Playwright would make sense if the project later needs multi-browser projects, tracing, or a larger end-to-end suite.

## Structure

- `popup.test.mjs` verifies computed popup layout and interaction styles in Chrome.
- `content-preview.test.mjs` verifies content-script takeover, capture dimensions, zoom compensation, cross-origin image warnings, and authorized retries.
- `ui-host.test.mjs` verifies UI ownership, replacement, and picker disposal without affecting same-name page elements.
- `content-ui-isolation.test.mjs` verifies that extension UI stays out of captures without changing dimensions, removing same-name page elements, or trimming intentional transparency.
- `permission.test.mjs` verifies that a declined host permission can be requested again and resumes the capture after approval.
- `background-zoom.test.mjs` verifies tab zoom forwarding, exact-origin permission state, and background image resolution.
- `build-artifacts.test.mjs` verifies that production packages exclude development source maps and remain within their size budget.
- `support/chrome-page.mjs` owns browser launch, page setup, CDP access, waiting, and cleanup behind the `withChromePage` interface.

- `capture-request.test.mjs` verifies that delayed viewport captures use the viewport at render time.
- `document-capture.test.mjs` verifies document overflow, viewport coordinates, nested clipping and background transparency/positioning.

- `capture-resources.test.mjs` verifies direct and pseudo-element icon glyphs plus inline-image decoding and permission behavior.
- `pseudo-elements.test.mjs` verifies generated-content visibility and prevents source selectors from collapsing spacing after cloning.
## Assertion principles

1. **Assert contracts, not representations.** Tests should protect promised behaviour and outcomes without depending on incidental DOM structure, styling techniques, or serialization details.
2. **Match strictness to contract strength.** Discrete state, data integrity, and safety boundaries deserve exact assertions; rendering, animation, and timing behaviour require appropriate tolerance.
3. **Be sensitive to regressions and tolerant of intentional evolution.** Tests should catch real degradation without obstructing copy changes, visual iteration, or equivalent refactoring.
4. **Prefer semantic relationships.** Compare state transitions, relative relationships, and structured meaning before raw strings, absolute pixels, or implementation order.
5. **Make failures identify one contract.** Each test should have a clear purpose, and a failure should point directly to the user behaviour or system guarantee that broke.
6. **Prove regression tests can detect the symptom.** Reproduce the failure before applying a fix, then use the same signal to verify the fix.
7. **Control uncertainty explicitly.** Normalize or tolerate known variation from fonts, browser rendering, and asynchronous timing instead of relying on accidental stability.

## Application notes

- Popup and preview layout comparisons currently use a `0.5 CSS px` tolerance. Exported image pixel dimensions remain exact.
- Structured values such as URLs are parsed before comparison; parameter ordering is not part of the contract.
- Localized UI tests verify language selection, semantic state, and layout stability. Full copy is matched only when the wording itself is a product contract.
- Interaction tests verify visible state changes and stable geometry without binding to exact RGB values unless a color token is explicitly under test.
- Regression tests should first fail on the reported symptom, then pass after the fix.
