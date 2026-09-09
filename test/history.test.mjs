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
      const putIntoStore = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = putIntoStore.apply(this, args);
        request.addEventListener('success', () => {
          if (globalThis.__historyDeleteTiming) globalThis.__historyDeleteTiming.request = ++globalThis.__historySequence;
        });
        return request;
      };
      const createTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const transaction = createTransaction.apply(this, args);
        if (globalThis.__historyDeleteTiming) transaction.addEventListener('complete', () => {
          globalThis.__historyDeleteTiming.transaction = ++globalThis.__historySequence;
        });
        return transaction;
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
        const begin = await globalThis.__sendHistoryMessage({
          type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
          digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
          capture: {
            id: 'capture-' + index, createdAt: index, label: 'Capture ' + index,
            filename: 'capture-' + index + '.png', format: 'png', width: 100, height: 80,
            scale: 2, size: 1, sourceHost: 'example.com', thumbnailDataUrl: image
          }
        });
        await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'capture-' + index, uploadToken: begin.uploadToken, index: 0, data: 'AA==' });
        await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'capture-' + index, uploadToken: begin.uploadToken });
      }
      const listed = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      const confirmed = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_CONFIRM', capture: listed.captures[0], mimeType: 'image/png',
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      const conflict = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_CONFIRM', capture: { ...listed.captures[0], filename: 'different.png' }, mimeType: 'image/png',
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      const repeatedBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: listed.captures[0], mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      const conflictingBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: listed.captures[0], mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a'
      });
      const pendingCapture = { ...listed.captures[0], id: 'pending-fingerprint' };
      const pendingBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: pendingCapture, mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      const pendingConflict = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: pendingCapture, mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a'
      });
      const unauthorizedCancel = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CANCEL', id: pendingCapture.id, uploadToken: 'wrong-token' });
      const resumedBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: pendingCapture, mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: pendingCapture.id, uploadToken: resumedBegin.uploadToken, index: 0, data: 'AA==' });
      const resumedCommit = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: pendingCapture.id, uploadToken: resumedBegin.uploadToken });
      const mismatchCapture = { ...listed.captures[0], id: 'digest-mismatch' };
      const mismatchBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture: mismatchCapture, mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a'
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: mismatchCapture.id, uploadToken: mismatchBegin.uploadToken, index: 0, data: 'AA==' });
      const mismatchedCommit = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: mismatchCapture.id, uploadToken: mismatchBegin.uploadToken });
      const storageShape = await new Promise((resolve, reject) => {
        const request = indexedDB.open('domshot-history');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const values = database.transaction('captures').objectStore('captures').getAll();
          values.onerror = () => reject(values.error);
          values.onsuccess = () => { database.close(); resolve(values.result); };
        };
      });
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
      const capture12Begin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
        capture: {
          id: 'capture-12', createdAt: 12, label: 'Capture 12', filename: 'capture-12.png', format: 'png',
          width: 100, height: 80, scale: 2, size: 1, sourceHost: 'example.com', thumbnailDataUrl: image
        }
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'capture-12', uploadToken: capture12Begin.uploadToken, index: 0, data: 'AA==' });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'capture-12', uploadToken: capture12Begin.uploadToken });
      const restored = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_RESTORE', id: 'capture-11' });
      const afterRestore = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_DELETE', id: 'capture-11' });
      const oversized = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
        capture: {
          id: 'oversized', createdAt: 20, label: 'Oversized', filename: 'oversized.png', format: 'png',
          width: 1, height: 1, scale: 1, size: Number.MAX_SAFE_INTEGER, sourceHost: 'example.com', thumbnailDataUrl: image
        }
      });
      const clearRaceBegin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
        capture: {
          id: 'clear-race', createdAt: 30, label: 'Clear race', filename: 'clear-race.png', format: 'png',
          width: 1, height: 1, scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: image
        }
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'clear-race', uploadToken: clearRaceBegin.uploadToken, index: 0, data: 'AA==' });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'clear-race', uploadToken: clearRaceBegin.uploadToken });
      await Promise.all([
        globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_DELETE', id: 'clear-race' }),
        globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CLEAR' })
      ]);
      const clearRaceMetadata = await new Promise((resolve, reject) => {
        const request = indexedDB.open('domshot-history');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const value = database.transaction('captures').objectStore('captures').get('clear-race');
          value.onerror = () => reject(value.error);
          value.onsuccess = () => { database.close(); resolve(value.result); };
        };
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CLEAR' });
      const afterClear = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      return {
        ids: listed.captures.map((capture) => capture.id),
        confirmationState: confirmed.state,
        conflictState: conflict.state,
        repeatedBeginStored: repeatedBegin.alreadyStored,
        conflictingDigestRejected: conflictingBegin.ok === false && /conflict/i.test(conflictingBegin.error || ''),
        pendingDigestRejected: pendingConflict.ok === false && /conflict/i.test(pendingConflict.error || ''),
        unauthorizedCancelRejected: unauthorizedCancel.ok === false,
        sameFingerprintKeptToken: Boolean(pendingBegin.uploadToken) && resumedBegin.uploadToken === pendingBegin.uploadToken,
        resumedCommitSucceeded: resumedCommit.ok,
        mismatchedCommitRejected: mismatchedCommit.ok === false && /digest/i.test(mismatchedCommit.error || ''),
        listContainsOriginal: listed.captures.some((capture) => 'dataUrl' in capture || 'blob' in capture),
        historyStoreContainsBlob: storageShape.some((capture) => 'blob' in capture),
        detailIsDescriptor: !('dataUrl' in detail.capture) && !('blob' in detail.capture),
        detailBytes: atob(detailChunk.data).length,
        oversizedRejected: oversized.ok === false && Boolean(oversized.error),
        deleteTiming,
        afterDeleteCount: afterDelete.captures.length,
        restored: restored.ok,
        restoredIds: afterRestore.captures.map((capture) => capture.id),
        clearRaceLeftMetadata: Boolean(clearRaceMetadata),
        afterClearCount: afterClear.captures.length
      };
    })()`);

    assert.deepEqual(result.ids, Array.from({ length: 10 }, (_, index) => `capture-${11 - index}`));
    assert.equal(result.confirmationState, 'stored');
    assert.equal(result.conflictState, 'conflict');
    assert.equal(result.repeatedBeginStored, true, 'a repeated upload must acknowledge the existing record without overwriting it');
    assert.equal(result.conflictingDigestRejected, true, 'same-size content with a different digest must not reuse a capture identity');
    assert.equal(result.pendingDigestRejected, true, 'a pending ID must reject a different content fingerprint');
    assert.equal(result.unauthorizedCancelRejected, true, 'a caller without the upload token must not cancel another pending upload');
    assert.equal(result.sameFingerprintKeptToken, true, 'same-fingerprint BEGIN retry must return the original upload token');
    assert.equal(result.resumedCommitSucceeded, true, 'the original pending upload must remain committable after a conflict');
    assert.equal(result.mismatchedCommitRejected, true, 'commit must recompute and verify the assembled content digest');
    assert.equal(result.listContainsOriginal, false, 'history lists should include thumbnails and metadata, not full image data');
    assert.equal(result.historyStoreContainsBlob, false, 'history metadata records must not contain full image blobs');
    assert.equal(result.detailIsDescriptor, true, 'history detail messages should carry metadata instead of the full image');
    assert.equal(result.detailBytes, 1, 'history image bytes should be read through bounded chunks');
    assert.equal(result.oversizedRejected, true, 'captures beyond the storage budget should be rejected');
    assert.equal(Number.isInteger(result.deleteTiming.transaction), true, 'Delete transaction completion should be observed');
    assert.ok(result.deleteTiming.transaction < result.deleteTiming.response, 'Delete response must wait for the transaction to commit');
    assert.equal(result.afterDeleteCount, 9);
    assert.equal(result.restored, true);
    assert.ok(result.restoredIds.includes('capture-11'), 'undo should restore the same capture identity');
    assert.ok(result.restoredIds.length <= 10, 'undo must reapply the history item quota');
    assert.equal(result.clearRaceLeftMetadata, false, 'a concurrent clear must not let delete resurrect stale metadata');
    assert.equal(result.afterClearCount, 0);
  });
});

test('history database migration separates legacy image blobs from list metadata', async () => {
  await withChromePage({ url: blankPageUrl }, async (page) => {
    await page.evaluate(`new Promise((resolve, reject) => {
      const request = indexedDB.open('domshot-history', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        for (let index = 0; index < 12; index += 1) store.put({
          id: 'legacy-' + index, createdAt: index, label: 'Legacy ' + index, filename: 'legacy-' + index + '.png', format: 'png',
          width: 1, height: 1, scale: 1, size: 1, sourceHost: 'example.com',
          thumbnailDataUrl: 'data:image/png;base64,AA==', blob: new Blob([new Uint8Array([0])], { type: 'image/png' })
        });
        store.put({
          id: 'legacy-orphan', createdAt: 20, label: 'Orphan', filename: 'orphan.png', format: 'png',
          width: 1, height: 1, scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: ''
        });
        store.put({
          id: 'legacy-expired', createdAt: 21, deletedAt: 1, label: 'Expired', filename: 'expired.png', format: 'png',
          width: 1, height: 1, scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
          blob: new Blob([new Uint8Array([0])], { type: 'image/png' })
        });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    })`);
    await page.evaluate(`(() => {
      globalThis.chrome = {
        tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
        runtime: { onMessage: { addListener(listener) { globalThis.__historyMessageListener = listener; } } }
      };
      (0, eval)(${JSON.stringify(backgroundBundle)});
      globalThis.__sendHistoryMessage = (message) => new Promise((resolve) => globalThis.__historyMessageListener(message, {}, resolve));
    })()`);

    const migrated = await page.evaluate(`(async () => {
      const listed = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' });
      const detail = await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_GET', id: 'legacy-11' });
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('domshot-history');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const metadata = await new Promise((resolve, reject) => {
        const request = database.transaction('captures').objectStore('captures').get('legacy-11');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const blobRecord = await new Promise((resolve, reject) => {
        const request = database.transaction('capture-blobs').objectStore('capture-blobs').get('legacy-11');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return {
        ids: listed.captures.map(capture => capture.id),
        byteLength: detail.capture?.byteLength,
        metadataHasBlob: 'blob' in metadata,
        migratedBlobSize: blobRecord?.blob?.size
      };
    })()`);
    assert.deepEqual(migrated.ids, Array.from({ length: 10 }, (_, index) => `legacy-${11 - index}`));
    assert.equal(migrated.byteLength, 1);
    assert.equal(migrated.metadataHasBlob, false);
    assert.equal(migrated.migratedBlobSize, 1);
  });
});

test('saving enforces the physical byte budget across active and soft-deleted blobs', async () => {
  await withChromePage({ url: blankPageUrl }, async (page) => {
    await page.evaluate(`new Promise((resolve, reject) => {
      const request = indexedDB.open('domshot-history', 2);
      request.onupgradeneeded = () => {
        const captures = request.result.createObjectStore('captures', { keyPath: 'id' });
        captures.createIndex('createdAt', 'createdAt');
        request.result.createObjectStore('capture-blobs', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['captures', 'capture-blobs'], 'readwrite');
        const captures = transaction.objectStore('captures');
        const blobs = transaction.objectStore('capture-blobs');
        for (let index = 0; index < 5; index += 1) {
          const id = 'deleted-' + index;
          captures.put({ id, createdAt: index, deletedAt: Date.now(), label: id, filename: id + '.png', format: 'png',
            width: 1, height: 1, scale: 1, size: 64 * 1024 * 1024, sourceHost: 'example.com', thumbnailDataUrl: '' });
          blobs.put({ id, blob: new Blob([new Uint8Array([0])], { type: 'image/png' }) });
        }
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    })`);
    await page.evaluate(`(() => {
      globalThis.chrome = {
        tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
        runtime: { onMessage: { addListener(listener) { globalThis.__historyMessageListener = listener; } } }
      };
      (0, eval)(${JSON.stringify(backgroundBundle)});
      globalThis.__sendHistoryMessage = (message) => new Promise((resolve) => globalThis.__historyMessageListener(message, {}, resolve));
    })()`);
    const result = await page.evaluate(`(async () => {
      const capture = { id: 'new', createdAt: 100, label: 'New', filename: 'new.png', format: 'png', width: 1, height: 1,
        scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '' };
      const begin = await globalThis.__sendHistoryMessage({
        type: 'DOMSHOT_HISTORY_BEGIN', capture, mimeType: 'image/png', totalChunks: 1,
        digest: 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'
      });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_CHUNK', id: 'new', uploadToken: begin.uploadToken, index: 0, data: 'AA==' });
      await globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_COMMIT', id: 'new', uploadToken: begin.uploadToken });
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('domshot-history');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const metadata = await new Promise((resolve, reject) => {
        const request = database.transaction('captures').objectStore('captures').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const blobKeys = await new Promise((resolve, reject) => {
        const request = database.transaction('capture-blobs').objectStore('capture-blobs').getAllKeys();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return { totalBytes: metadata.reduce((total, item) => total + item.size, 0), ids: metadata.map(item => item.id), blobKeys };
    })()`);
    assert.ok(result.totalBytes <= 256 * 1024 * 1024, `physical history budget exceeded: ${result.totalBytes}`);
    assert.deepEqual(result.blobKeys.slice().sort(), result.ids.slice().sort(), 'metadata and blob stores must be evicted atomically');
    assert.ok(result.ids.includes('new'));
  });
});

test('history listing survives best-effort cleanup failure for an expired deletion', async () => {
  await withChromePage({ url: blankPageUrl }, async (page) => {
    await page.evaluate(`new Promise((resolve, reject) => {
      const request = indexedDB.open('domshot-history', 2);
      request.onupgradeneeded = () => {
        const captures = request.result.createObjectStore('captures', { keyPath: 'id' });
        captures.createIndex('createdAt', 'createdAt');
        request.result.createObjectStore('capture-blobs', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['captures', 'capture-blobs'], 'readwrite');
        const captures = transaction.objectStore('captures');
        const blobs = transaction.objectStore('capture-blobs');
        for (const item of [
          { id: 'healthy', createdAt: 2 },
          { id: 'expired', createdAt: 1, deletedAt: 1 }
        ]) {
          captures.put({ ...item, label: item.id, filename: item.id + '.png', format: 'png', width: 1, height: 1,
            scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '' });
          blobs.put({ id: item.id, blob: new Blob([new Uint8Array([0])], { type: 'image/png' }) });
        }
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    })`);
    await page.evaluate(`(() => {
      globalThis.chrome = {
        tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
        runtime: { onMessage: { addListener(listener) { globalThis.__historyMessageListener = listener; } } }
      };
      const deleteRecord = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        if (key === 'expired') throw new DOMException('Injected cleanup failure', 'UnknownError');
        return deleteRecord.call(this, key);
      };
      (0, eval)(${JSON.stringify(backgroundBundle)});
      globalThis.__sendHistoryMessage = (message) => new Promise((resolve) => globalThis.__historyMessageListener(message, {}, resolve));
    })()`);
    const response = await page.evaluate(`globalThis.__sendHistoryMessage({ type: 'DOMSHOT_HISTORY_LIST' })`);
    assert.deepEqual(response.captures.map(capture => capture.id), ['healthy']);
  });
});
