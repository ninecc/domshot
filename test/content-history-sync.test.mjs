import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('preview reconciles externally deleted history on focus and can save the capture again', async () => {
  await withChromePage({ url: 'data:text/html,<main style="height:900px;background:steelblue"></main>' }, async (page) => {
    await page.evaluate(`(() => {
      if (!crypto.subtle) Object.defineProperty(crypto, 'subtle', {
        configurable: true,
        value: { async digest() { return new Uint8Array(32).buffer; } }
      });
      globalThis.storedCaptureIds = new Set();
      globalThis.historyMessages = [];
      globalThis.pendingCaptureId = null;
      globalThis.failHistoryRefresh = false;
      chrome.runtime = {
        onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} },
        async sendMessage(message) {
          if (!message.type.startsWith('DOMSHOT_HISTORY_')) return { ok: true };
          globalThis.historyMessages.push({ type: message.type, id: message.id, captureId: message.capture?.id });
          if (message.type === 'DOMSHOT_HISTORY_BEGIN') {
            globalThis.pendingCaptureId = message.capture.id;
            return { ok: true, alreadyStored: false, uploadToken: 'upload-token' };
          }
          if (message.type === 'DOMSHOT_HISTORY_COMMIT') {
            globalThis.storedCaptureIds.add(message.id);
            return { ok: true };
          }
          if (message.type === 'DOMSHOT_HISTORY_CONFIRM') {
            if (globalThis.failHistoryRefresh) throw new Error('history unavailable');
            return { state: globalThis.storedCaptureIds.has(message.capture.id) ? 'stored' : 'missing' };
          }
          if (message.type === 'DOMSHOT_HISTORY_RESTORE') return { ok: false };
          return { ok: true };
        }
      };
    })()`);
    await page.evaluate(bundle);
    await page.evaluate(`listener({
      type: 'DOMSHOT_VISIBLE_AREA',
      settings: { format: 'png', scale: 1, quality: 0.92, afterCapture: 'preview', filenameMode: 'smart', saveRecentCaptures: true, captureDelay: 0, embedFonts: false, reconcile: false, outerShadows: false, compress: true },
      locale: 'en', theme: 'light', pageZoom: 1
    }, {}, () => {})`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi === 'preview'`, 'Preview did not appear');
    assert.match(await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-status').textContent`), /saved to capture history/i);

    await page.evaluate(`globalThis.storedCaptureIds.clear(); globalThis.historyMessages = []; window.dispatchEvent(new Event('focus'))`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-toggle').dataset.state === 'save'`, 'Preview did not reconcile the external deletion');
    const reconciled = await page.evaluate(`(() => {
      const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
      return { status: shadow.querySelector('.history-retention-status').textContent, action: shadow.querySelector('.history-retention-toggle').textContent };
    })()`);
    assert.match(reconciled.status, /not saved to capture history/i);
    assert.match(reconciled.action, /save to history/i);

    await page.evaluate(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-toggle').click()`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-toggle').dataset.state === 'remove'`, 'Capture could not be saved again after external deletion');
    assert.equal(await page.evaluate(`globalThis.storedCaptureIds.size`), 1);

    await page.evaluate(`(() => {
      globalThis.failHistoryRefresh = true;
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await page.waitUntil(`/couldn.t complete that action/i.test(document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.history-retention-status').textContent)`, 'Refresh failure was not shown');
    const failure = await page.evaluate(`(() => {
      const shadow = document.querySelector('#domshot-extension-root').shadowRoot;
      return {
        imageReady: shadow.querySelector('.image-stage img').naturalWidth > 0,
        copyEnabled: !shadow.querySelector('.copy').disabled,
        downloadEnabled: !shadow.querySelector('.download').disabled,
      };
    })()`);
    assert.deepEqual(failure, { imageReady: true, copyEnabled: true, downloadEnabled: true });
  });
});
