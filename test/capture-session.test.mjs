import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');
const settings = { format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'smart', saveRecentCaptures: false, captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true };

async function install(page) {
  await page.evaluate(`
    globalThis.historyMessages = [];
    chrome.runtime = {
      onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
      async sendMessage(message) {
        if (message.type.startsWith('DOMSHOT_HISTORY_')) globalThis.historyMessages.push(message);
        if (globalThis.holdHistory && message.type === 'DOMSHOT_HISTORY_BEGIN') {
          globalThis.historyStarted = true;
          return new Promise(resolve => { globalThis.finishHistory = resolve; });
        }
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') return { ok: true, uploadToken: 'upload-token' };
        return { ok: true };
      }
    };
  `);
  await page.evaluate(bundle);
}

async function request(page, type, overrides = {}) {
  return page.evaluate(`(() => {
    let response;
    listener({
      type: ${JSON.stringify(type)},
      settings: ${JSON.stringify({ ...settings, ...overrides })},
      locale: 'en', theme: 'light', pageZoom: 1
    }, {}, value => { response = value; });
    return response;
  })()`);
}

test('picker ignores its own toolbar and cancels pending selection work on Escape', async () => {
  await withChromePage({ url: 'data:text/html,<main id="target" style="margin:80px;width:260px;height:180px;background:tomato"></main>' }, async (page) => {
    await install(page);
    await request(page, 'DOMSHOT_SELECT');
    await page.evaluate(`(() => {
      const target = document.querySelector('#target').getBoundingClientRect();
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: target.left + 20, clientY: target.top + 20 }));
    })()`);
    const toolbar = await page.evaluate(`(() => {
      const rect = document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.toolbar').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await page.moveMouse(toolbar.x, toolbar.y);
    await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.toolbar').click()`);
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'selector', 'clicking picker chrome must not start a capture');

    await page.evaluate(`(() => {
      const target = document.querySelector('#target').getBoundingClientRect();
      const init = { bubbles: true, clientX: target.left + 20, clientY: target.top + 20 };
      document.dispatchEvent(new MouseEvent('mousemove', init));
      document.dispatchEvent(new MouseEvent('click', init));
      window.__domShotCleanup();
      delete window.__domShotProtocol;
    })()`);
    await page.evaluate(bundle);
    await request(page, 'DOMSHOT_SELECT');
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'selector', 're-entry must cancel the detached picker timer');

    await page.evaluate(`(() => {
      const target = document.querySelector('#target').getBoundingClientRect();
      const init = { bubbles: true, clientX: target.left + 20, clientY: target.top + 20 };
      document.dispatchEvent(new MouseEvent('mousemove', init));
      document.dispatchEvent(new MouseEvent('click', init));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    })()`);
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'toast');
  });
});

test('capture jobs reject overlap without replacing progress and Escape cancels delay', async () => {
  await withChromePage({ url: 'data:text/html,<main style="height:1200px;background:steelblue"></main>' }, async (page) => {
    await install(page);
    assert.deepEqual(await request(page, 'DOMSHOT_FULL_PAGE', { captureDelay: 500 }), { started: true });
    const second = await request(page, 'DOMSHOT_VISIBLE_AREA');
    assert.deepEqual(second, { started: false });
    const busy = await page.evaluate(`(() => {
      const host = document.querySelector('#domshot-extension-root');
      return { kind: host?.dataset.domshotUi, text: host?.shadowRoot.textContent || '' };
    })()`);
    assert.equal(busy.kind, 'progress');
    assert.match(busy.text, /already in progress/i);
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(await page.evaluate(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi`), 'toast');
  });
});

test('a busy permission retry keeps its token for a later attempt', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  const imageServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(png);
  });
  imageServer.listen(0, '127.0.0.1');
  await once(imageServer, 'listening');
  const imageUrl = `http://127.0.0.1:${imageServer.address().port}/image.png`;
  const pageServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<main><img src="${imageUrl}" width="40" height="30"></main>`);
  });
  pageServer.listen(0, '127.0.0.1');
  await once(pageServer, 'listening');
  const url = `http://127.0.0.1:${pageServer.address().port}/`;
  try {
    await withChromePage({ url }, async (page) => {
    await page.evaluate(`
      globalThis.retryResponses = [];
      globalThis.permissionToken = null;
      globalThis.autoRetryPermission = true;
      chrome.runtime = {
        onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
        async sendMessage(message) {
          if (message.type === 'DOMSHOT_RESOLVE_IMAGES') return {
            resources: message.urls.map(url => ({ url, reason: 'permission', permissionUrl: url }))
          };
          if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
            globalThis.permissionToken = message.token;
            globalThis.listener({ type: 'DOMSHOT_RETRY_CAPTURE', token: message.token }, {}, value => globalThis.retryResponses.push(value));
            return { prepared: true, frameUrl: 'about:blank' };
          }
          return { ok: true };
        }
      };
      new MutationObserver(() => {
        if (!globalThis.autoRetryPermission) return;
        const button = document.querySelector('#domshot-extension-root')?.shadowRoot?.querySelector('.grant-images');
        if (!button) return;
        globalThis.autoRetryPermission = false;
        button.click();
      }).observe(document.documentElement, { childList: true, subtree: true });
    `);
    await page.evaluate(bundle);
    await request(page, 'DOMSHOT_VISIBLE_AREA');
    await page.waitUntil(`globalThis.retryResponses.length === 1`, 'Permission retry did not run during capture completion');
    const busy = await page.evaluate(`globalThis.retryResponses[0]`);
    assert.equal(busy.started, false);
    assert.equal(busy.reason, 'busy');

    await page.waitUntil(`Boolean(globalThis.permissionToken)`, 'Permission retry token was not registered');
    const retried = await page.evaluate(`new Promise(resolve => listener({ type: 'DOMSHOT_RETRY_CAPTURE', token: globalThis.permissionToken }, {}, resolve))`);
    assert.equal(retried.started, true, 'busy retry consumed the token before a later attempt');
    });
  } finally {
    pageServer.close();
    imageServer.close();
    await Promise.all([once(pageServer, 'close'), once(imageServer, 'close')]);
  }
});

test('history upload is a commit point and Escape no longer reports cancellation', async () => {
  await withChromePage({ url: 'data:text/html,<main style="height:900px;background:steelblue"></main>' }, async (page) => {
    await install(page);
    await page.evaluate(`globalThis.holdHistory = true; globalThis.historyStarted = false; globalThis.finishHistory = null`);
    await request(page, 'DOMSHOT_VISIBLE_AREA', { saveRecentCaptures: true });
    await page.waitUntil(`globalThis.historyStarted`, 'History upload did not start');
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); globalThis.finishHistory({ ok: true, uploadToken: 'upload-token' })`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Committed history capture did not finish');
    const result = await page.evaluate(`(() => {
      const host = document.querySelector('#domshot-extension-root');
      return { text: host.shadowRoot.textContent, history: host.shadowRoot.querySelector('.history-retention-status').textContent };
    })()`);
    assert.doesNotMatch(result.text, /capture canceled/i);
    assert.match(result.history, /saved to capture history/i);
  });
});

test('automatic copy is a commit point and Escape does not contradict its result', async () => {
  await withChromePage({ url: 'data:text/html,<main style="height:900px;background:steelblue"></main>' }, async (page) => {
    await install(page);
    await page.evaluate(`(() => {
      globalThis.copyStarted = false;
      globalThis.finishCopy = null;
      Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class ClipboardItem {} });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { write() { globalThis.copyStarted = true; return new Promise(resolve => { globalThis.finishCopy = resolve; }); } }
      });
    })()`);
    await request(page, 'DOMSHOT_VISIBLE_AREA', { afterCapture: 'copy' });
    await page.waitUntil(`globalThis.copyStarted`, 'Automatic copy did not start');
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); globalThis.finishCopy()`);
    await new Promise(resolve => setTimeout(resolve, 180));
    const result = await page.evaluate(`(() => {
      const host = document.querySelector('#domshot-extension-root');
      return { kind: host?.dataset.domshotUi, text: host?.shadowRoot.textContent || '' };
    })()`);
    assert.equal(result.kind, 'toast');
    assert.match(result.text, /image copied/i);
    assert.doesNotMatch(result.text, /capture canceled/i);
  });
});

test('picker controls stay screen-stable and outline remains aligned across page and visual zoom', async () => {
  await withChromePage({ url: 'data:text/html,<main id="target" style="margin:100px;width:240px;height:160px;background:tomato"></main>' }, async (page) => {
    await install(page);
    const results = [];
    for (const { pageZoom, visualScale } of [{ pageZoom: 1, visualScale: 1 }, { pageZoom: 1.5, visualScale: 1 }, { pageZoom: 0.8, visualScale: 2 }]) {
      await page.setPageScale(visualScale);
      await page.evaluate(`listener({ type: 'DOMSHOT_SELECT', settings: ${JSON.stringify(settings)}, locale: 'en', theme: 'light', pageZoom: ${pageZoom} }, {}, () => {})`);
      await page.evaluate(`(() => {
        const rect = document.querySelector('#target').getBoundingClientRect();
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 20 }));
      })()`);
      results.push(await page.evaluate(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        const toolbar = host.shadowRoot.querySelector('.toolbar').getBoundingClientRect();
        const outline = host.shadowRoot.querySelector('.outline').getBoundingClientRect();
        const target = document.querySelector('#target').getBoundingClientRect();
        const scale = ${pageZoom} * visualViewport.scale;
        return {
          toolbarWidth: toolbar.width * scale,
          toolbarTopGap: (toolbar.top - visualViewport.offsetTop) * scale,
          outlineDelta: Math.max(Math.abs(outline.left - target.left), Math.abs(outline.top - target.top), Math.abs(outline.width - target.width), Math.abs(outline.height - target.height)),
        };
      })()`));
      await page.evaluate(`window.__domShotCleanup()`);
      await page.evaluate(bundle);
    }
    const baseline = results[0];
    for (const result of results) {
      assert.ok(Math.abs(result.toolbarWidth - baseline.toolbarWidth) < 1, `toolbar width changed from ${baseline.toolbarWidth} to ${result.toolbarWidth}`);
      assert.ok(Math.abs(result.toolbarTopGap - baseline.toolbarTopGap) < 1, `toolbar top gap changed from ${baseline.toolbarTopGap} to ${result.toolbarTopGap}`);
      assert.ok(result.outlineDelta < 0.5, `outline missed target by ${result.outlineDelta}px`);
    }
  });
});
