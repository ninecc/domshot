import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withChromePage } from './support/chrome-page.mjs';

const contentBundle = await readFile(resolve(import.meta.dirname, '../dist/content.js'), 'utf8');
const fixtureUrl = 'data:text/html,<main><h1>DOMShot zoom test</h1><p>Stable capture content</p></main>';

test('content preview remains stable across script updates and zoom changes', async (context) => {
  await withChromePage({ url: fixtureUrl }, async (page) => {
    await context.test('replaces a stale injected content script', async () => {
      await page.evaluate(`
        window.__domShotLoaded = true;
        chrome.runtime = {
          onMessage: {
            addListener(listener) { globalThis.__domshotListener = listener; },
            removeListener() {}
          }
        }`);
      await page.evaluate(contentBundle);
      assert.equal(await page.evaluate('typeof globalThis.__domshotListener'), 'function');
    });

    let baseline;
    await context.test('keeps size, placement, and capture dimensions across page and pinch zoom', async () => {
      const results = [];
      for (const pageZoom of [0.5, 0.8, 1, 1.25, 1.5, 2]) {
        for (const pinchZoom of [1, 1.5, 2]) {
          await page.setPageScale(pinchZoom);
          await capturePage(page, pageZoom);
          results.push(await previewMetrics(page, pageZoom));
        }
      }

      baseline = results.find(({ pageZoom, pinchZoom }) => pageZoom === 1 && pinchZoom === 1);
      for (const result of results) {
        const label = `${result.pageZoom * 100}% page / ${result.pinchZoom * 100}% pinch`;
        assert.ok(Math.abs(result.screenWidth - baseline.screenWidth) < 0.1, `preview width changed at ${label}: ${result.screenWidth}px`);
        assert.ok(Math.abs(result.screenRightGap - baseline.screenRightGap) < 0.1, `preview right gap changed at ${label}: ${result.screenRightGap}px`);
        assert.ok(Math.abs(result.screenBottomGap - baseline.screenBottomGap) < 0.1, `preview bottom gap changed at ${label}: ${result.screenBottomGap}px`);
        assert.equal(result.imageWidth, baseline.imageWidth, `capture width changed at ${label}`);
        assert.equal(result.imageHeight, baseline.imageHeight, `capture height changed at ${label}`);
      }
      assert.ok(Math.abs(baseline.screenWidth - 336) < 0.1);
      assert.ok(Math.abs(baseline.screenRightGap - 18) < 0.1);
      assert.ok(Math.abs(baseline.screenBottomGap - 18) < 0.1);
    });

    await context.test('responds to tab zoom changes after the preview is created', async () => {
      await page.setPageScale(1);
      await capturePage(page, 1.25);
      await page.evaluate(`globalThis.__domshotListener({ type: 'DOMSHOT_ZOOM_CHANGED', pageZoom: 0.33 }, {}, () => {})`);
      await page.nextFrames();
      const changedZoom = await page.evaluate(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        const rect = host.shadowRoot.querySelector('.preview-card').getBoundingClientRect();
        return { pageZoom: host.dataset.domshotPageZoom, screenWidth: rect.width * 0.33 };
      })()`);
      assert.equal(changedZoom.pageZoom, '0.33');
      assert.ok(Math.abs(changedZoom.screenWidth - 336) < 0.1, `preview width is ${changedZoom.screenWidth}px after live zoom`);
    });
  });
});

async function capturePage(page, pageZoom) {
  await page.evaluate(`globalThis.__domshotListener({
    type: 'DOMSHOT_FULL_PAGE',
    settings: { format: 'png', scale: 1, embedFonts: false, reconcile: false },
    pageZoom: ${pageZoom}
  }, {}, () => {})`);
  await page.waitUntil(`(() => {
    const host = document.querySelector('#domshot-extension-root');
    return host?.dataset.domshotUi === 'preview' && Boolean(host.shadowRoot?.querySelector('.preview-card img')?.complete);
  })()`, 'Preview did not become ready');
}

function previewMetrics(page, pageZoom) {
  return page.evaluate(`(() => {
    const host = document.querySelector('#domshot-extension-root');
    const card = host.shadowRoot.querySelector('.preview-card');
    const image = card.querySelector('img');
    const rect = card.getBoundingClientRect();
    const viewport = visualViewport;
    const screenScale = ${pageZoom} * viewport.scale;
    return {
      pageZoom: ${pageZoom},
      pinchZoom: viewport.scale,
      screenWidth: rect.width * screenScale,
      screenRightGap: (viewport.pageLeft + viewport.width - rect.right) * screenScale,
      screenBottomGap: (viewport.pageTop + viewport.height - rect.bottom) * screenScale,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight
    };
  })()`);
}
