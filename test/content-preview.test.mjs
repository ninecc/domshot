import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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

test('selected element reports cross-origin images that could not be embedded', async () => {
  const imageServer = await listen((request, response) => {
    if (request.url !== '/image.png' && request.url !== '/cors-image.png') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      ...(request.url === '/cors-image.png' ? { 'access-control-allow-origin': '*' } : {}),
    });
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64'));
  });
  const imagePort = imageServer.address().port;
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<main id="target" style="width:240px;height:120px"><img id="cross-origin-image" src="http://127.0.0.1:${imagePort}/image.png" width="80" height="40"><img src="http://127.0.0.1:${imagePort}/cors-image.png" width="80" height="40"></main>`);
  });
  const pagePort = pageServer.address().port;

  try {
    await withChromePage({ url: `http://127.0.0.1:${pagePort}/` }, async (page) => {
      assert.equal(await page.evaluate(`(() => {
        const image = document.querySelector('#cross-origin-image');
        return image.complete && image.naturalWidth > 0;
      })()`), true, 'Fixture image should render before capture');
      await page.evaluate(`
        chrome.runtime = {
          onMessage: {
            addListener(listener) { globalThis.__domshotListener = listener; },
            removeListener() {}
          }
        }`);
      await page.evaluate(contentBundle);
      await page.evaluate(`globalThis.__domshotListener({
        type: 'DOMSHOT_SELECT',
        settings: { format: 'png', scale: 1, embedFonts: false, reconcile: false },
        pageZoom: 1
      }, {}, () => {})`);
      await page.evaluate(`(() => {
        const rect = document.querySelector('#target').getBoundingClientRect();
        const eventInit = { bubbles: true, clientX: rect.right - 20, clientY: rect.bottom - 20 };
        document.dispatchEvent(new MouseEvent('mousemove', eventInit));
        document.dispatchEvent(new MouseEvent('click', eventInit));
      })()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Preview did not appear');

      const warning = await page.evaluate(`(() => {
        const card = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.preview-card');
        return {
          warned: card.classList.contains('has-resource-warning'),
          title: card.querySelector('.preview-title').textContent,
          message: card.querySelector('[role="alert"]')?.textContent || ''
        };
      })()`);
      assert.equal(warning.warned, true);
      assert.equal(warning.title, '截图完成，但部分图片加载失败');
      assert.match(warning.message, /1 张图片/);
    });
  } finally {
    await Promise.all([closeServer(pageServer), closeServer(imageServer)]);
  }
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

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
