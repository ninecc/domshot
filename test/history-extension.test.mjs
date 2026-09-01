import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const extensionPath = resolve(import.meta.dirname, '../dist');
const contentBundle = await readFile(resolve(extensionPath, 'content.js'), 'utf8');

test('a real capture is persisted by the extension service worker', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'domshot-history-'));
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profile,
    enableExtensions: [extensionPath],
    ...(process.env.DOMSHOT_CHROME_PATH ? { executablePath: process.env.DOMSHOT_CHROME_PATH } : { channel: 'chrome' }),
  });

  try {
    const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'), { timeout: 5000 });
    const extensionId = new URL(workerTarget.url()).hostname;
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await page.evaluate(`(() => {
      const addListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
      chrome.runtime.onMessage.addListener = (listener) => {
        globalThis.__contentMessageListener = listener;
        return addListener(listener);
      };
    })()`);
    await page.evaluate(contentBundle);
    await page.evaluate(`chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_CLEAR' })`);

    await page.evaluate(`globalThis.__contentMessageListener({
      type: 'DOMSHOT_VISIBLE_AREA', pageZoom: 1, locale: 'en', theme: 'light',
      settings: { format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'timestamp', captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true }
    }, {}, () => {})`);

    await page.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_LIST' }))?.captures?.length === 1, { polling: 100, timeout: 5000 });
    const result = await page.evaluate(`chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_LIST' })`);
    const captures = result.captures;
    assert.equal(captures.length, 1);
    assert.equal(captures[0].width, 360);
    assert.equal(captures[0].height, 600);

    const largeCapture = await page.evaluate(`(async () => {
      await chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_CLEAR' });
      const byteLength = 49 * 1024 * 1024;
      const chunkSize = 3 * 256 * 1024;
      const bytes = new Uint8Array(byteLength);
      const encode = (chunk) => {
        let binary = '';
        for (let offset = 0; offset < chunk.length; offset += 0x8000) binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000));
        return btoa(binary);
      };
      let error = '';
      try {
        await chrome.runtime.sendMessage({
          type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: Math.ceil(byteLength / chunkSize),
          capture: {
            id: 'large-capture', createdAt: 2, label: 'Large capture', filename: 'large.png', format: 'png',
            width: 8000, height: 6000, scale: 3, size: byteLength, sourceHost: 'example.com', thumbnailDataUrl: 'data:image/png;base64,AA=='
          }
        });
        for (let offset = 0, index = 0; offset < byteLength; offset += chunkSize, index += 1) {
          await chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'large-capture', index, data: encode(bytes.subarray(offset, offset + chunkSize)) });
        }
        await chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'large-capture' });
      } catch (caught) { error = caught?.message || String(caught); }
      const history = await chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      return { error, count: history.captures.length };
    })()`);
    assert.equal(largeCapture.count, 1, `large capture was not stored: ${largeCapture.error}`);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
