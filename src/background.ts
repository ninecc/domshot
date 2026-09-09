import type { CaptureHistoryItem, CaptureHistoryTransfer, ExtensionMessage, ResolvedImageResource } from './types';
import { BACKGROUND_PROTOCOL, CAPTURE_HISTORY_POLICY } from './types';
import { resolveLocale, t } from './i18n';
import { resolveTheme } from './theme';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PERMISSION_REQUEST_TTL = 10 * 60 * 1000;
const HISTORY_DB = 'domshot-history';
const HISTORY_STORE = 'captures';
const HISTORY_BLOB_STORE = 'capture-blobs';
const HISTORY_UPLOAD_TTL = 2 * 60 * 1000;
const MAX_ENCODED_CHUNK_LENGTH = 2 * 1024 * 1024;
const MAX_PENDING_HISTORY_UPLOADS = 4;

interface StoredCaptureMetadata extends CaptureHistoryItem {
  deletedAt?: number;
  digest?: string;
}

interface StoredCaptureBlob { id: string; blob: Blob; digest?: string }

const pendingHistoryCaptures = new Map<string, {
  capture: CaptureHistoryItem;
  mimeType: string;
  digest: string;
  uploadToken: string;
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

  if (message.type === 'DOMSHOT_HISTORY_BEGIN' || message.type === 'DOMSHOT_HISTORY_CHUNK'
    || message.type === 'DOMSHOT_HISTORY_COMMIT' || message.type === 'DOMSHOT_HISTORY_CANCEL') {
    cleanExpiredHistoryUploads();
  }

  if (message.type === 'DOMSHOT_HISTORY_BEGIN') {
    const expectedChunks = Math.max(1, Math.ceil(message.capture.size / CAPTURE_HISTORY_POLICY.chunkBytes));
    if (!Number.isSafeInteger(message.capture.size) || message.capture.size < 0 || message.capture.size > CAPTURE_HISTORY_POLICY.maxCaptureBytes) {
      throw new Error('Capture is too large for history');
    }
    if (!isSha256Digest(message.digest)) throw new Error('Invalid capture history digest');
    if (message.totalChunks !== expectedChunks) throw new Error('Invalid capture chunk count');
    const pendingForId = pendingHistoryCaptures.get(message.capture.id);
    if (pendingForId) {
      if (!sameCaptureMetadata(pendingForId.capture, message.capture)
        || pendingForId.mimeType !== message.mimeType
        || pendingForId.digest !== message.digest
        || pendingForId.chunks.length !== message.totalChunks) {
        throw new Error('Capture history identity conflict');
      }
      return { ok: true, uploadToken: pendingForId.uploadToken };
    }
    const existing = await confirmHistoryCapture(message.capture, message.mimeType, message.digest);
    if (existing === 'conflict') throw new Error('Capture history identity conflict');
    if (existing === 'stored') return { ok: true, alreadyStored: true };
    const otherUploads = Array.from(pendingHistoryCaptures.entries()).filter(([id]) => id !== message.capture.id);
    const pendingBytes = otherUploads.reduce((total, [, upload]) => total + upload.capture.size, 0);
    if (otherUploads.length >= MAX_PENDING_HISTORY_UPLOADS || pendingBytes + message.capture.size > CAPTURE_HISTORY_POLICY.maxTotalBytes) {
      throw new Error('Too many capture history uploads are in progress');
    }
    pendingHistoryCaptures.set(message.capture.id, {
      capture: message.capture,
      mimeType: message.mimeType,
      digest: message.digest,
      uploadToken: historyUploadToken(),
      chunks: new Array(message.totalChunks),
      createdAt: Date.now(),
    });
    return { ok: true, uploadToken: pendingHistoryCaptures.get(message.capture.id)!.uploadToken };
  }

  if (message.type === 'DOMSHOT_HISTORY_CHUNK') {
    const pending = pendingHistoryCaptures.get(message.id);
    if (!pending || pending.uploadToken !== message.uploadToken || message.index < 0 || message.index >= pending.chunks.length || message.data.length > MAX_ENCODED_CHUNK_LENGTH) {
      throw new Error('Invalid capture chunk');
    }
    pending.chunks[message.index] = message.data;
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_HISTORY_COMMIT') {
    const pending = pendingHistoryCaptures.get(message.id);
    if (!pending || pending.uploadToken !== message.uploadToken || pending.chunks.some((chunk) => chunk === undefined)) throw new Error('Capture upload is incomplete');
    try {
      const blob = new Blob(pending.chunks.map((chunk) => base64ToBuffer(chunk!)), { type: pending.mimeType });
      if (blob.size !== pending.capture.size) throw new Error('Capture upload size did not match');
      const digest = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
      if (digest !== pending.digest) throw new Error('Capture upload digest did not match');
      await saveHistoryCapture({ ...pending.capture, blob }, digest);
      return { ok: true };
    } finally {
      pendingHistoryCaptures.delete(message.id);
    }
  }

  if (message.type === 'DOMSHOT_HISTORY_CANCEL') {
    const pending = pendingHistoryCaptures.get(message.id);
    if (!pending || pending.uploadToken !== message.uploadToken) throw new Error('Invalid capture upload token');
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

  if (message.type === 'DOMSHOT_HISTORY_CONFIRM') {
    if (!isSha256Digest(message.digest)) return { state: 'conflict' };
    return { state: await confirmHistoryCapture(message.capture, message.mimeType, message.digest) };
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
    return { ok: await deleteHistoryCapture(message.id) };
  }

  if (message.type === 'DOMSHOT_HISTORY_RESTORE') {
    return { ok: await restoreHistoryCapture(message.id) };
  }

  if (message.type === 'DOMSHOT_HISTORY_CLEAR') {
    await clearHistoryCaptures();
    return { ok: true };
  }

  if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
    const urls = Array.from(new Set(message.urls));
    const accepted = urls.slice(0, 64);
    const resources = await mapWithConcurrency(accepted, 4, resolveImageResource);
    resources.push(...urls.slice(64).map(url => ({ url, reason: 'limit' as const })));
    return { resources };
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
    if (!request) return { ok: true, retried: false, reason: 'expired' as const };
    const granted = await chrome.permissions.contains({ origins: request.patterns });
    if (!granted) return { ok: false, retried: false };
    let response: { started?: boolean; reason?: 'busy' | 'expired' | 'disconnected' } | undefined;
    try {
      response = await chrome.tabs.sendMessage(request.tabId, { type: 'DOMSHOT_RETRY_CAPTURE', token: message.token } satisfies ExtensionMessage) as typeof response;
    } catch {
      await chrome.storage.session.remove(permissionKey(message.token));
      return { ok: true, retried: false, reason: 'disconnected' as const };
    }
    if (response?.reason === 'busy') {
      return { ok: true, retried: false, retryPending: true, reason: 'busy' as const };
    }
    await chrome.storage.session.remove(permissionKey(message.token));
    if (response?.started === true) return { ok: true, retried: true };
    return { ok: true, retried: false, reason: response?.reason ?? 'disconnected' };
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

function historyUploadToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  return Array.from(random, value => value.toString(16).padStart(8, '0')).join('');
}

function historyEvictionIds(captures: StoredCaptureMetadata[], protectedId?: string, now = Date.now()): Set<string> {
  const evicted = new Set(captures
    .filter(capture => capture.deletedAt && now - capture.deletedAt >= CAPTURE_HISTORY_POLICY.undoMilliseconds)
    .map(capture => capture.id));
  const active = captures
    .filter(capture => !capture.deletedAt && !evicted.has(capture.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  let activeBytes = active.reduce((total, capture) => total + capture.size, 0);
  while (active.length > CAPTURE_HISTORY_POLICY.maxItems || activeBytes > CAPTURE_HISTORY_POLICY.maxTotalBytes) {
    const removableIndex = active.findIndex(capture => capture.id !== protectedId);
    const oldest = removableIndex >= 0 ? active.splice(removableIndex, 1)[0] : active.shift();
    if (!oldest) break;
    activeBytes -= oldest.size;
    evicted.add(oldest.id);
  }

  const undoable = captures
    .filter(capture => capture.deletedAt && !evicted.has(capture.id))
    .sort((a, b) => (a.deletedAt! - b.deletedAt!) || (a.createdAt - b.createdAt));
  let physicalBytes = activeBytes + undoable.reduce((total, capture) => total + capture.size, 0);
  while (physicalBytes > CAPTURE_HISTORY_POLICY.maxTotalBytes && undoable.length) {
    const oldest = undoable.shift()!;
    physicalBytes -= oldest.size;
    evicted.add(oldest.id);
  }
  return evicted;
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer as ArrayBuffer;
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 2);
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction!;
      const store = event.oldVersion < 1
        ? request.result.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
        : transaction.objectStore(HISTORY_STORE);
      if (event.oldVersion < 1) store.createIndex('createdAt', 'createdAt');
      if (event.oldVersion < 2) {
        const blobs = request.result.createObjectStore(HISTORY_BLOB_STORE, { keyPath: 'id' });
        if (event.oldVersion === 1) {
          const migrated: StoredCaptureMetadata[] = [];
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              for (const id of historyEvictionIds(migrated)) {
                store.delete(id);
                blobs.delete(id);
              }
              return;
            }
            const legacy = cursor.value as StoredCaptureMetadata & { blob?: Blob };
            const expired = legacy.deletedAt && Date.now() - legacy.deletedAt >= CAPTURE_HISTORY_POLICY.undoMilliseconds;
            if (legacy.blob && legacy.blob.size === legacy.size && !expired) {
              blobs.put({ id: legacy.id, blob: legacy.blob, ...(legacy.digest ? { digest: legacy.digest } : {}) } satisfies StoredCaptureBlob);
              const { blob: _blob, ...metadata } = legacy;
              cursor.update(metadata);
              migrated.push(metadata);
            } else {
              cursor.delete();
            }
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open capture history'));
  });
}

async function withHistoryStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, storeName = HISTORY_STORE): Promise<T> {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
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

async function saveHistoryCapture(capture: CaptureHistoryItem & { blob: Blob }, digest: string): Promise<void> {
  const database = await openHistoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE);
    const blobs = transaction.objectStore(HISTORY_BLOB_STORE);
    const { blob, ...metadata } = capture;
    store.put({ ...metadata, digest });
    blobs.put({ id: capture.id, blob, digest } satisfies StoredCaptureBlob);
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      const now = Date.now();
      const storedCaptures = allRequest.result as StoredCaptureMetadata[];
      for (const id of historyEvictionIds(storedCaptures, capture.id, now)) {
        store.delete(id);
        blobs.delete(id);
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not save capture history')); };
  });
}

async function listHistoryCaptures(): Promise<CaptureHistoryItem[]> {
  const captures = await withHistoryStore<StoredCaptureMetadata[]>('readonly', (store) => store.getAll());
  const now = Date.now();
  const expired = captures.filter((capture) => capture.deletedAt && now - capture.deletedAt >= CAPTURE_HISTORY_POLICY.undoMilliseconds);
  expired.forEach((capture) => { void hardDeleteHistoryCapture(capture.id).catch(() => {}); });
  return captures
    .filter((capture) => !capture.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ deletedAt: _deletedAt, digest: _digest, ...metadata }) => metadata);
}

async function getHistoryCapture(id: string): Promise<(CaptureHistoryItem & { blob: Blob }) | undefined> {
  const metadata = await readStoredHistoryCapture(id);
  if (metadata?.deletedAt) {
    if (Date.now() - metadata.deletedAt >= CAPTURE_HISTORY_POLICY.undoMilliseconds) await hardDeleteHistoryCapture(id);
    return undefined;
  }
  if (!metadata) return undefined;
  const storedBlob = await withHistoryStore<StoredCaptureBlob | undefined>('readonly', (store) => store.get(id), HISTORY_BLOB_STORE);
  if (!storedBlob) {
    await hardDeleteHistoryCapture(id);
    return undefined;
  }
  const { deletedAt: _deletedAt, digest: _digest, ...capture } = metadata;
  if (storedBlob.blob.size !== capture.size) {
    await hardDeleteHistoryCapture(id);
    return undefined;
  }
  return { ...capture, blob: storedBlob.blob };
}

function readStoredHistoryCapture(id: string): Promise<StoredCaptureMetadata | undefined> {
  return withHistoryStore<StoredCaptureMetadata | undefined>('readonly', (store) => store.get(id));
}

async function confirmHistoryCapture(expected: CaptureHistoryItem, mimeType: string, digest: string): Promise<'stored' | 'missing' | 'conflict'> {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readonly');
    const metadataRequest = transaction.objectStore(HISTORY_STORE).get(expected.id);
    const blobRequest = transaction.objectStore(HISTORY_BLOB_STORE).get(expected.id);
    let state: 'stored' | 'missing' | 'conflict' = 'missing';
    transaction.oncomplete = () => {
      const metadata = metadataRequest.result as StoredCaptureMetadata | undefined;
      const storedBlob = blobRequest.result as StoredCaptureBlob | undefined;
      if (!metadata && !storedBlob) state = 'missing';
      else if (!metadata || metadata.deletedAt || !storedBlob) state = metadata?.deletedAt ? 'missing' : 'conflict';
      else state = sameCaptureMetadata(metadata, expected)
        && storedBlob.blob.size === expected.size
        && storedBlob.blob.type === mimeType
        && metadata.digest === digest
        && storedBlob.digest === digest ? 'stored' : 'conflict';
      database.close();
      resolve(state);
    };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not confirm capture history')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Capture history confirmation was aborted')); };
  });
}

function sameCaptureMetadata(stored: CaptureHistoryItem, expected: CaptureHistoryItem) {
  return stored.id === expected.id
    && stored.createdAt === expected.createdAt
    && stored.label === expected.label
    && stored.filename === expected.filename
    && stored.format === expected.format
    && stored.width === expected.width
    && stored.height === expected.height
    && stored.scale === expected.scale
    && stored.size === expected.size
    && stored.sourceHost === expected.sourceHost
    && stored.thumbnailDataUrl === expected.thumbnailDataUrl;
}

function isSha256Digest(value: string) {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

async function sha256Hex(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return `sha256:${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function deleteHistoryCapture(id: string): Promise<boolean> {
  const database = await openHistoryDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE);
    const blobs = transaction.objectStore(HISTORY_BLOB_STORE);
    const captureRequest = store.get(id);
    captureRequest.onsuccess = () => {
      const capture = captureRequest.result as StoredCaptureMetadata | undefined;
      if (!capture) { blobs.delete(id); return; }
      const blobRequest = blobs.get(id);
      blobRequest.onsuccess = () => {
        if (!blobRequest.result) store.delete(id);
        else if (!capture.deletedAt) store.put({ ...capture, deletedAt: Date.now() });
      };
    };
    transaction.oncomplete = () => { database.close(); resolve(true); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not delete capture history')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Capture history delete was aborted')); };
  });
}

async function restoreHistoryCapture(id: string): Promise<boolean> {
  const database = await openHistoryDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE);
    const blobs = transaction.objectStore(HISTORY_BLOB_STORE);
    let restored = false;
    const captureRequest = store.get(id);
    captureRequest.onsuccess = () => {
      const capture = captureRequest.result as StoredCaptureMetadata | undefined;
      if (!capture?.deletedAt || Date.now() - capture.deletedAt >= CAPTURE_HISTORY_POLICY.undoMilliseconds) {
        if (capture?.deletedAt) { store.delete(id); blobs.delete(id); }
        return;
      }
      const { deletedAt: _deletedAt, ...activeCapture } = capture;
      store.put(activeCapture);
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        const evicted = historyEvictionIds(allRequest.result as StoredCaptureMetadata[], id);
        for (const evictedId of evicted) {
          store.delete(evictedId);
          blobs.delete(evictedId);
        }
        restored = !evicted.has(id);
      };
    };
    transaction.oncomplete = () => { database.close(); resolve(restored); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not restore capture history')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Capture history restore was aborted')); };
  });
}

async function hardDeleteHistoryCapture(id: string): Promise<void> {
  const database = await openHistoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readwrite');
    transaction.objectStore(HISTORY_STORE).delete(id);
    transaction.objectStore(HISTORY_BLOB_STORE).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not delete capture history')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Capture history delete was aborted')); };
  });
}

async function clearHistoryCaptures(): Promise<void> {
  const database = await openHistoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([HISTORY_STORE, HISTORY_BLOB_STORE], 'readwrite');
    transaction.objectStore(HISTORY_STORE).clear();
    transaction.objectStore(HISTORY_BLOB_STORE).clear();
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not clear capture history')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Capture history clear was aborted')); };
  });
}

async function resolveImageResource(url: string): Promise<ResolvedImageResource> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url, reason: 'invalid' };
  } catch {
    return { url, reason: 'invalid' };
  }

  if (!await chrome.permissions.contains({ origins: [originPattern(parsed.origin)] })) {
    return { url, reason: 'permission', permissionUrl: parsed.href };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(parsed.href, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) return { url, reason: 'fetch' };
    const finalUrl = new URL(response.url || parsed.href);
    if (!await chrome.permissions.contains({ origins: [originPattern(finalUrl.origin)] })) {
      return { url, reason: 'permission', permissionUrl: finalUrl.href };
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return { url, reason: 'too-large' };
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return { url, reason: 'too-large' };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const imageType = detectImageContentType(bytes, contentType);
    if (!imageType) return { url, reason: 'unsupported' };
    return { url, dataUrl: `data:${imageType};base64,${bufferToBase64(bytes)}` };
  } catch (error) {
    return { url, reason: (error as { name?: unknown } | null)?.name === 'AbortError' ? 'timeout' : 'fetch' };
  } finally {
    clearTimeout(timeout);
  }
}

function detectImageContentType(bytes: Uint8Array, declaredType: string): string | null {
  if (declaredType.startsWith('image/')) return declaredType;
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== 'binary/octet-stream') return null;
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a')) return 'image/gif';
  if (startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes.subarray(8), 'WEBP')) return 'image/webp';
  if (startsWithAscii(bytes, 'BM')) return 'image/bmp';
  return null;
}

function startsWithBytes(bytes: Uint8Array, prefix: number[]) {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, prefix: string) {
  return startsWithBytes(bytes, Array.from(prefix, character => character.charCodeAt(0)));
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
