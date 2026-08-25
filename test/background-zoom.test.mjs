import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const backgroundBundle = await readFile(resolve(import.meta.dirname, '../dist/background.js'), 'utf8');

test('background forwards tab zoom changes to the injected content script', async () => {
  let onZoomChange;
  const messages = [];
  const chrome = {
    tabs: {
      onZoomChange: { addListener(listener) { onZoomChange = listener; } },
      sendMessage(tabId, message) {
        messages.push({ tabId, message });
        return Promise.resolve();
      },
    },
  };

  vm.runInNewContext(backgroundBundle, { chrome });
  assert.equal(typeof onZoomChange, 'function');
  onZoomChange({ tabId: 42, oldZoomFactor: 1.25, newZoomFactor: 0.33 });
  await Promise.resolve();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].tabId, 42);
  assert.equal(messages[0].message.type, 'DOMSHOT_ZOOM_CHANGED');
  assert.equal(messages[0].message.pageZoom, 0.33);
});
