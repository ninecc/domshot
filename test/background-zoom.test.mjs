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
  assert.equal(ready.protocol, 4);
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
    origins: ['https://blocked.example:8443', 'https://blocked.example:8443'],
    locale: 'en',
    theme: 'dark',
  }, { tab: { id: 27 } });
  assert.equal(prepared.prepared, true);
  assertPermissionUrl(prepared.frameUrl, { mode: 'inline', lang: 'en', theme: 'dark', token: 'retry-1' });
  const pending = await invokeMessage(onMessage, { type: 'DOMSHOT_GET_IMAGE_PERMISSION', token: 'retry-1' });
  assert.deepEqual(Array.from(pending.origins), ['https://blocked.example:8443']);
  assert.deepEqual(Array.from(pending.patterns), ['https://blocked.example/*']);

  const opened = await invokeMessage(onMessage, { type: 'DOMSHOT_OPEN_IMAGE_PERMISSION', token: 'retry-1' });
  assert.equal(opened.opened, true);
  assertPermissionUrl(openedWindow.url, { lang: 'en', theme: 'dark', token: 'retry-1' });

  allowedPatterns.add('https://blocked.example/*');
  const completed = await invokeMessage(onMessage, { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token: 'retry-1' });
  assert.equal(completed.retried, true);
  assert.equal(tabMessages.at(-1).message.type, 'DOMSHOT_RETRY_CAPTURE');
  assert.equal(storage.size, 0);
  const repeated = await invokeMessage(onMessage, { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token: 'retry-1' });
  assert.equal(repeated.reason, 'expired');
});

test('background reports a redirect target as the missing permission source', async () => {
  let onMessage;
  const allowedPatterns = new Set(['https://images.example/*']);
  const chrome = {
    tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
    runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
    permissions: {
      contains({ origins }) { return Promise.resolve(origins.every((origin) => allowedPatterns.has(origin))); },
    },
  };
  const fetch = async () => ({
    ok: true,
    url: 'https://cdn.example:8443/final.png',
    headers: { get(name) { return name === 'content-type' ? 'image/png' : null; } },
    blob() { return Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })); },
  });

  vm.runInNewContext(backgroundBundle, { chrome, fetch, URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, Date, Error });
  const first = await invokeMessage(onMessage, {
    type: 'DOMSHOT_RESOLVE_IMAGES',
    urls: ['https://images.example/redirect.png'],
  });
  assert.equal(first.resources[0].reason, 'permission');
  assert.equal(first.resources[0].permissionUrl, 'https://cdn.example:8443/final.png');

  allowedPatterns.add('https://cdn.example/*');
  const retried = await invokeMessage(onMessage, {
    type: 'DOMSHOT_RESOLVE_IMAGES',
    urls: ['https://images.example/redirect.png'],
  });
  assert.match(retried.resources[0].dataUrl, /^data:image\/png;base64,/);
});

test('background retains an authorized permission request while the source tab is busy', async () => {
  let onMessage;
  let retryAttempts = 0;
  const storage = new Map();
  const chrome = {
    tabs: {
      onZoomChange: { addListener() {} },
      sendMessage() {
        retryAttempts += 1;
        return Promise.resolve(retryAttempts === 1 ? { started: false, reason: 'busy' } : { started: true });
      },
    },
    runtime: {
      onMessage: { addListener(listener) { onMessage = listener; } },
      getURL(path) { return `chrome-extension://domshot/${path}`; },
    },
    permissions: { contains() { return Promise.resolve(true); } },
    storage: {
      session: {
        set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); return Promise.resolve(); },
        get(key) { return Promise.resolve({ [key]: storage.get(key) }); },
        remove(key) { storage.delete(key); return Promise.resolve(); },
      },
    },
  };
  vm.runInNewContext(backgroundBundle, { chrome, URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, Date, Error });
  await invokeMessage(onMessage, {
    type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION', token: 'busy-retry', origins: ['https://images.example'], locale: 'en', theme: 'light',
  }, { tab: { id: 27 } });

  const busy = await invokeMessage(onMessage, { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token: 'busy-retry' });
  assert.equal(busy.ok, true);
  assert.equal(busy.retried, false);
  assert.equal(busy.retryPending, true);
  assert.equal(busy.reason, 'busy');
  assert.equal(storage.size, 1, 'busy retry must retain its permission request');

  const completed = await invokeMessage(onMessage, { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token: 'busy-retry' });
  assert.equal(completed.retried, true);
  assert.equal(storage.size, 0);
});

test('background returns an explicit result for resources beyond the proxy limit', async () => {
  let onMessage;
  const chrome = {
    tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
    runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
    permissions: { contains() { return Promise.resolve(false); } },
  };
  vm.runInNewContext(backgroundBundle, { chrome, URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, Date, Error });
  const urls = Array.from({ length: 65 }, (_, index) => `https://images.example/${index}.png`);
  const result = await invokeMessage(onMessage, { type: 'DOMSHOT_RESOLVE_IMAGES', urls });
  assert.equal(result.resources.length, 65);
  assert.equal(result.resources[64].reason, 'limit');
});

test('background accepts a recognized image served as generic binary data', async () => {
  let onMessage;
  const chrome = {
    tabs: { onZoomChange: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
    runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
    permissions: { contains() { return Promise.resolve(true); } },
  };
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetch = async (url) => ({
    ok: true,
    url,
    headers: { get(name) { return name === 'content-type' ? 'application/octet-stream' : null; } },
    blob() { return Promise.resolve(new Blob([pngHeader], { type: 'application/octet-stream' })); },
  });
  vm.runInNewContext(backgroundBundle, { chrome, fetch, URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, Date, Error });
  const result = await invokeMessage(onMessage, { type: 'DOMSHOT_RESOLVE_IMAGES', urls: ['https://images.example/generic'] });
  assert.match(result.resources[0].dataUrl, /^data:image\/png;base64,/);
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
