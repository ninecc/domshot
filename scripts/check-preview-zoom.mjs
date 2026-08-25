import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const chromePath = process.env.DOMSHOT_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'domshot-preview-'));
const contentBundle = await readFile(resolve(import.meta.dirname, '../dist/content.js'), 'utf8');
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=800,600',
  'data:text/html,<main><h1>DOMShot zoom test</h1><p>Stable capture content</p></main>',
], { stdio: 'ignore' });
const chromeExited = new Promise((resolveExit) => chrome.once('exit', resolveExit));

try {
  const port = await waitForDebugPort(profile);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find(({ type }) => type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose the test page');
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await waitForReady(page);
  await page.evaluate(`
    window.__domShotLoaded = true;
    chrome.runtime = {
      onMessage: {
        addListener(listener) { globalThis.__domshotListener = listener; },
        removeListener() {}
      }
    }`);
  await page.evaluate(contentBundle);
  assert.equal(await page.evaluate('typeof globalThis.__domshotListener'), 'function', 'updated content script did not replace a stale injected version');

  const results = [];
  for (const pageZoom of [0.5, 0.8, 1, 1.25, 1.5, 2]) {
    for (const pinchZoom of [1, 1.5, 2]) {
      await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: pinchZoom });
      await page.evaluate(`globalThis.__domshotListener({
        type: 'DOMSHOT_FULL_PAGE', settings: { format: 'png', scale: 1, embedFonts: false }, pageZoom: ${pageZoom}
      }, {}, () => {})`);
      await waitForPreview(page);
      results.push(await page.evaluate(`(() => {
        const host = document.querySelector('#domshot-extension-root');
        const card = host.shadowRoot.querySelector('.preview-card');
        const image = card.querySelector('img');
        const rect = card.getBoundingClientRect();
        const viewport = visualViewport;
        const screenScale = ${pageZoom} * viewport.scale;
        return {
          pageZoom: ${pageZoom}, pinchZoom: viewport.scale,
          screenWidth: rect.width * screenScale,
          screenRightGap: (viewport.pageLeft + viewport.width - rect.right) * screenScale,
          screenBottomGap: (viewport.pageTop + viewport.height - rect.bottom) * screenScale,
          imageWidth: image.naturalWidth, imageHeight: image.naturalHeight
        };
      })()`));
    }
  }
  const baseline = results.find(({ pageZoom, pinchZoom }) => pageZoom === 1 && pinchZoom === 1);
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

  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.evaluate(`globalThis.__domshotListener({
    type: 'DOMSHOT_FULL_PAGE', settings: { format: 'png', scale: 1, embedFonts: false }, pageZoom: 1.25
  }, {}, () => {})`);
  await waitForPreview(page);
  await page.evaluate(`globalThis.__domshotListener({ type: 'DOMSHOT_ZOOM_CHANGED', pageZoom: 0.33 }, {}, () => {})`);
  await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const changedZoom = await page.evaluate(`(() => {
    const host = document.querySelector('#domshot-extension-root');
    const rect = host.shadowRoot.querySelector('.preview-card').getBoundingClientRect();
    return { pageZoom: host.dataset.domshotPageZoom, screenWidth: rect.width * 0.33 };
  })()`);
  assert.equal(changedZoom.pageZoom, '0.33', 'preview retained the zoom captured when selection started');
  assert.ok(Math.abs(changedZoom.screenWidth - 336) < 0.1, `preview did not respond to live tab zoom: ${changedZoom.screenWidth}px`);
  page.close();
  console.log('Preview remains 336px wide with 18px gaps across independent page and pinch zoom levels.');
} finally {
  chrome.kill('SIGTERM');
  await chromeExited;
  await rm(profile, { recursive: true, force: true });
}

async function waitForPreview(page) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await page.evaluate(`(() => {
      const host = document.querySelector('#domshot-extension-root');
      return host?.dataset.domshotUi === 'preview' && Boolean(host.shadowRoot?.querySelector('.preview-card img')?.complete);
    })()`)) return;
    await delay(25);
  }
  throw new Error('Preview did not become ready');
}

async function waitForDebugPort(directory) {
  const file = join(directory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return Number((await readFile(file, 'utf8')).split('\n')[0]); }
    catch { await delay(50); }
  }
  throw new Error('Chrome debugging port did not become ready');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveResult, rejectResult) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveResult, reject: rejectResult });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    close: () => socket.close(), send,
    evaluate: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
  };
}

async function waitForReady(page) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await page.evaluate('document.readyState === "complete"')) return;
    await delay(25);
  }
  throw new Error('Test page did not finish loading');
}

function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }
