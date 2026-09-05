import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');
const settings = { format: 'png', scale: 1, afterCapture: 'preview', captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: false };
// Locate test UI through its shadow content, independently of colliding page IDs/attributes.
const hostExpression = `[...document.documentElement.children].find(el => el.shadowRoot?.querySelector('.preview-card'))`;

async function install(page) {
  await page.evaluate(`chrome.runtime = { onMessage: { addListener(listener) { globalThis.captureListener = listener; }, removeListener() {} }, async sendMessage() { return { ok: true }; } }`);
  await page.evaluate(bundle);
}

async function request(page, type, overrides = {}) {
  await page.evaluate(`globalThis.captureListener(${JSON.stringify({ type, settings: { ...settings, ...overrides }, locale: 'en', theme: 'light', pageZoom: 1 })}, {}, () => {})`);
}

async function pixels(page) {
  await page.waitUntil(`Boolean((${hostExpression})?.shadowRoot.querySelector('.image-stage img')?.complete)`, 'Capture preview did not appear');
  return page.evaluate(`(async () => {
    const img = (${hostExpression}).shadowRoot.querySelector('.image-stage img');
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let unexpected = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 12 || data[i + 1] !== 34 || data[i + 2] !== 56 || data[i + 3] !== 255) unexpected++;
    }
    const sample = (x, y) => [...data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    return { width: canvas.width, height: canvas.height, unexpected, top: sample(10, 10), middle: sample(10, 60), bottom: sample(10, canvas.height - 10) };
  })()`);
}

test('progress stays visible but contributes no pixels or height to full-page and viewport captures', async (context) => {
  for (const height of [240, 420]) await context.test(`viewport height ${height}`, async () => {
    await withChromePage({ url: 'data:text/html,<body style="margin:0;background:rgb(12,34,56)"><main style="height:1200px"></main>', viewport: { width: 480, height } }, async (page) => {
      await install(page);
      for (const type of ['DOMSHOT_FULL_PAGE', 'DOMSHOT_VISIBLE_AREA']) {
        await request(page, type, { scale: 2, captureDelay: 500 });
        assert.deepEqual(await page.evaluate(`(() => {
          const host = [...document.documentElement.children].find(el => el.shadowRoot?.querySelector('.progress'));
          const style = getComputedStyle(host);
          return { connected: host.isConnected, visible: style.visibility !== 'hidden' && style.display !== 'none', height: host.getBoundingClientRect().height };
        })()`), { connected: true, visible: true, height });
        const result = await pixels(page);
        assert.equal(result.width, 960);
        assert.equal(result.height, (type === 'DOMSHOT_FULL_PAGE' ? 1200 : height) * 2, 'UI must not change capture dimensions');
        assert.equal(result.unexpected, 0, 'Uniform page must contain neither overlay pixels nor transparent padding');
      }
    });
  });
});

test('page elements with DOMShot IDs and attributes survive capture, replacement and cleanup', async () => {
  const html = '<body style="margin:0;background:rgb(12,34,56)"><div id="domshot-extension-root" style="height:50px;background:rgb(200,20,30)"></div><div data-domshot-ui="progress" style="height:50px;background:rgb(20,200,30)"></div><main style="height:900px"></main>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await page.evaluate(`globalThis.pageNodes = [document.body.children[0], document.body.children[1]]`);
    await install(page);
    for (let i = 0; i < 2; i++) {
      await request(page, 'DOMSHOT_FULL_PAGE');
      const result = await pixels(page);
      assert.deepEqual(result.top, [200, 20, 30, 255]);
      assert.deepEqual(result.middle, [20, 200, 30, 255]);
      assert.equal(result.height, 1000);
      assert.equal(await page.evaluate(`pageNodes.every(el => el.isConnected)`), true);
    }
    await page.evaluate(`window.__domShotCleanup()`);
    assert.equal(await page.evaluate(`pageNodes.every(el => el.isConnected)`), true);
    assert.equal(await page.evaluate(`Boolean(${hostExpression})`), false, 'Script disposal must remove its own preview');
  });
});

test('picker can capture a same-ID page element without shrinking intentional transparent space', async () => {
  const html = '<style>body{margin:0}#domshot-extension-root{width:240px;height:300px}</style><body><section id="domshot-extension-root"><div style="width:100px;height:40px;background:rgb(200,20,30)"></div></section>';
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}` }, async (page) => {
    await install(page);
    await request(page, 'DOMSHOT_SELECT');
    await page.evaluate(`(() => {
      const init = { bubbles: true, clientX: 120, clientY: 200 };
      document.dispatchEvent(new MouseEvent('mousemove', init));
      document.dispatchEvent(new MouseEvent('click', init));
    })()`);
    const result = await pixels(page);
    assert.deepEqual([result.width, result.height], [240, 300]);
    assert.deepEqual(result.top, [200, 20, 30, 255]);
    assert.equal(result.bottom[3], 0, 'Transparent space belonging to the selected element must be preserved');
  });
});
