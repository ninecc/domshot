import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('download URL survives asynchronous browser pickup and is eventually revoked without breaking feedback', async () => {
  await withChromePage({ url: 'data:text/html,<main style="height:900px;background:steelblue"></main>' }, async (page) => {
    await page.evaluate(`(() => {
      globalThis.downloadPickup = null;
      globalThis.downloadUrl = null;
      globalThis.downloadRevoke = null;
      globalThis.revokedUrls = [];
      const nativeTimeout = window.setTimeout.bind(window);
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 30000) { globalThis.downloadRevoke = () => callback(...args); return 4242; }
        return nativeTimeout(callback, delay, ...args);
      };
      URL.revokeObjectURL = (url) => { globalThis.revokedUrls.push(url); nativeRevoke(url); };
      HTMLAnchorElement.prototype.click = function () {
        globalThis.downloadUrl = this.href;
        globalThis.downloadPickup = new Promise(resolve => nativeTimeout(async () => {
          try { resolve({ ok: true, text: await fetch(this.href).then(response => response.text()) }); }
          catch (error) { resolve({ ok: false, error: String(error) }); }
        }, 60));
      };
      chrome.runtime = {
        onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
        async sendMessage() { return { ok: true }; }
      };
    })()`);
    await page.evaluate(bundle);
    await page.evaluate(`listener({
      type: 'DOMSHOT_VISIBLE_AREA',
      settings: { format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'smart', saveRecentCaptures: false, captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true },
      locale: 'en', theme: 'light', pageZoom: 1
    }, {}, () => {})`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Preview did not appear');
    await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.download').click()`);
    const pickup = await page.evaluate(`globalThis.downloadPickup`);
    assert.equal(pickup.ok, true, pickup.error);
    assert.ok(pickup.text.length > 0);
    assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.download').classList.contains('is-success')`), true);
    assert.match(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.action-status').textContent`), /download started/i);

    assert.equal(await page.evaluate(`typeof globalThis.downloadRevoke`), 'function', 'Download URL must have a bounded cleanup timer');
    await page.evaluate(`globalThis.downloadRevoke()`);
    assert.deepEqual(await page.evaluate(`globalThis.revokedUrls`), [await page.evaluate(`globalThis.downloadUrl`)]);
  });
});
