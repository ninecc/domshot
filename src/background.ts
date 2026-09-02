import type { CaptureHistoryItem, CaptureHistoryTransfer, ExtensionMessage, ResolvedImageResource } from './types';
import { BACKGROUND_PROTOCOL, CAPTURE_HISTORY_POLICY } from './types';
import { resolveLocale, t } from './i18n';
import { resolveTheme } from './theme';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PERMISSION_REQUEST_TTL = 10 * 60 * 1000;
const HISTORY_DB = 'domshot-history';
const HISTORY_STORE = 'captures';
const HISTORY_UPLOAD_TTL = 2 * 60 * 1000;
const MAX_ENCODED_CHUNK_LENGTH = 2 * 1024 * 1024;

interface StoredCapture extends CaptureHistoryItem {
  blob: Blob;
}

const pendingHistoryCaptures = new Map<string, {
  capture: CaptureHistoryItem;
  mimeType: string;
  chunks: Array<string | undefined>;
  createdAt: number;
}>();

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  const message = { type: 'DOMSHOT_ZOOM_CHANGED', pageZoom: newZoomFactor } satisfies ExtensionMessage;
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Most tabs do not have DOMShot injected; they do not need zoom updates.
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : t(resolveLocale('auto'), 'backgroundFailure') });
  });
  return true;
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'DOMSHOT_BACKGROUND_PING') return { protocol: BACKGROUND_PROTOCOL };

  if (message.type === 'DOMSHOT_HISTORY_BEGIN') {
    cleanExpiredHistoryUploads();
    const expectedChunks = Math.max(1, Math.ceil(message.capture.size / CAPTURE_HISTORY_POLICY.chunkBytes));
    if (!Number.isSafeInteger(message.capture.size) || message.capture.size < 0 || message.capture.size > CAPTURE_HISTORY_POLICY.maxCaptureBytes) {
      throw new Error('Capture is too large for history');
    }
    if (message.totalChunks !== expectedChunks) throw new Error('Invalid capture chunk count');
    pendingHistoryCaptures.set(message.capture.id, {
      capture: message.capture,
      mimeType: message.mimeType,
      chunks: new Array(message.totalChunks),
      createdAt: Date.now(),
    });
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_HISTORY_CHUNK') {
    const pending = pendingHistoryCaptures.get(message.id);
    if (!pending || message.index < 0 || message.index >= pending.chunks.length || message.data.length > MAX_ENCODED_CHUNK_LENGTH) {
      throw new Error('Invalid capture chunk');
    }
    pending.chunks[message.index] = message.data;
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_HISTORY_COMMIT') {
    const pending = pendingHistoryCaptures.get(message.id);
    if (!pending || pending.chunks.some((chunk) => chunk === undefined)) throw new Error('Capture upload is incomplete');
    try {
      const blob = new Blob(pending.chunks.map((chunk) => base64ToBuffer(chunk!)), { type: pending.mimeType });
      if (blob.size !== pending.capture.size) throw new Error('Capture upload size did not match');
      await saveHistoryCapture({ ...pending.capture, blob });
      return { ok: true };
    } finally {
      pendingHistoryCaptures.delete(message.id);
    }
  }

  if (message.type === 'DOMSHOT_HISTORY_CANCEL') {
    pendingHistoryCaptures.delete(message.id);
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_HISTORY_LIST') return { captures: await listHistoryCaptures() };

  if (message.type === 'DOMSHOT_HISTORY_GET') {
    const capture = await getHistoryCapture(message.id);
    if (!capture) return { capture: null };
    const { blob, ...metadata } = capture;
    return { capture: { ...metadata, mimeType: blob.type, byteLength: blob.size } satisfies CaptureHistoryTransfer };
  }

  if (message.type === 'DOMSHOT_HISTORY_READ') {
    if (!Number.isSafeInteger(message.offset) || message.offset < 0 || !Number.isSafeInteger(message.length)
      || message.length < 1 || message.length > CAPTURE_HISTORY_POLICY.chunkBytes) {
      throw new Error('Invalid capture read range');
    }
    const capture = await getHistoryCapture(message.id);
    if (!capture || message.offset >= capture.blob.size) throw new Error('Capture is unavailable');
    const bytes = new Uint8Array(await capture.blob.slice(message.offset, message.offset + message.length).arrayBuffer());
    return { data: bufferToBase64(bytes) };
  }

  if (message.type === 'DOMSHOT_HISTORY_DELETE') {
    await deleteHistoryCapture(message.id);
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_HISTORY_CLEAR') {
    await clearHistoryCaptures();
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
    const urls = Array.from(new Set(message.urls)).slice(0, 64);
    return { resources: await mapWithConcurrency(urls, 4, resolveImageResource) };
  }

  if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
    const tabId = sender.tab?.id;
    if (!tabId) return { prepared: false };
    const origins = validOrigins(message.origins);
    if (!origins.length) return { prepared: false };
    const locale = message.locale ?? resolveLocale('auto');
    const theme = message.theme ?? resolveTheme('auto');
    const request = { tabId, origins, patterns: origins.map(originPattern), locale, theme, createdAt: Date.now() };
    await chrome.storage.session.set({ [permissionKey(message.token)]: request });
    return {
      prepared: true,
      frameUrl: chrome.runtime.getURL(`permission.html?mode=inline&lang=${encodeURIComponent(locale)}&theme=${encodeURIComponent(theme)}&token=${encodeURIComponent(message.token)}`),
    };
  }

  if (message.type === 'DOMSHOT_OPEN_IMAGE_PERMISSION') {
    const request = await readPermissionRequest(message.token);
    if (!request) return { opened: false };
    await chrome.windows.create({
      url: chrome.runtime.getURL(`permission.html?lang=${encodeURIComponent(request.locale)}&theme=${encodeURIComponent(request.theme)}&token=${encodeURIComponent(message.token)}`),
      type: 'popup',
      width: 420,
      height: 520,
      focused: true,
    });
    return { opened: true };
  }

  if (message.type === 'DOMSHOT_GET_IMAGE_PERMISSION') {
    const request = await readPermissionRequest(message.token);
    return request ? { ok: true, origins: request.origins, patterns: request.patterns } : { ok: false };
  }

  if (message.type === 'DOMSHOT_COMPLETE_IMAGE_PERMISSION') {
    const request = await readPermissionRequest(message.token);
    if (!request) return { ok: false, retried: false };
    const granted = await chrome.permissions.contains({ origins: request.patterns });
    if (!granted) return { ok: false, retried: false };
    let retried = false;
    try {
      const response = await chrome.tabs.sendMessage(request.tabId, { type: 'DOMSHOT_RETRY_CAPTURE', token: message.token } satisfies ExtensionMessage) as { started?: boolean } | undefined;
      retried = response?.started === true;
    } catch { /* The source tab may have navigated or closed. */ }
    await chrome.storage.session.remove(permissionKey(message.token));
    return { ok: true, retried };
  }

  if (message.type === 'DOMSHOT_CANCEL_IMAGE_PERMISSION') {
    await chrome.storage.session.remove(permissionKey(message.token));
    return { ok: true };
  }

  return undefined;
}

function cleanExpiredHistoryUploads() {
  const cutoff = Date.now() - HISTORY_UPLOAD_TTL;
  for (const [id, upload] of pendingHistoryCaptures) if (upload.createdAt < cutoff) pendingHistoryCaptures.delete(id);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer as ArrayBuffer;
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open capture history'));
  });
}

async function withHistoryStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, mode);
    const request = operation(transaction.objectStore(HISTORY_STORE));
    let result: T;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => fail(request.error ?? new Error('Capture history operation failed'));
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error('Capture history transaction failed'));
    transaction.onabort = () => fail(transaction.error ?? new Error('Capture history transaction was aborted'));
  });
}

async function saveHistoryCapture(capture: StoredCapture): Promise<void> {
  const database = await openHistoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE);
    store.put(capture);
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      const oldestFirst = (allRequest.result as StoredCapture[]).sort((a, b) => a.createdAt - b.createdAt);
      let totalBytes = oldestFirst.reduce((total, item) => total + item.size, 0);
      while (oldestFirst.length > CAPTURE_HISTORY_POLICY.maxItems || totalBytes > CAPTURE_HISTORY_POLICY.maxTotalBytes) {
        const oldest = oldestFirst.shift();
        if (!oldest) break;
        totalBytes -= oldest.size;
        store.delete(oldest.id);
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not save capture history')); };
  });
}

async function listHistoryCaptures(): Promise<CaptureHistoryItem[]> {
  const captures = await withHistoryStore<StoredCapture[]>('readonly', (store) => store.getAll());
  return captures.sort((a, b) => b.createdAt - a.createdAt).map(({ blob: _blob, ...metadata }) => metadata);
}

function getHistoryCapture(id: string): Promise<StoredCapture | undefined> {
  return withHistoryStore<StoredCapture | undefined>('readonly', (store) => store.get(id));
}

async function deleteHistoryCapture(id: string): Promise<void> {
  await withHistoryStore<undefined>('readwrite', (store) => store.delete(id));
}

async function clearHistoryCaptures(): Promise<void> {
  await withHistoryStore<undefined>('readwrite', (store) => store.clear());
}

async function resolveImageResource(url: string): Promise<ResolvedImageResource> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url, reason: 'invalid' };
  } catch {
    return { url, reason: 'invalid' };
  }

  if (!await chrome.permissions.contains({ origins: [originPattern(parsed.origin)] })) return { url, reason: 'permission' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(parsed.href, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) return { url, reason: 'fetch' };
    const finalUrl = new URL(response.url || parsed.href);
    if (!await chrome.permissions.contains({ origins: [originPattern(finalUrl.origin)] })) return { url, reason: 'permission' };
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (!contentType.startsWith('image/') || declaredSize > MAX_IMAGE_BYTES) return { url, reason: 'fetch' };
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return { url, reason: 'fetch' };
    return { url, dataUrl: await blobToDataUrl(blob, contentType) };
  } catch {
    return { url, reason: 'fetch' };
  } finally {
    clearTimeout(timeout);
  }
}

async function blobToDataUrl(blob: Blob, contentType: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${contentType};base64,${bufferToBase64(bytes)}`;
}

function bufferToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function validOrigins(values: string[]) {
  const origins = new Set<string>();
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch { /* Ignore malformed origins supplied by a page. */ }
  }
  return Array.from(origins).slice(0, 16);
}

function originPattern(origin: string) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

function permissionKey(token: string) {
  return `imagePermission:${token.replace(/[^a-z0-9-]/gi, '')}`;
}

async function readPermissionRequest(token: string): Promise<{ tabId: number; origins: string[]; patterns: string[]; locale: 'en' | 'zh-CN'; theme: 'light' | 'dark'; createdAt: number } | null> {
  const key = permissionKey(token);
  const stored = await chrome.storage.session.get(key);
  const request = stored[key] as { tabId: number; origins: string[]; patterns: string[]; locale: 'en' | 'zh-CN'; theme: 'light' | 'dark'; createdAt: number } | undefined;
  if (!request || Date.now() - request.createdAt > PERMISSION_REQUEST_TTL) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return request;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
