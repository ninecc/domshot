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

## Structure

- `popup.test.mjs` verifies computed popup layout and interaction styles in Chrome.
- `content-preview.test.mjs` verifies content-script takeover, capture dimensions, zoom compensation, cross-origin image warnings, and authorized retries.
- `permission.test.mjs` verifies that a declined host permission can be requested again and resumes the capture after approval.
- `background-zoom.test.mjs` verifies tab zoom forwarding, exact-origin permission state, and background image resolution.
- `support/chrome-page.mjs` owns browser launch, page setup, CDP access, waiting, and cleanup behind the `withChromePage` interface.

Puppeteer is preferred here because DOMShot targets Chrome MV3, uses CDP-specific zoom emulation, and keeps `node:test` as the single test runner. A migration to Playwright would make sense if the project later needs multi-browser projects, tracing, or a larger end-to-end suite.
