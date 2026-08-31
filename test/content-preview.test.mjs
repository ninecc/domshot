import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { withChromePage } from './support/chrome-page.mjs';

const contentBundle = await readFile(resolve(import.meta.dirname, '../dist/content.js'), 'utf8');
const fixtureUrl = 'data:text/html,<main style="min-height:3000px"><h1>DOMShot zoom test</h1><p>Stable capture content</p></main>';

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

    await context.test('renders capture controls in the requested language', async () => {
      await capturePage(page, 1, 'en');
      const labels = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { title: shadow.querySelector('.preview-title').textContent, copy: shadow.querySelector('.copy').textContent };
      })()`);
      assert.ok(labels.title.length > 0 && labels.copy.length > 0);
      assert.doesNotMatch(`${labels.title} ${labels.copy}`, /[\u4e00-\u9fff]/, 'English capture controls should not contain Chinese copy');
    });

    await context.test('runs the configured post-capture action with safe preview fallback', async () => {
      await page.evaluate(`(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { write: async (items) => { globalThis.__domshotCopiedItems = items; } }
        });
        Object.defineProperty(globalThis, 'ClipboardItem', {
          configurable: true,
          value: class ClipboardItem { constructor(items) { this.items = items; } }
        });
      })()`);
      await requestFullPage(page, { afterCapture: 'copy', outerShadows: true, compress: false });
      await page.waitUntil(`globalThis.__domshotCopiedItems?.length === 1`, 'Automatic copy did not write the image');
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'toast');

      await page.evaluate(`HTMLAnchorElement.prototype.click = function () { globalThis.__domshotDownload = this.download; }`);
      await requestFullPage(page, { afterCapture: 'download' });
      await page.waitUntil(`Boolean(globalThis.__domshotDownload)`, 'Automatic download did not start');
      assert.match(await page.evaluate(`globalThis.__domshotDownload`), /^domshot-.+\.png$/);

      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async write() { throw new Error('denied'); } } })`);
      await requestFullPage(page, { afterCapture: 'copy' });
      await page.waitUntil(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        return host?.dataset.domshotUi === 'preview' && host.shadowRoot.querySelector('.feedback.is-error')?.textContent.length > 0;
      })()`, 'Failed automatic copy did not fall back to the preview');
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
        assert.ok(Math.abs(result.screenWidth - baseline.screenWidth) < 0.5, `preview width changed at ${label}: ${result.screenWidth}px`);
        assert.ok(Math.abs(result.screenRightGap - baseline.screenRightGap) < 0.5, `preview right gap changed at ${label}: ${result.screenRightGap}px`);
        assert.ok(Math.abs(result.screenBottomGap - baseline.screenBottomGap) < 0.5, `preview bottom gap changed at ${label}: ${result.screenBottomGap}px`);
        assert.equal(result.imageWidth, baseline.imageWidth, `capture width changed at ${label}`);
        assert.equal(result.imageHeight, baseline.imageHeight, `capture height changed at ${label}`);
      }
      assert.ok(Math.abs(baseline.screenWidth - 336) < 0.5);
      assert.ok(Math.abs(baseline.screenRightGap - 18) < 0.5);
      assert.ok(Math.abs(baseline.screenBottomGap - 18) < 0.5);
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
      assert.ok(Math.abs(changedZoom.screenWidth - 336) < 0.5, `preview width is ${changedZoom.screenWidth}px after live zoom`);
    });

    await context.test('keeps the preview fixed while the page scrolls', async () => {
      await page.setPageScale(1);
      await page.evaluate('scrollTo(0, 0)');
      await capturePage(page, 1);
      const before = await previewViewportPosition(page);
      await page.evaluate('scrollTo(0, 800)');
      await page.nextFrames();
      const after = await previewViewportPosition(page);

      assert.equal(await page.evaluate('scrollY'), 800, 'Fixture should scroll before checking the preview');
      assert.equal(before.position, 'fixed', 'Preview host should rely on viewport positioning instead of scroll compensation');
      assert.equal(after.position, 'fixed');
      assert.ok(Math.abs(after.top - before.top) < 0.5, `preview moved vertically from ${before.top}px to ${after.top}px`);
      assert.ok(Math.abs(after.rightGap - before.rightGap) < 0.5, `preview right gap changed from ${before.rightGap}px to ${after.rightGap}px`);
    });

    await context.test('shows copy success inside the button without resizing the preview', async () => {
      await page.evaluate(`(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { write: async (items) => { globalThis.__domshotCopiedItems = items; } }
        });
        Object.defineProperty(globalThis, 'ClipboardItem', {
          configurable: true,
          value: class ClipboardItem { constructor(items) { this.items = items; } }
        });
      })()`);
      await capturePage(page, 1);
      const beforeHeight = await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.preview-card').getBoundingClientRect().height`);
      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.copy').click()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.copy').classList.contains('is-success')`, 'Copy button did not show success');
      const result = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        const card = shadow.querySelector('.preview-card');
        const button = shadow.querySelector('.copy');
        return {
          copied: globalThis.__domshotCopiedItems?.length === 1,
          height: card.getBoundingClientRect().height,
          buttonSuccess: button.classList.contains('is-success'),
          feedback: shadow.querySelector('.feedback').textContent,
          announcement: shadow.querySelector('.copy-status').textContent
        };
      })()`);

      assert.equal(result.copied, true);
      assert.ok(Math.abs(result.height - beforeHeight) < 0.5);
      assert.equal(result.buttonSuccess, true);
      assert.equal(result.feedback, '');
      assert.ok(result.announcement.length > 0);
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
        globalThis.__domshotProxyEnabled = false;
        globalThis.__domshotPermissionRequest = null;
        HTMLAnchorElement.prototype.click = function () { globalThis.__domshotDownload = this.download; };
        chrome.runtime = {
          onMessage: {
            addListener(listener) { globalThis.__domshotListener = listener; },
            removeListener() {}
          },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              return {
                resources: message.urls.map((url) => globalThis.__domshotProxyEnabled
                  ? { url, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==' }
                  : { url, reason: 'permission' })
              };
            }
            if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
              globalThis.__domshotPermissionRequest = message;
              return { prepared: true, frameUrl: 'about:blank' };
            }
          }
        }`);
      await page.evaluate(contentBundle);
      await page.evaluate(`globalThis.__domshotListener({
        type: 'DOMSHOT_SELECT',
        settings: { format: 'png', scale: 1, afterCapture: 'download', embedFonts: false, reconcile: false, outerShadows: false, compress: true },
        locale: 'zh-CN',
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
          message: card.querySelector('[role="alert"]')?.textContent || '',
          canGrant: Boolean(card.querySelector('.grant-images'))
        };
      })()`);
      assert.equal(warning.warned, true);
      assert.ok(warning.title.length > 0);
      assert.match(warning.title, /[\u4e00-\u9fff]/, 'Chinese capture UI should contain Chinese copy');
      assert.match(warning.message, /1/);
      assert.equal(warning.canGrant, true);

      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
      await page.waitUntil(`globalThis.__domshotPermissionRequest?.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION'`, 'Permission request was not prepared');
      await page.waitUntil(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.preview-card').classList.contains('is-authorizing')`, 'Preview card did not enter its inline permission state');
      const authorizationState = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return {
          title: shadow.querySelector('.preview-title').textContent,
          frameVisible: !shadow.querySelector('.permission-panel').hidden,
          previewVisible: getComputedStyle(shadow.querySelector('.image-stage')).display !== 'none',
          containsDomain: shadow.querySelector('.preview-card').textContent.includes('127.0.0.1')
        };
      })()`);
      assert.ok(authorizationState.title.length > 0);
      assert.notEqual(authorizationState.title, warning.title);
      assert.equal(authorizationState.frameVisible, true);
      assert.equal(authorizationState.previewVisible, false);
      assert.equal(authorizationState.containsDomain, false, 'Result card should leave the domain list to the permission view');
      const retried = await page.evaluate(`(() => {
        globalThis.__domshotProxyEnabled = true;
        let response;
        globalThis.__domshotListener({ type: 'DOMSHOT_RETRY_CAPTURE', token: globalThis.__domshotPermissionRequest.token }, {}, (value) => { response = value; });
        return response?.started === true;
      })()`);
      assert.equal(retried, true);
      await page.waitUntil(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        return host?.dataset.domshotUi === 'toast' && Boolean(globalThis.__domshotDownload);
      })()`, 'Retried capture did not resolve the image and run the configured download');
      assert.match(await page.evaluate(`globalThis.__domshotDownload`), /^domshot-.+\.png$/);
    });
  } finally {
    await Promise.all([closeServer(pageServer), closeServer(imageServer)]);
  }
});

async function capturePage(page, pageZoom, locale = 'zh-CN') {
  await requestFullPage(page, { pageZoom }, locale);
  await page.waitUntil(`(() => {
    const host = document.querySelector('#domshot-extension-root');
    return host?.dataset.domshotUi === 'preview' && Boolean(host.shadowRoot?.querySelector('.preview-card img')?.complete);
  })()`, 'Preview did not become ready');
}

async function requestFullPage(page, overrides = {}, locale = 'zh-CN') {
  const { pageZoom = 1, ...settings } = overrides;
  await page.evaluate(`globalThis.__domshotListener({
    type: 'DOMSHOT_FULL_PAGE',
    settings: ${JSON.stringify({ format: 'png', scale: 1, afterCapture: 'preview', embedFonts: false, reconcile: false, outerShadows: false, compress: true, ...settings })},
    locale: ${JSON.stringify(locale)},
    pageZoom: ${pageZoom}
  }, {}, () => {})`);
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

function previewViewportPosition(page) {
  return page.evaluate(`(() => {
    const card = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.preview-card');
    const rect = card.getBoundingClientRect();
    return { position: getComputedStyle(card.getRootNode().host).position, top: rect.top, rightGap: innerWidth - rect.right };
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
