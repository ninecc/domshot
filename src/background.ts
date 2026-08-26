import type { ExtensionMessage, ResolvedImageResource } from './types';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PERMISSION_REQUEST_TTL = 10 * 60 * 1000;

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  const message = { type: 'DOMSHOT_ZOOM_CHANGED', pageZoom: newZoomFactor } satisfies ExtensionMessage;
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Most tabs do not have DOMShot injected; they do not need zoom updates.
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : '后台处理失败' });
  });
  return true;
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'DOMSHOT_RESOLVE_IMAGES') {
    const urls = Array.from(new Set(message.urls)).slice(0, 64);
    return { resources: await mapWithConcurrency(urls, 4, resolveImageResource) };
  }

  if (message.type === 'DOMSHOT_PREPARE_IMAGE_PERMISSION') {
    const tabId = sender.tab?.id;
    if (!tabId) return { opened: false };
    const origins = validOrigins(message.origins);
    if (!origins.length) return { opened: false };
    const request = { tabId, origins, patterns: origins.map(originPattern), createdAt: Date.now() };
    await chrome.storage.session.set({ [permissionKey(message.token)]: request });
    return {
      prepared: true,
      frameUrl: chrome.runtime.getURL(`permission.html?mode=inline&token=${encodeURIComponent(message.token)}`),
    };
  }

  if (message.type === 'DOMSHOT_OPEN_IMAGE_PERMISSION') {
    const request = await readPermissionRequest(message.token);
    if (!request) return { opened: false };
    await chrome.windows.create({
      url: chrome.runtime.getURL(`permission.html?token=${encodeURIComponent(message.token)}`),
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
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
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

async function readPermissionRequest(token: string): Promise<{ tabId: number; origins: string[]; patterns: string[]; createdAt: number } | null> {
  const key = permissionKey(token);
  const stored = await chrome.storage.session.get(key);
  const request = stored[key] as { tabId: number; origins: string[]; patterns: string[]; createdAt: number } | undefined;
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
