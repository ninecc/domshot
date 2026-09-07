import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';
import { triangleFont } from './support/triangle-font.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

async function install(page) {
  await page.evaluate(`chrome.runtime = { onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} }, async sendMessage() { return { resources: [] }; } }`);
  await page.evaluate(bundle);
}

async function capture(page, scale = 1, element = false) {
  await page.evaluate(`listener({ type: '${element ? 'DOMSHOT_SELECT' : 'DOMSHOT_FULL_PAGE'}', settings: { format: 'png', scale: ${scale}, embedFonts: true, reconcile: false, compress: false }, locale: 'en', theme: 'light', pageZoom: 1 }, {}, () => {})`);
  if (element) await page.evaluate(`(() => { const init = { bubbles: true, clientX: 250, clientY: 150 }; document.dispatchEvent(new MouseEvent('mousemove', init)); document.dispatchEvent(new MouseEvent('click', init)); })()`);
  await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Capture did not finish');
}

test('loaded icon fonts retain direct glyphs alongside pseudo-element icons', async () => {
  const html = `<style>@font-face{font-family:cIconfont;src:url(${triangleFont})}body{margin:0;background:white}.icon{display:inline-block;width:100px;height:100px;font:100px/100px cIconfont;color:red;vertical-align:top}.pseudo::before{content:"\\e001"}</style><main style="width:300px;height:200px"><span class="icon">&#xe001;</span><span class="icon pseudo"></span></main>`;
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}`, viewport: { width: 300, height: 200 } }, async (page) => {
    assert.equal(await page.evaluate(`document.fonts.load('100px cIconfont', '\ue001').then(faces => faces.length === 1 && faces[0].status === 'loaded')`), true, 'Fixture font must load before testing capture');
    await install(page);
    for (const scale of [1, 2]) {
      await capture(page, scale, true);
      const counts = await page.evaluate(`(async () => {
        const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return [0, 100].map(left => {
          const data = ctx.getImageData(left * ${scale}, 0, 100 * ${scale}, 100 * ${scale}).data;
          let red = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] < 20 && data[i + 3] === 255) red++;
          return red;
        });
      })()`);
      for (const [index, count] of counts.entries()) assert.ok(count > 2500 * scale ** 2 && count < 3800 * scale ** 2, `Icon ${index} should contain the triangle, found ${count} red pixels at ${scale}x`);
    }
  });
});

test('data images are successful only when they decode, with no authorization for invalid inline data', async () => {
  await withChromePage({ url: 'about:blank' }, async (page) => {
    await install(page);
    for (const kind of ['png', 'svg', 'invalid']) {
      await page.evaluate(`(() => {
        document.querySelector('#domshot-extension-root')?.shadowRoot.querySelector('.close')?.click();
        document.body.innerHTML = '';
        const image = new Image(40, 40);
        if ('${kind}' === 'png') { const c = document.createElement('canvas'); c.width = c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40); image.src = c.toDataURL(); }
        else if ('${kind}' === 'svg') image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>');
        else image.src = 'data:image/png;base64,bm90LWEtcG5n';
        document.body.append(image);
      })()`);
      await capture(page);
      const report = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { warned: Boolean(shadow.querySelector('.resource-warning')), grant: Boolean(shadow.querySelector('.grant-images')) };
      })()`);
      assert.deepEqual(report, { warned: kind === 'invalid', grant: false }, kind);
    }
  });
});
