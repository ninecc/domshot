import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';
import { triangleFont } from './support/triangle-font.mjs';
import { mirroredTriangleFont } from './support/mirrored-triangle-font.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

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

test('icon fonts select the matching face when one PUA codepoint has multiple glyphs', async () => {
  const html = `<style>
    @font-face{font-family:MultiIcon;src:url(${triangleFont});font-weight:400;font-style:normal;unicode-range:U+E000-E0FF}
    @font-face{font-family:MultiIcon;src:url(${mirroredTriangleFont});font-weight:700;font-style:italic;unicode-range:U+E001}
    body{margin:0;background:white}.icon{display:block;width:100px;height:100px;color:red;font-family:MultiIcon;font-size:100px;line-height:100px}
    .alternate{font-weight:700;font-style:italic}.pseudo::before{content:"\\e001"}
  </style><main style="width:120px;height:400px"><span class="icon">&#xe001;</span><span class="icon alternate">&#xe001;</span><span class="icon pseudo"></span><span class="icon pseudo alternate"></span></main>`;
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}`, viewport: { width: 120, height: 400 } }, async (page) => {
    assert.deepEqual(await page.evaluate(`Promise.all([
      document.fonts.load('normal 400 100px MultiIcon', '\ue001'),
      document.fonts.load('italic 700 100px MultiIcon', '\ue001')
    ]).then(results => results.map(faces => faces.length))`), [1, 1], 'Both distinguishable faces must load');
    assert.deepEqual(await page.evaluate(`(() => {
      const icons = [...document.querySelectorAll('.icon')];
      return [
        getComputedStyle(icons[0]),
        getComputedStyle(icons[1]),
        getComputedStyle(icons[2], '::before'),
        getComputedStyle(icons[3], '::before'),
      ].map(style => [style.fontWeight, style.fontStyle]);
    })()`), [['400', 'normal'], ['700', 'italic'], ['400', 'normal'], ['700', 'italic']], 'Live direct and pseudo glyphs must request distinct faces');
    await install(page);
    await capture(page);
    const halves = await page.evaluate(`(async () => {
      const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [0, 1, 2, 3].map(index => {
        const data = context.getImageData(0, index * 100, 100, 100).data;
        let left = 0, right = 0;
        for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
          const offset = (y * 100 + x) * 4;
          if (data[offset] > 240 && data[offset + 1] < 20 && data[offset + 2] < 20) x < 50 ? left++ : right++;
        }
        return { left, right };
      });
    })()`);
    assert.ok(halves[0].left > halves[0].right * 2, `Regular direct glyph used the wrong face: ${JSON.stringify(halves[0])}`);
    assert.ok(halves[1].right > halves[1].left, `Alternate direct glyph used the wrong face: ${JSON.stringify(halves[1])}`);
    assert.ok(halves[2].left > halves[2].right * 2, `Regular pseudo glyph used the wrong face: ${JSON.stringify(halves[2])}`);
    assert.ok(halves[3].right > halves[3].left, `Alternate pseudo glyph used the wrong face: ${JSON.stringify(halves[3])}`);
  });
});

test('unreadable cross-origin font stylesheets do not broaden image permissions', async () => {
  const stylesheetServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(`@font-face{font-family:RemoteIcon;src:url(${triangleFont})}.remote{font:100px/100px RemoteIcon;color:red}.remote::before{content:"\\e001"}`);
  });
  const stylesheetUrl = `http://127.0.0.1:${stylesheetServer.address().port}/icons.css`;
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<link rel="stylesheet" href="${stylesheetUrl}"><main class="remote" style="width:100px;height:100px"></main>`);
  });
  try {
    await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 120, height: 120 } }, async (page) => {
      assert.equal(await page.evaluate(`document.fonts.load('100px RemoteIcon', '\ue001').then(faces => faces.length === 1)`), true, 'Remote stylesheet font must load in the live page');
      assert.equal(await page.evaluate(`(() => { try { void document.styleSheets[0].cssRules; return false; } catch (error) { return error.name === 'SecurityError'; } })()`), true, 'Fixture stylesheet must be unreadable through CSSOM');
      await page.evaluate(`(() => {
        globalThis.imageResolveCalls = [];
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              imageResolveCalls.push(message.urls);
              return { resources: [] };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const result = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { preview: Boolean(shadow.querySelector('.image-stage img')), imagePermission: Boolean(shadow.querySelector('.grant-images')), imageResolveCalls };
      })()`);
      assert.deepEqual(result, { preview: true, imagePermission: false, imageResolveCalls: [] });
    });
  } finally {
    stylesheetServer.close();
    pageServer.close();
  }
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

test('failed image placeholders use the dimensions frozen from the live layout', async () => {
  await withChromePage({ url: 'about:blank', viewport: { width: 300, height: 200 } }, async (page) => {
    await install(page);
    await page.evaluate(`document.body.innerHTML = '<img style="display:block;width:73px;height:41px" src="data:image/png;base64,bm90LWEtcG5n">'`);
    await capture(page);
    const bounds = await page.evaluate(`(async () => {
      const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] === 204 && data[i + 1] === 204 && data[i + 2] === 204 && data[i + 3] === 255) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      return { width: maxX - minX + 1, height: maxY - minY + 1 };
    })()`);
    assert.deepEqual(bounds, { width: 73, height: 41 });
  });
});

test('cross-origin CSS sprites are proxied for elements and generated content without changing their crop', async () => {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="red"/><rect x="10" width="10" height="10" fill="blue"/></svg>';
  const imageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end(sprite);
  });
  const imageUrl = `http://127.0.0.1:${imageServer.address().port}/sprite.svg`;
  const dataSprite = `data:image/svg+xml,${encodeURIComponent(sprite)}`;
  let pagePort = 0;
  const pageServer = await listen((request, response) => {
    if (request.url === '/same-origin.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(sprite);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>body{margin:0;background:white}.direct,.same,.data{float:left;width:10px;height:10px;background-position:-10px 0;background-size:20px 10px;background-repeat:no-repeat}.direct{background-image:linear-gradient(transparent,transparent),url(${imageUrl});background-position:0 0,-10px 0;background-size:auto,20px 10px}.pseudo{float:left}.pseudo::before{content:"";display:block;width:10px;height:10px;background-image:url(${imageUrl});background-position:0 0;background-size:20px 10px;background-repeat:no-repeat}.same{background-image:url(http://127.0.0.1:${pagePort}/same-origin.svg)}.data{background-image:url("${dataSprite}")}</style><div class="direct"></div><div class="pseudo"></div><div class="same"></div><div class="data"></div>`);
  });
  pagePort = pageServer.address().port;
  try {
    await withChromePage({ url: `http://127.0.0.1:${pagePort}/`, viewport: { width: 40, height: 20 } }, async (page) => {
      assert.deepEqual(await page.evaluate(`(() => {
        const direct = getComputedStyle(document.querySelector('.direct')).backgroundImage;
        const pseudo = getComputedStyle(document.querySelector('.pseudo'), '::before').backgroundImage;
        return [direct.includes(${JSON.stringify(imageUrl)}), pseudo.includes(${JSON.stringify(imageUrl)})];
      })()`), [true, true], 'Fixture backgrounds must be loaded by the page');
      await page.evaluate(`(() => {
        const sprite = 'data:image/svg+xml,' + encodeURIComponent(${JSON.stringify(sprite)});
        globalThis.resolveRequests = [];
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              resolveRequests.push(message.urls);
              return { resources: message.urls.map(url => ({ url, dataUrl: sprite })) };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const result = await page.evaluate(`(async () => {
        const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return {
          direct: [...context.getImageData(5, 5, 1, 1).data],
          pseudo: [...context.getImageData(15, 5, 1, 1).data],
          sameOrigin: [...context.getImageData(25, 5, 1, 1).data],
          data: [...context.getImageData(35, 5, 1, 1).data],
          requests: resolveRequests,
        };
      })()`);
      assert.deepEqual(result.requests, [[imageUrl, `http://127.0.0.1:${pagePort}/same-origin.svg`]], 'Repeated URLs are deduplicated while same-origin entries remain redirect-aware');
      assert.deepEqual(result.direct, [0, 0, 255, 255]);
      assert.deepEqual(result.pseudo, [255, 0, 0, 255]);
      assert.deepEqual(result.sameOrigin, [0, 0, 255, 255]);
      assert.deepEqual(result.data, [0, 0, 255, 255]);
    });
  } finally {
    imageServer.close();
    pageServer.close();
  }
});

test('CSS background failures authorize only confirmed permission failures', async () => {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
  const imageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end(sprite);
  });
  const imageUrl = `http://127.0.0.1:${imageServer.address().port}/background.svg`;
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>body{margin:0}.resource{width:10px;height:10px;background:url(${imageUrl}) no-repeat}</style><div class="resource"></div>`);
  });
  try {
    for (const reason of ['permission', 'fetch']) {
      await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 20, height: 20 } }, async (page) => {
        await page.evaluate(`(() => {
          globalThis.permissionRequest = null;
          chrome.runtime = {
            onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
            async sendMessage(message) {
              if (message.type === 'DOMSHOT_RESOLVE_IMAGES') return {
                resources: message.urls.map(url => ({ url, reason: ${JSON.stringify(reason)}, ...(${JSON.stringify(reason)} === 'permission' ? { permissionUrl: 'https://assets.example/final.svg' } : {}) }))
              };
              if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
                permissionRequest = message;
                return { prepared: true, frameUrl: 'about:blank' };
              }
              return { ok: true };
            }
          };
        })()`);
        await page.evaluate(bundle);
        await capture(page);
        const warning = await page.evaluate(`(() => {
          const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
          return { warned: Boolean(shadow.querySelector('.resource-warning')), grant: Boolean(shadow.querySelector('.grant-images')) };
        })()`);
        assert.deepEqual(warning, { warned: true, grant: reason === 'permission' });
        if (reason === 'permission') {
          await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
          await page.waitUntil(`globalThis.permissionRequest !== null`, 'Permission request was not prepared');
          assert.deepEqual(await page.evaluate(`permissionRequest.origins`), ['https://assets.example']);
        }
      });
    }
  } finally {
    imageServer.close();
    pageServer.close();
  }
});

test('a proxied cross-origin document background retains its positioning and repetition', async () => {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="red"/><rect x="10" width="10" height="10" fill="blue"/></svg>';
  const imageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end(sprite);
  });
  const imageUrl = `http://127.0.0.1:${imageServer.address().port}/document-sprite.svg`;
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>html{background:transparent}body{margin:0;background:url(${imageUrl}) -10px 0/20px 10px repeat}</style><main style="width:40px;height:20px"></main>`);
  });
  try {
    await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 40, height: 20 } }, async (page) => {
      await page.evaluate(`(() => {
        const sprite = 'data:image/svg+xml,' + encodeURIComponent(${JSON.stringify(sprite)});
        globalThis.resolveRequests = [];
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              resolveRequests.push(message.urls);
              return { resources: message.urls.map(url => ({ url, dataUrl: sprite })) };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const result = await page.evaluate(`(async () => {
        const image = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return {
          blue: [...context.getImageData(5, 5, 1, 1).data],
          red: [...context.getImageData(15, 5, 1, 1).data],
          repeatedBlue: [...context.getImageData(25, 15, 1, 1).data],
          requests: resolveRequests,
        };
      })()`);
      assert.deepEqual(result.requests, [[imageUrl]]);
      assert.deepEqual(result.blue, [0, 0, 255, 255]);
      assert.deepEqual(result.red, [255, 0, 0, 255]);
      assert.deepEqual(result.repeatedBlue, [0, 0, 255, 255]);
    });
  } finally {
    imageServer.close();
    pageServer.close();
  }
});

test('a same-origin CSS URL redirected to a CDN reports the final permission origin', async () => {
  const imageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  });
  const finalUrl = `http://127.0.0.1:${imageServer.address().port}/final.svg`;
  let entryUrl = '';
  const pageServer = await listen((request, response) => {
    if (request.url === '/entry.svg') {
      response.writeHead(302, { location: finalUrl }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>body{margin:0}.resource{width:10px;height:10px;background:url(${entryUrl})}</style><div class="resource"></div>`);
  });
  entryUrl = `http://127.0.0.1:${pageServer.address().port}/entry.svg`;
  try {
    await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 20, height: 20 } }, async (page) => {
      await page.evaluate(`(() => {
        globalThis.resolveRequests = [];
        globalThis.permissionRequest = null;
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              resolveRequests.push(message.urls);
              return { resources: message.urls.map(url => ({ url, reason: 'permission', permissionUrl: ${JSON.stringify(finalUrl)} })) };
            }
            if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
              permissionRequest = message;
              return { prepared: true, frameUrl: 'about:blank' };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const state = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return { requests: resolveRequests, grant: Boolean(shadow.querySelector('.grant-images')) };
      })()`);
      assert.deepEqual(state.requests, [[entryUrl]]);
      assert.equal(state.grant, true);
      await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.grant-images').click()`);
      await page.waitUntil(`globalThis.permissionRequest !== null`, 'Redirect permission request was not prepared');
      assert.deepEqual(await page.evaluate(`permissionRequest.origins`), [`http://127.0.0.1:${imageServer.address().port}`]);
    });
  } finally {
    imageServer.close();
    pageServer.close();
  }
});

test('proxy replacement preserves a different background layer already inlined by SnapDOM', async () => {
  const proxySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="red"/></svg>';
  const corsSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="blue"/></svg>';
  const imageServer = await listen((request, response) => {
    response.writeHead(200, {
      'content-type': 'image/svg+xml',
      ...(request.url === '/cors.svg' ? { 'access-control-allow-origin': '*' } : {}),
    });
    response.end(request.url === '/cors.svg' ? corsSvg : proxySvg);
  });
  const proxyUrl = `http://127.0.0.1:${imageServer.address().port}/proxy.svg`;
  const corsUrl = `http://127.0.0.1:${imageServer.address().port}/cors.svg`;
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>body{margin:0}.layers{width:20px;height:10px;background-image:url(${proxyUrl}),url(${corsUrl});background-size:20px 10px;background-repeat:no-repeat}</style><div class="layers"></div>`);
  });
  try {
    await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 20, height: 10 } }, async (page) => {
      await page.evaluate(`(() => {
        const proxyData = 'data:image/svg+xml,' + encodeURIComponent(${JSON.stringify(proxySvg)});
        globalThis.resolveRequests = [];
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              resolveRequests.push(message.urls);
              return { resources: message.urls.map(url => url === ${JSON.stringify(proxyUrl)} ? { url, dataUrl: proxyData } : { url, reason: 'fetch' }) };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const result = await page.evaluate(`(async () => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        const image = shadow.querySelector('.image-stage img'); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return {
          left: [...context.getImageData(5, 5, 1, 1).data],
          right: [...context.getImageData(15, 5, 1, 1).data],
          warned: Boolean(shadow.querySelector('.resource-warning')),
          requests: resolveRequests,
        };
      })()`);
      assert.deepEqual(result.requests, [[proxyUrl, corsUrl]]);
      assert.deepEqual(result.left, [255, 0, 0, 255]);
      assert.deepEqual(result.right, [0, 0, 255, 255]);
      assert.equal(result.warned, false, 'A layer inlined by SnapDOM must not be reported missing');
    });
  } finally {
    imageServer.close();
    pageServer.close();
  }
});

test('CSS backgrounds beyond the 64-URL capture limit warn once without paging or authorization', async () => {
  const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>';
  const imageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end(pixel);
  });
  const urls = Array.from({ length: 65 }, (_, index) => `http://127.0.0.1:${imageServer.address().port}/${index}.svg`);
  const pageServer = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<style>body{margin:0;display:flex}.resource{width:1px;height:1px;flex:none}</style>${urls.map(url => `<i class="resource" style="background-image:url(${url})"></i>`).join('')}`);
  });
  try {
    await withChromePage({ url: `http://127.0.0.1:${pageServer.address().port}/`, viewport: { width: 65, height: 10 } }, async (page) => {
      await page.evaluate(`(() => {
        const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(${JSON.stringify(pixel)});
        globalThis.resolveRequests = [];
        globalThis.limitedResources = [];
        chrome.runtime = {
          onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
          async sendMessage(message) {
            if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
              resolveRequests.push(message.urls);
              const resources = message.urls.map((url, index) => index < 64 ? { url, dataUrl } : { url, reason: 'limit' });
              limitedResources = resources.filter(resource => resource.reason === 'limit');
              return { resources };
            }
            return { ok: true };
          }
        };
      })()`);
      await page.evaluate(bundle);
      await capture(page);
      const state = await page.evaluate(`(() => {
        const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
        return {
          requestCount: resolveRequests.length,
          requestedUrls: resolveRequests[0],
          limitedResources,
          warning: shadow.querySelector('.resource-warning')?.textContent || '',
          grant: Boolean(shadow.querySelector('.grant-images')),
        };
      })()`);
      assert.equal(state.requestCount, 1, 'The capture must not page past its resource safety limit');
      assert.deepEqual(state.requestedUrls, urls);
      assert.deepEqual(state.limitedResources, [{ url: urls[64], reason: 'limit' }]);
      assert.match(state.warning, /1 image resource couldn.t be loaded.*Some content may be missing/s);
      assert.equal(state.grant, false);
    });
  } finally {
    imageServer.close();
    pageServer.close();
  }
});
