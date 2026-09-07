import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('a delayed viewport capture uses the viewport at render time', async () => {
  const html = '<!doctype html><body style="margin:0"><div style="height:600px;background:red"></div><div style="height:600px;background:blue"></div>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await page.evaluate(`chrome.runtime = {
      onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
      async sendMessage() { return { ok: true }; }
    }`);
    await page.evaluate(bundle);
    await page.evaluate(`listener({
      type: 'DOMSHOT_VISIBLE_AREA',
      settings: { format: 'png', scale: 1, captureDelay: 500, embedFonts: false, reconcile: false, compress: false },
      locale: 'en', theme: 'light', pageZoom: 1
    }, {}, () => {}); scrollTo(0, 600)`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Missing delayed capture');
    const result = await page.evaluate(`(async () => {
      const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixel: [...context.getImageData(400, 300, 1, 1).data], scrollY };
    })()`);
    assert.deepEqual(result, { width: 800, height: 600, pixel: [0, 0, 255, 255], scrollY: 600 });
  });
});
