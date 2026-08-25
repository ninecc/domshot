import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const chromePath = process.env.DOMSHOT_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'domshot-layout-'));
const popupUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/popup.html')).href;
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--window-size=360,600',
  popupUrl,
], { stdio: 'ignore' });

try {
  const port = await waitForDebugPort(profile);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome did not expose the popup page');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.setViewport(360, 600);
  await waitForReady(cdp);
  const stableBefore = await cdp.evaluate(`Object.fromEntries(
    ['.masthead', '.intro', '.actions', '.output-settings'].map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, { top: rect.top, width: rect.width, height: rect.height }];
    })
  )`);
  const metrics = await cdp.evaluate(`new Promise((resolve) => {
    document.querySelector('#settingsButton').click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      advancedHidden: document.querySelector('#advancedSettings').hidden,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      advancedOptionCount: document.querySelectorAll('.advanced-options .toggle-row').length,
      embedFontsChecked: document.querySelector('#embedFonts').checked,
      reconcileChecked: document.querySelector('#reconcile').checked,
      stableRegions: Object.fromEntries(
        ['.masthead', '.intro', '.actions', '.output-settings'].map((selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return [selector, { top: rect.top, width: rect.width, height: rect.height }];
        })
      )
    })));
  })`);
  cdp.close();

  assert.equal(metrics.advancedHidden, false, 'advanced settings did not open');
  assert.equal(metrics.advancedOptionCount, 2, 'advanced settings must expose both quality options');
  assert.equal(metrics.embedFontsChecked, true, 'font embedding must remain enabled by default');
  assert.equal(metrics.reconcileChecked, false, 'layout reconciliation must be opt-in');
  assert.ok(metrics.scrollWidth <= 360, `expanded popup is ${metrics.scrollWidth}px wide`);
  assert.ok(metrics.scrollHeight <= 600, `expanded popup is ${metrics.scrollHeight}px tall and requires a scrollbar`);
  assert.deepEqual(metrics.stableRegions, stableBefore, 'opening advanced settings moved or resized existing content');
  console.log(`Expanded popup: ${metrics.scrollWidth}×${metrics.scrollHeight}px; viewport: ${metrics.viewportWidth}×${metrics.viewportHeight}px.`);
} finally {
  chrome.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}

async function waitForDebugPort(directory) {
  const file = join(directory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return Number((await readFile(file, 'utf8')).split('\n')[0]);
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
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
    close: () => socket.close(),
    setViewport: (width, height) => send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }),
    evaluate: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
  };
}

async function waitForReady(cdp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await cdp.evaluate('document.readyState === "complete"')) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Popup did not finish loading');
}
