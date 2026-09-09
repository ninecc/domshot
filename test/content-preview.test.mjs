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
        window.__domShotProtocol = 14;
        window.__domShotCleanup = () => { globalThis.__domshotStaleCleanupRan = true; };
        globalThis.__domshotRevokedObjectUrls = [];
        globalThis.__domshotStoredCaptureIds = new Set();
        const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = (url) => {
          globalThis.__domshotRevokedObjectUrls.push(url);
          revokeObjectUrl(url);
        };
        chrome.runtime = {
          onMessage: {
            addListener(listener) { globalThis.__domshotListener = listener; },
            removeListener() {}
          },
          async sendMessage(message) {
            globalThis.__domshotHistoryMessages ??= [];
            if (message.type.startsWith('DOMSHOT_HISTORY_')) {
              globalThis.__domshotHistoryMessages.push({ type: message.type, id: message.id, captureId: message.capture?.id, thumbnailDataUrl: message.capture?.thumbnailDataUrl, index: message.index, dataLength: message.data?.length });
              if (message.type === 'DOMSHOT_HISTORY_CONFIRM') return { state: globalThis.__domshotStoredCaptureIds.has(message.capture.id) ? 'stored' : 'missing' };
              if (message.type === 'DOMSHOT_HISTORY_BEGIN' && globalThis.__domshotFailHistory) return { ok: false };
              if (message.type === 'DOMSHOT_HISTORY_BEGIN') return { ok: true, uploadToken: 'upload-token' };
              if (message.type === 'DOMSHOT_HISTORY_COMMIT') globalThis.__domshotStoredCaptureIds.add(message.id);
              if (message.type === 'DOMSHOT_HISTORY_DELETE') globalThis.__domshotStoredCaptureIds.delete(message.id);
              if (message.type === 'DOMSHOT_HISTORY_RESTORE') globalThis.__domshotStoredCaptureIds.add(message.id);
              return { ok: !globalThis.__domshotFailHistory };
            }
          }
        }`);
      await page.evaluate(contentBundle);
      assert.equal(await page.evaluate('typeof globalThis.__domshotListener'), 'function');
      assert.equal(await page.evaluate('globalThis.__domshotStaleCleanupRan'), true);
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

    await context.test('disposes a preview when another extension surface replaces it', async () => {
      await capturePage(page, 1, 'en');
      const revokedBefore = await page.evaluate(`globalThis.__domshotRevokedObjectUrls.length`);
      await capturePage(page, 1, 'en');
      const revokedAfter = await page.evaluate(`globalThis.__domshotRevokedObjectUrls.length`);
      assert.equal(revokedAfter, revokedBefore + 1, 'Replacing a preview must release its image URL');
    });

    await context.test('opens and closes the preview as a keyboard-operable dialog', async () => {
      await capturePage(page, 1, 'en');
      const dialog = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        const close = shadow.querySelector('.close');
        const rect = close.getBoundingClientRect();
        return { focused: shadow.activeElement === close, width: rect.width, height: rect.height };
      })()`);
      assert.equal(dialog.focused, true, 'The preview should move focus to its close control');
      assert.ok(dialog.width >= 32 && dialog.height >= 32, `Preview close target is only ${dialog.width} × ${dialog.height}px`);
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')`), null, 'Escape should close the preview');
    });

    await context.test('applies the requested theme to in-page UI', async () => {
      await capturePage(page, 1, 'en', 'light');
      const light = await page.evaluate(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        return { theme: host.dataset.domshotTheme, background: getComputedStyle(host.shadowRoot.querySelector('.preview-card')).backgroundColor };
      })()`);
      await capturePage(page, 1, 'en', 'dark');
      const dark = await page.evaluate(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        return { theme: host.dataset.domshotTheme, background: getComputedStyle(host.shadowRoot.querySelector('.preview-card')).backgroundColor };
      })()`);
      assert.equal(light.theme, 'light');
      assert.equal(dark.theme, 'dark');
      assert.notEqual(dark.background, light.background);
    });

    await context.test('captures only the current visible viewport', async () => {
      await page.setPageScale(1);
      await page.evaluate('scrollTo(0, 400)');
      const viewport = await page.evaluate(`({ width: innerWidth, height: innerHeight })`);
      await requestVisibleArea(page);
      await page.waitUntil(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        const image = host?.shadowRoot?.querySelector('.image-stage img');
        return host?.dataset.domshotUi === 'preview' && image?.complete && image.naturalWidth > 0;
      })()`, 'Visible-area preview image did not become ready');
      const imageSize = await page.evaluate(`(() => {
        const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
        return { width: image.naturalWidth, height: image.naturalHeight };
      })()`);
      assert.deepEqual(imageSize, viewport);
      await page.evaluate('scrollTo(0, 0)');
    });

    await context.test('does not save captures to history by default', async () => {
      await page.evaluate(`globalThis.__domshotHistoryMessages = []`);
      await requestVisibleArea(page);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Capture preview did not appear');
      assert.deepEqual(await page.evaluate(`globalThis.__domshotHistoryMessages`), []);
    });

    await context.test('streams captures to history without one oversized message when enabled', async () => {
      await page.evaluate(`globalThis.__domshotHistoryMessages = []`);
      await requestVisibleArea(page, { saveRecentCaptures: true });
      await page.waitUntil(`globalThis.__domshotHistoryMessages.some((message) => message.type === 'DOMSHOT_HISTORY_COMMIT')`, 'Capture history upload did not complete');
      const historyMessages = await page.evaluate(`globalThis.__domshotHistoryMessages`);
      assert.equal(historyMessages[0].type, 'DOMSHOT_HISTORY_BEGIN');
      assert.equal(historyMessages.at(-1).type, 'DOMSHOT_HISTORY_COMMIT');
      assert.ok(historyMessages.some((message) => message.type === 'DOMSHOT_HISTORY_CHUNK'));
      assert.equal(historyMessages.some((message) => message.type === 'DOMSHOT_HISTORY_SAVE'), false);
      assert.ok(historyMessages.filter((message) => message.dataLength).every((message) => message.dataLength < 2 * 1024 * 1024));
    });

    await context.test('keeps the capture usable when thumbnail generation or automatic history saving fails', async () => {
      await page.evaluate(`(() => {
        globalThis.__domshotHistoryMessages = [];
        globalThis.__domshotFailThumbnail = true;
        const original = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
          if (globalThis.__domshotFailThumbnail && type === 'image/webp') throw new Error('thumbnail unavailable');
          return original.call(this, type, ...args);
        };
      })()`);
      await requestVisibleArea(page, { saveRecentCaptures: true });
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Thumbnail failure discarded the completed capture');
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img').naturalWidth > 0`), true);
      assert.equal(await page.evaluate(`globalThis.__domshotHistoryMessages.find(message => message.type === 'DOMSHOT_HISTORY_BEGIN').thumbnailDataUrl`), '');

      await page.evaluate(`globalThis.__domshotFailThumbnail = false; globalThis.__domshotFailHistory = true; globalThis.__domshotHistoryMessages = []`);
      await requestVisibleArea(page, { saveRecentCaptures: true }, 'en');
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'History failure discarded the completed capture');
      const failure = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { imageReady: shadow.querySelector('.image-stage img').naturalWidth > 0, status: shadow.querySelector('.history-retention-status').textContent };
      })()`);
      assert.equal(failure.imageReady, true);
      assert.match(failure.status, /couldn.t be saved to history/i);

      await requestVisibleArea(page, { saveRecentCaptures: true, afterCapture: 'download' }, 'en');
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'toast'`, 'Automatic action did not report the history failure');
      assert.match(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.textContent`), /couldn.t be saved to history/i);
      await page.evaluate(`globalThis.__domshotFailHistory = false`);
    });

    await context.test('lets the current preview remove and restore its history entry', async () => {
      await requestFullPage(page, { saveRecentCaptures: true }, 'zh-CN');
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Preview did not appear');
      const initial = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { status: shadow.querySelector('.history-retention-status').textContent, action: shadow.querySelector('.history-retention-toggle').textContent };
      })()`);
      assert.equal(initial.status, '✓ 已保存到截图历史');
      assert.equal(initial.action, '从截图历史中移除');

      await page.evaluate(`globalThis.__domshotHistoryMessages = []; document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-toggle').click()`);
      await page.waitUntil(`globalThis.__domshotHistoryMessages.some((message) => message.type === 'DOMSHOT_HISTORY_DELETE')`, 'Current capture was not removed from history');
      const removed = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { status: shadow.querySelector('.history-retention-status').textContent, action: shadow.querySelector('.history-retention-toggle').textContent };
      })()`);
      assert.equal(removed.status, '已从截图历史中移除 · 仍可复制或下载');
      assert.equal(removed.action, '重新保存到历史');
      assert.equal(await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return !shadow.querySelector('.copy').disabled && !shadow.querySelector('.download').disabled;
      })()`), true, 'removing a capture from history must not disable copy or download');

      await page.evaluate(`globalThis.__domshotHistoryMessages = []; document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-toggle').click()`);
      await page.waitUntil(`globalThis.__domshotHistoryMessages.some((message) => message.type === 'DOMSHOT_HISTORY_RESTORE' || message.type === 'DOMSHOT_HISTORY_COMMIT')`, 'Current capture was not restored to history');
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-status').textContent`), '✓ 已保存到截图历史');
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
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('button').textContent`), '保存到截图历史');
      await page.evaluate(`globalThis.__domshotHistoryMessages = []; document.querySelector('#domshot-extension-root').shadowRoot.querySelector('button').click()`);
      await page.waitUntil(`globalThis.__domshotHistoryMessages.some((message) => message.type === 'DOMSHOT_HISTORY_COMMIT')`, 'Automatic-copy toast did not save the capture on demand');
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('strong').textContent`), '已保存到截图历史');

      await page.evaluate(`document.title = 'Résumé 日本語'; HTMLAnchorElement.prototype.click = function () { globalThis.__domshotDownload = this.download; }`);
      await requestFullPage(page, { afterCapture: 'download', filenameMode: 'page-title' });
      await page.waitUntil(`Boolean(globalThis.__domshotDownload)`, 'Automatic download did not start');
      assert.match(await page.evaluate(`globalThis.__domshotDownload`), /^domshot-résumé-日本語-\d{14}\.png$/u);

      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async write() { throw new Error('denied'); } } })`);
      await requestFullPage(page, { afterCapture: 'copy' });
      await page.waitUntil(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        return host?.dataset.domshotUi === 'preview' && host.shadowRoot.querySelector('.copy.is-error');
      })()`, 'Failed automatic copy did not fall back to the preview');
    });

    await context.test('applies lossy quality and waits before capture when configured', async () => {
      await requestFullPage(page, { format: 'jpg', quality: 0.8 });
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Low-quality JPG preview did not appear');
      const lowQualitySize = await page.evaluate(`fetch(document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img').src).then((response) => response.blob()).then((blob) => blob.size)`);

      await requestFullPage(page, { format: 'jpg', quality: 1 });
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Maximum-quality JPG preview did not appear');
      const maximumQualitySize = await page.evaluate(`fetch(document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img').src).then((response) => response.blob()).then((blob) => blob.size)`);
      assert.ok(maximumQualitySize >= lowQualitySize, `maximum-quality JPG (${maximumQualitySize}) was smaller than 80% JPG (${lowQualitySize})`);

      await page.evaluate(`(() => {
        globalThis.__domshotBlobQualities = [];
        globalThis.__domshotForceMimeFallback = true;
        const originalFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          if (!globalThis.__domshotForceMimeFallback || typeof input !== 'string' || !input.startsWith('data:image/jpeg')) return response;
          return new Response(await response.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream' } });
        };
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          if (globalThis.__domshotForceMimeFallback && type === 'image/jpeg') globalThis.__domshotBlobQualities.push(quality);
          return originalToBlob.call(this, callback, type, quality);
        };
      })()`);
      await requestFullPage(page, { format: 'jpg', quality: 0.8 });
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Fallback-encoded JPG preview did not appear');
      assert.equal(await page.evaluate(`globalThis.__domshotBlobQualities.at(-1)`), 0.8, 'MIME fallback must preserve the selected image quality');
      await page.evaluate(`globalThis.__domshotForceMimeFallback = false`);

      const startedAt = Date.now();
      await requestFullPage(page, { captureDelay: 500 });
      assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'progress');
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Delayed capture preview did not appear');
      assert.ok(Date.now() - startedAt >= 400, 'configured capture delay was not applied');
    });

    let baseline;
    await context.test('keeps size, placement, and capture dimensions across page and pinch zoom', async () => {
      const results = [];
      for (const pageZoom of [0.5, 0.8, 1, 1.25, 1.5, 2]) {
        for (const pinchZoom of [1, 1.5, 2]) {
          await page.setPageScale(pinchZoom);
          await page.waitUntil(`Math.abs(visualViewport.scale - ${pinchZoom}) < 0.001`, `Visual viewport did not reach ${pinchZoom}× pinch zoom`);
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

    await context.test('shows action feedback inside buttons without moving the preview', async () => {
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
      await capturePage(page, 1, 'zh-CN', 'dark');
      const beforeHeight = await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.preview-card').getBoundingClientRect().height`);

      const closeBefore = await page.evaluate(`(() => {
        const button = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.close');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { hasSvg: Boolean(button.querySelector('svg')), color: style.color, backgroundColor: style.backgroundColor, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      await page.moveMouse(closeBefore.rect.left + closeBefore.rect.width / 2, closeBefore.rect.top + closeBefore.rect.height / 2);
      await page.nextFrames();
      const closeHovered = await page.evaluate(`(() => {
        const button = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.close');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { color: style.color, backgroundColor: style.backgroundColor, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      assert.equal(closeBefore.hasSvg, true);
      assert.notEqual(closeHovered.color, closeBefore.color);
      assert.equal(closeHovered.backgroundColor, closeBefore.backgroundColor);
      assert.deepEqual(closeHovered.rect, closeBefore.rect);

      const copyBefore = await page.evaluate(`(() => {
        const button = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.copy');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { borderColor: style.borderColor, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      await page.moveMouse(copyBefore.rect.left + copyBefore.rect.width / 2, copyBefore.rect.top + copyBefore.rect.height / 2);
      await page.nextFrames();
      const copyHovered = await page.evaluate(`(() => {
        const button = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.copy');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { transform: style.transform, borderColor: style.borderColor, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      assert.equal(copyHovered.transform, 'none');
      assert.deepEqual(copyHovered.rect, copyBefore.rect);
      assert.notEqual(copyHovered.borderColor, copyBefore.borderColor);

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
          announcement: shadow.querySelector('.action-status').textContent
        };
      })()`);

      assert.equal(result.copied, true);
      assert.ok(Math.abs(result.height - beforeHeight) < 0.5);
      assert.equal(result.buttonSuccess, true);
      assert.ok(result.announcement.length > 0);

      const downloadBefore = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        const button = shadow.querySelector('.download');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { cardHeight: shadow.querySelector('.preview-card').getBoundingClientRect().height, filter: style.filter, borderColor: style.borderColor, borderWidth: style.borderWidth, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      await page.moveMouse(downloadBefore.rect.left + downloadBefore.rect.width / 2, downloadBefore.rect.top + downloadBefore.rect.height / 2);
      await page.nextFrames();
      const downloadHovered = await page.evaluate(`(() => {
        const button = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.download');
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { transform: style.transform, filter: style.filter, borderColor: style.borderColor, borderWidth: style.borderWidth, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      assert.equal(downloadHovered.transform, 'none');
      assert.deepEqual(downloadHovered.rect, downloadBefore.rect);
      assert.equal(downloadBefore.borderWidth, '1px');
      assert.equal(downloadHovered.borderWidth, downloadBefore.borderWidth);
      assert.notEqual(downloadHovered.borderColor, downloadBefore.borderColor);
      assert.notEqual(downloadHovered.filter, downloadBefore.filter, 'download hover should visibly change the primary surface');

      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.download').click()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.download').classList.contains('is-success')`, 'Download button did not show success');
      const downloadAfter = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { height: shadow.querySelector('.preview-card').getBoundingClientRect().height, announcement: shadow.querySelector('.action-status').textContent };
      })()`);
      assert.ok(Math.abs(downloadAfter.height - downloadBefore.cardHeight) < 0.5);
      assert.ok(downloadAfter.announcement.length > 0);
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
        globalThis.__domshotHistoryMessages = [];
        HTMLAnchorElement.prototype.click = function () { globalThis.__domshotDownload = this.download; };
        chrome.runtime = {
          onMessage: {
            addListener(listener) { globalThis.__domshotListener = listener; },
            removeListener() {}
          },
          async sendMessage(message) {
            if (message.type.startsWith('DOMSHOT_HISTORY_')) {
              globalThis.__domshotHistoryMessages.push({ type: message.type, id: message.id, captureId: message.capture?.id });
              if (message.type === 'DOMSHOT_HISTORY_BEGIN' && globalThis.__domshotFailNextHistoryBegin) {
                globalThis.__domshotFailNextHistoryBegin = false;
                return { ok: false };
              }
              if (message.type === 'DOMSHOT_HISTORY_BEGIN') return { ok: true, uploadToken: 'upload-token' };
              if (message.type === 'DOMSHOT_HISTORY_DELETE' && globalThis.__domshotFailNextHistoryDelete) {
                globalThis.__domshotFailNextHistoryDelete = false;
                return { ok: false };
              }
              return { ok: true };
            }
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              globalThis.__domshotResolveUrls = message.urls;
              return {
                resources: message.urls.map((url) => globalThis.__domshotProxyEnabled
                  ? { url, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==' }
                  : { url, reason: 'permission', permissionUrl: url })
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
        settings: { format: 'png', scale: 1, afterCapture: 'download', saveRecentCaptures: true, embedFonts: false, reconcile: false, outerShadows: false, compress: true },
        locale: 'zh-CN',
        theme: 'light',
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
      assert.equal(warning.canGrant, true, JSON.stringify({ warning, urls: await page.evaluate(`globalThis.__domshotResolveUrls`) }));

      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
      await page.waitUntil(`globalThis.__domshotPermissionRequest?.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION'`, 'Permission request was not prepared');
      assert.equal(await page.evaluate(`globalThis.__domshotPermissionRequest.theme`), 'light');
      assert.deepEqual(await page.evaluate(`globalThis.__domshotPermissionRequest.origins`), [`http://127.0.0.1:${imagePort}`]);
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
      const restoredAfterDisconnect = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        const frame = shadow.querySelector('.permission-panel iframe');
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'DOMSHOT_PERMISSION_CANCEL' },
          source: frame.contentWindow
        }));
        return {
          frameHidden: shadow.querySelector('.permission-panel').hidden,
          previewVisible: getComputedStyle(shadow.querySelector('.image-stage')).display !== 'none',
          canAuthorize: !shadow.querySelector('.grant-images').disabled,
        };
      })()`);
      assert.deepEqual(restoredAfterDisconnect, { frameHidden: true, previewVisible: true, canAuthorize: true });
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
      await page.waitUntil(`globalThis.__domshotHistoryMessages.some(message => message.type === 'DOMSHOT_HISTORY_DELETE')`, 'Successful retry left the failed capture in history');
      const history = await page.evaluate(`globalThis.__domshotHistoryMessages`);
      const captureIds = history.filter(message => message.type === 'DOMSHOT_HISTORY_BEGIN').map(message => message.captureId);
      assert.equal(captureIds.length, 2);
      assert.notEqual(captureIds[0], captureIds[1]);
      assert.equal(history.find(message => message.type === 'DOMSHOT_HISTORY_DELETE').id, captureIds[0]);

      await page.evaluate(`(() => {
        globalThis.__domshotProxyEnabled = false;
        globalThis.__domshotPermissionRequest = null;
        globalThis.__domshotHistoryMessages = [];
        globalThis.__domshotListener({
          type: 'DOMSHOT_SELECT',
          settings: { format: 'png', scale: 1, afterCapture: 'preview', saveRecentCaptures: true, embedFonts: false, reconcile: false, outerShadows: false, compress: true },
          locale: 'en', theme: 'light', pageZoom: 1
        }, {}, () => {});
        const rect = document.querySelector('#target').getBoundingClientRect();
        const init = { bubbles: true, clientX: rect.right - 20, clientY: rect.bottom - 20 };
        document.dispatchEvent(new MouseEvent('mousemove', init));
        document.dispatchEvent(new MouseEvent('click', init));
      })()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Second partial preview did not appear');
      const retainedPartialId = await page.evaluate(`globalThis.__domshotHistoryMessages.find(message => message.type === 'DOMSHOT_HISTORY_BEGIN').captureId`);
      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
      await page.waitUntil(`globalThis.__domshotPermissionRequest?.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION'`, 'Second permission request was not prepared');
      await page.evaluate(`(() => {
        globalThis.__domshotProxyEnabled = true;
        globalThis.__domshotFailNextHistoryBegin = true;
        globalThis.__domshotListener({ type: 'DOMSHOT_RETRY_CAPTURE', token: globalThis.__domshotPermissionRequest.token }, {}, () => {});
      })()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Retry with failed automatic save did not return a preview');
      const failedReplacement = await page.evaluate(`(() => ({
        status: document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-status').textContent,
        deletes: globalThis.__domshotHistoryMessages.filter(message => message.type === 'DOMSHOT_HISTORY_DELETE').map(message => message.id)
      }))()`);
      assert.match(failedReplacement.status, /couldn.t be saved to history/i);
      assert.deepEqual(failedReplacement.deletes, [], 'A failed replacement save must retain the old partial capture');
      assert.ok(retainedPartialId);

      await page.evaluate(`(() => {
        globalThis.__domshotProxyEnabled = false;
        globalThis.__domshotPermissionRequest = null;
        globalThis.__domshotHistoryMessages = [];
        globalThis.__domshotListener({
          type: 'DOMSHOT_SELECT',
          settings: { format: 'png', scale: 1, afterCapture: 'preview', saveRecentCaptures: true, embedFonts: false, reconcile: false, outerShadows: false, compress: true },
          locale: 'en', theme: 'light', pageZoom: 1
        }, {}, () => {});
        const rect = document.querySelector('#target').getBoundingClientRect();
        const init = { bubbles: true, clientX: rect.right - 20, clientY: rect.bottom - 20 };
        document.dispatchEvent(new MouseEvent('mousemove', init));
        document.dispatchEvent(new MouseEvent('click', init));
      })()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Third partial preview did not appear');
      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
      await page.waitUntil(`globalThis.__domshotPermissionRequest?.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION'`, 'Third permission request was not prepared');
      await page.evaluate(`(() => {
        globalThis.__domshotProxyEnabled = true;
        globalThis.__domshotFailNextHistoryDelete = true;
        globalThis.__domshotListener({ type: 'DOMSHOT_RETRY_CAPTURE', token: globalThis.__domshotPermissionRequest.token }, {}, () => {});
      })()`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Retry with failed cleanup did not return a preview');
      assert.match(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-status').textContent`), /saved to capture history.*couldn.t complete that action/i);
    });
  } finally {
    await Promise.all([closeServer(pageServer), closeServer(imageServer)]);
  }
});

async function capturePage(page, pageZoom, locale = 'zh-CN', theme = 'light') {
  await requestFullPage(page, { pageZoom }, locale, theme);
  await page.waitUntil(`(() => {
    const host = document.querySelector('#domshot-extension-root');
    const image = host?.shadowRoot?.querySelector('.preview-card img');
    return host?.dataset.domshotUi === 'preview' && image?.complete && image.naturalWidth > 0;
  })()`, 'Preview image did not become ready');
  await page.nextFrames();
}

async function requestFullPage(page, overrides = {}, locale = 'zh-CN', theme = 'light') {
  const { pageZoom = 1, ...settings } = overrides;
  await page.evaluate(`globalThis.__domshotListener({
    type: 'DOMSHOT_FULL_PAGE',
    settings: ${JSON.stringify({ format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'smart', saveRecentCaptures: false, captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true, ...settings })},
    locale: ${JSON.stringify(locale)},
    theme: ${JSON.stringify(theme)},
    pageZoom: ${pageZoom}
  }, {}, () => {})`);
}

async function requestVisibleArea(page, overrides = {}, locale = 'zh-CN', theme = 'light') {
  await page.evaluate(`globalThis.__domshotListener({
    type: 'DOMSHOT_VISIBLE_AREA',
    settings: ${JSON.stringify({ format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'smart', saveRecentCaptures: false, captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true, ...overrides })},
    locale: ${JSON.stringify(locale)},
    theme: ${JSON.stringify(theme)},
    pageZoom: 1
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
