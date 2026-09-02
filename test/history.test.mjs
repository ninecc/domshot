import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const backgroundBundle = await readFile(resolve(import.meta.dirname, '../dist/background.js'), 'utf8');
const blankPageUrl = pathToFileURL(resolve(import.meta.dirname, '../public/popup.html')).href;

test('recent capture storage keeps only the newest 10 items', async () => {
  await withChromePage({ url: blankPageUrl }, async (page) => {
    await page.evaluate(`(() => {
      globalThis.chrome = {
        tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
        runtime: { onMessage: { addListener(listener) { globalThis.__historyMessageListener = listener; } } }
      };
      const deleteFromStore = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        const request = deleteFromStore.apply(this, args);
        request.addEventListener('success', () => {
          if (globalThis.__historyDeleteTiming) globalThis.__historyDeleteTiming.request = ++globalThis.__historySequence;
        });
        this.transaction.addEventListener('complete', () => {
          if (globalThis.__historyDeleteTiming) globalThis.__historyDeleteTiming.transaction = ++globalThis.__historySequence;
        });
        return request;
      };
      (0, eval)(${JSON.stringify(backgroundBundle)});
      globalThis.__sendHistoryMessage = (message) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('History message timed out')), 3000);
        globalThis.__historyMessageListener(message, {}, (response) => { clearTimeout(timeout); resolve(response); });
      });
    })()`);

    const result = await page.evaluate(`(async () => {
      const image = 'data:image/png;base64,AA==';
      for (let index = 0; index < 12; index += 1) {
        await globalThis.__sendHistoryMessage({
          type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
          capture: {
            id: 'capture-' + index, createdAt: index, label: 'Capture ' + index,
            filename: 'capture-' + index + '.png', format: 'png', width: 100, height: 80,
            scale: 2, size: 1, sourceHost: 'example.com', thumbnailDataUrl: image
          }
        });
        await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'capture-' + index, index: 0, data: 'AA==' });
        await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'capture-' + index });
      }
      const listed = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      const detail = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_GET', id: 'capture-11' });
      const detailChunk = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_READ', id: 'capture-11', offset: 0, length: detail.capture.byteLength });
      globalThis.__historySequence = 0;
      globalThis.__historyDeleteTiming = {};
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_DELETE', id: 'capture-11' });
      globalThis.__historyDeleteTiming.response = ++globalThis.__historySequence;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const deleteTiming = globalThis.__historyDeleteTiming;
      globalThis.__historyDeleteTiming = null;
      const afterDelete = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      const oversized = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
        capture: {
          id: 'oversized', createdAt: 20, label: 'Oversized', filename: 'oversized.png', format: 'png',
          width: 1, height: 1, scale: 1, size: Number.MAX_SAFE_INTEGER, sourceHost: 'example.com', thumbnailDataUrl: image
        }
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CLEAR' });
      const afterClear = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      return {
        ids: listed.captures.map((capture) => capture.id),
        listContainsOriginal: listed.captures.some((capture) => 'dataUrl' in capture || 'blob' in capture),
        detailIsDescriptor: !('dataUrl' in detail.capture) && !('blob' in detail.capture),
        detailBytes: atob(detailChunk.data).length,
        oversizedRejected: oversized.ok === false && Boolean(oversized.error),
        deleteTiming,
        afterDeleteCount: afterDelete.captures.length,
        afterClearCount: afterClear.captures.length
      };
    })()`);

    assert.deepEqual(result.ids, Array.from({ length: 10 }, (_, index) => `capture-${11 - index}`));
    assert.equal(result.listContainsOriginal, false, 'history lists should include thumbnails and metadata, not full image data');
    assert.equal(result.detailIsDescriptor, true, 'history detail messages should carry metadata instead of the full image');
    assert.equal(result.detailBytes, 1, 'history image bytes should be read through bounded chunks');
    assert.equal(result.oversizedRejected, true, 'captures beyond the storage budget should be rejected');
    assert.equal(Number.isInteger(result.deleteTiming.transaction), true, 'Delete transaction completion should be observed');
    assert.ok(result.deleteTiming.transaction < result.deleteTiming.response, 'Delete response must wait for the transaction to commit');
    assert.equal(result.afterDeleteCount, 9);
    assert.equal(result.afterClearCount, 0);
  });
});
