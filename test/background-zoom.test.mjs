import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const backgroundBundle = await readFile(resolve(import.meta.dirname, '../dist/background.js'), 'utf8');

test('background forwards tab zoom changes to the injected content script', async () => {
  let onZoomChange;
  let onMessage;
  const messages = [];
  const chrome = {
    tabs: {
      onZoomChange: { addListener(listener) { onZoomChange = listener; } },
      sendMessage(tabId, message) {
        messages.push({ tabId, message });
        return Promise.resolve();
      },
    },
    runtime: {
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
  };

  vm.runInNewContext(backgroundBundle, { chrome });
  assert.equal(typeof onZoomChange, 'function');
  assert.equal(typeof onMessage, 'function');
  onZoomChange({ tabId: 42, oldZoomFactor: 1.25, newZoomFactor: 0.33 });
  await Promise.resolve();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].tabId, 42);
  assert.equal(messages[0].message.type, 'DOMSHOT_ZOOM_CHANGED');
  assert.equal(messages[0].message.pageZoom, 0.33);
  const ready = await invokeMessage(onMessage, { type: 'DOMSHOT_BACKGROUND_PING' });
  assert.equal(ready.protocol, 3);
});

test('background resolves permitted images and persists an exact-origin permission request', async () => {
  let onMessage;
  let openedWindow;
  const storage = new Map();
  const allowedPatterns = new Set(['https://images.example/*']);
  const tabMessages = [];
  const chrome = {
    tabs: {
      onZoomChange: { addListener() {} },
      sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
        return Promise.resolve({ started: true });
      },
    },
    runtime: {
      onMessage: { addListener(listener) { onMessage = listener; } },
      getURL(path) { return `chrome-extension://domshot/${path}`; },
    },
    permissions: {
      contains({ origins }) { return Promise.resolve(origins.every((origin) => allowedPatterns.has(origin))); },
    },
    storage: {
      session: {
        set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); return Promise.resolve(); },
        get(key) { return Promise.resolve({ [key]: storage.get(key) }); },
        remove(key) { storage.delete(key); return Promise.resolve(); },
      },
    },
    windows: {
      create(options) { openedWindow = options; return Promise.resolve({}); },
    },
  };
  const fetch = async (url) => ({
    ok: true,
    url,
    headers: { get(name) { return name === 'content-type' ? 'image/png' : null; } },
    blob() { return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })); },
  });

  vm.runInNewContext(backgroundBundle, { chrome, fetch, URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, Date, Error });
  const resolved = await invokeMessage(onMessage, {
    type: 'DOMSHOT_RESOLVE_IMAGES',
    urls: ['https://images.example/badge.png', 'https://blocked.example/photo.png'],
  });
  assert.match(resolved.resources[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(resolved.resources[1].reason, 'permission');

  const prepared = await invokeMessage(onMessage, {
    type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION',
    token: 'retry-1',
    origins: ['https://blocked.example', 'https://blocked.example'],
    locale: 'en',
    theme: 'dark',
  }, { tab: { id: 27 } });
  assert.equal(prepared.prepared, true);
  assertPermissionUrl(prepared.frameUrl, { mode: 'inline', lang: 'en', theme: 'dark', token: 'retry-1' });
  const pending = await invokeMessage(onMessage, { type: 'DOMSHOT_GET_IMAGE_PERMISSION', token: 'retry-1' });
  assert.deepEqual(Array.from(pending.patterns), ['https://blocked.example/*']);

  const opened = await invokeMessage(onMessage, { type: 'DOMSHOT_OPEN_IMAGE_PERMISSION', token: 'retry-1' });
  assert.equal(opened.opened, true);
  assertPermissionUrl(openedWindow.url, { lang: 'en', theme: 'dark', token: 'retry-1' });

  allowedPatterns.add('https://blocked.example/*');
  const completed = await invokeMessage(onMessage, { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token: 'retry-1' });
  assert.equal(completed.retried, true);
  assert.equal(tabMessages.at(-1).message.type, 'DOMSHOT_RETRY_CAPTURE');
  assert.equal(storage.size, 0);
});

function invokeMessage(listener, message, sender = {}) {
  return new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });
}

function assertPermissionUrl(value, expectedParams) {
  const url = new URL(value);
  assert.equal(url.pathname, '/permission.html');
  for (const [name, expected] of Object.entries(expectedParams)) assert.equal(url.searchParams.get(name), expected);
}
