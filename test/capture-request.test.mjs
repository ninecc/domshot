import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

async function install(page) {
  await page.evaluate(`chrome.runtime = {
    onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
    async sendMessage() { return { ok: true }; }
  }`);
  await page.evaluate(bundle);
}

async function captureViewport(page, captureDelay = 0) {
  await page.evaluate(`listener({
    type: 'DOMSHOT_VISIBLE_AREA',
    settings: { format: 'png', scale: 1, captureDelay: ${captureDelay}, embedFonts: false, reconcile: false, compress: false },
    locale: 'en', theme: 'light', pageZoom: 1
  }, {}, () => {})`);
  await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Missing viewport capture');
  return page.evaluate(`(async () => {
    const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  })()`);
}

test('a delayed viewport capture uses the viewport at render time', async () => {
  const html = '<!doctype html><body style="margin:0"><div style="height:600px;background:red"></div><div style="height:600px;background:blue"></div>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await install(page);
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

test('a classic scrollbar is excluded from the visible-area capture', async () => {
  const html = '<!doctype html><body style="margin:0"><main style="width:1200px;height:1200px;background:red"></main>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await page.evaluate(`Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, get: () => 785 },
      clientHeight: { configurable: true, get: () => 585 }
    })`);
    assert.deepEqual(await page.evaluate(`({ visualWidth: visualViewport.width, visualHeight: visualViewport.height, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight })`), {
      visualWidth: 800, visualHeight: 600, clientWidth: 785, clientHeight: 585,
    });
    await install(page);
    assert.deepEqual(await captureViewport(page), { width: 785, height: 585 });
  });
});

test('pinch zoom uses the visual viewport instead of the larger layout viewport', async () => {
  const html = '<!doctype html><body style="margin:0"><main style="width:1200px;height:1200px;background:red"></main>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await page.setPageScale(2);
    await page.waitUntil(`Math.abs(visualViewport.scale - 2) < 0.001`, 'Visual viewport did not reach 2x pinch zoom');
    const metrics = await page.evaluate(`({ width: visualViewport.width, height: visualViewport.height, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight })`);
    assert.ok(metrics.width < metrics.clientWidth && metrics.height < metrics.clientHeight, JSON.stringify(metrics));
    await install(page);
    assert.deepEqual(await captureViewport(page), { width: metrics.width, height: metrics.height });
  });
});
