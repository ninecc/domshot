import { snapdom } from '@zumer/snapdom';
import type { SnapdomPlugin } from '@zumer/snapdom';
import type { CaptureFormat, CaptureSettings, ExtensionMessage, ResolvedImageResource, UiLocale } from './types';
import { CONTENT_SCRIPT_PROTOCOL } from './types';
import { plural, resolveLocale, t } from './i18n';

declare global {
  interface Window {
    __domShotLoaded?: boolean;
    __domShotProtocol?: number;
    __domShotCleanup?: () => void;
  }
}

if (window.__domShotProtocol !== CONTENT_SCRIPT_PROTOCOL) {
  try {
    window.__domShotCleanup?.();
  } catch { /* A listener from a reloaded extension context may already be invalid. */ }
  window.__domShotLoaded = true;
  window.__domShotProtocol = CONTENT_SCRIPT_PROTOCOL;
  window.__domShotCleanup = installMessageListener();
}

const ROOT_ID = 'domshot-extension-root';
const UI_FONT = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
const hostCleanups = new WeakMap<Element, () => void>();
let currentSession: ViewfinderSession | null = null;
let currentPageZoom = 1;
let currentPreviewUpdate: (() => void) | null = null;
const pendingCaptureRetries = new Map<string, { target: Element; settings: CaptureSettings; label: string; locale: UiLocale; expires: number }>();

function installMessageListener() {
  const listener = (message: ExtensionMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'DOMSHOT_PING') {
      sendResponse({ ready: true, protocol: CONTENT_SCRIPT_PROTOCOL });
      return;
    }

    if (message.type === 'DOMSHOT_ZOOM_CHANGED') {
      setPageZoom(message.pageZoom);
      sendResponse({ updated: true });
      return;
    }

    if (message.type === 'DOMSHOT_SELECT') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = new ViewfinderSession(message.settings, message.locale ?? resolveLocale('auto'));
      currentSession.start();
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'DOMSHOT_FULL_PAGE') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = null;
      const locale = message.locale ?? resolveLocale('auto');
      void captureElement(document.documentElement, message.settings, t(locale, 'fullPage'), locale);
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'DOMSHOT_RETRY_CAPTURE') {
      const retry = pendingCaptureRetries.get(message.token);
      pendingCaptureRetries.delete(message.token);
      if (!retry || retry.expires < Date.now() || !retry.target.isConnected) {
        sendResponse({ started: false });
        return;
      }
      void captureElement(retry.target, retry.settings, retry.label, retry.locale);
      sendResponse({ started: true });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

class ViewfinderSession {
  private host = document.createElement('div');
  private shadow: ShadowRoot;
  private outline: HTMLElement;
  private label: HTMLElement;
  private toolbar: HTMLElement;
  private hovered: Element | null = null;
  private active = false;

  constructor(private settings: CaptureSettings, private locale: UiLocale) {
    this.host.id = ROOT_ID;
    this.host.dataset.domshotUi = 'selector';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = selectorMarkup(this.locale);
    this.outline = this.shadow.querySelector<HTMLElement>('.outline')!;
    this.label = this.shadow.querySelector<HTMLElement>('.element-label')!;
    this.toolbar = this.shadow.querySelector<HTMLElement>('.toolbar')!;
  }

  start() {
    removeExtensionUi();
    document.documentElement.appendChild(this.host);
    this.active = true;
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    this.host.remove();
    if (currentSession === this) currentSession = null;
  }

  private onMove = (event: MouseEvent) => {
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    if (!candidate || candidate === this.host || candidate.closest(`#${ROOT_ID}`)) return;
    if (candidate === this.hovered) return;
    this.hovered = candidate;
    this.updateOutline();
  };

  private onViewportChange = () => this.updateOutline();

  private updateOutline() {
    if (!this.hovered || !this.hovered.isConnected) return;
    const rect = this.hovered.getBoundingClientRect();
    Object.assign(this.outline.style, {
      transform: `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`,
      width: `${Math.max(0, Math.round(rect.width))}px`,
      height: `${Math.max(0, Math.round(rect.height))}px`,
      display: rect.width && rect.height ? 'block' : 'none',
    });

    const name = this.hovered.tagName.toLowerCase();
    const id = this.hovered.id ? `#${this.hovered.id}` : '';
    const className = Array.from(this.hovered.classList).slice(0, 2).map((value) => `.${value}`).join('');
    this.label.textContent = `${name}${id}${className}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    const labelTop = rect.top > 38 ? rect.top - 30 : Math.min(window.innerHeight - 30, rect.bottom + 6);
    Object.assign(this.label.style, {
      transform: `translate(${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px, ${Math.max(6, labelTop)}px)`,
      display: 'block',
    });
  }

  private onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = this.hovered;
    if (!target) return;
    const label = describeElement(target);
    this.toolbar.innerHTML = `<span class="spinner"></span><strong>${t(this.locale, 'generatingImage')}</strong><small>${t(this.locale, 'embeddingResources')}</small>`;
    this.outline.classList.add('capturing');
    window.setTimeout(async () => {
      this.destroy();
      await captureElement(target, this.settings, label, this.locale);
    }, 120);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.destroy();
    showToast(t(this.locale, 'captureCanceled'));
  };
}

async function captureElement(target: Element, settings: CaptureSettings, label: string, locale: UiLocale) {
  const progress = showProgress(label, locale);
  const imageResources = createImageResourceTracker();
  try {
    const result = await snapdom(target, {
      scale: settings.scale,
      dpr: 1,
      embedFonts: settings.embedFonts,
      reconcile: settings.reconcile,
      exclude: [`#${ROOT_ID}`, '[data-domshot-ui]'],
      backgroundColor: settings.format === 'png' ? undefined : '#ffffff',
      plugins: [imageResources.plugin],
    });

    const image = await exportImage(result, settings.format);
    const blob = await imageToBlob(image, settings.format, locale);
    progress.remove();
    showPreview({
      image,
      blob,
      format: settings.format,
      label,
      scale: settings.scale,
      failedImageCount: imageResources.failedCount(),
      failedImageUrls: imageResources.failedUrls(),
      locale,
      retry: { target, settings, label, locale },
    });
  } catch (error) {
    progress.remove();
    showError(error instanceof Error ? error.message : t(locale, 'pageResourceFailed'), locale);
  }
}

type SnapResult = Awaited<ReturnType<typeof snapdom>>;

async function exportImage(result: SnapResult, format: CaptureFormat): Promise<HTMLImageElement> {
  if (format === 'jpg') return result.toJpg();
  if (format === 'webp') return result.toWebp();
  return result.toPng();
}

async function imageToBlob(image: HTMLImageElement, format: CaptureFormat, locale: UiLocale): Promise<Blob> {
  const response = await fetch(image.src);
  const original = await response.blob();
  const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
  if (original.type === mime) return original;

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t(locale, 'imageEncodeFailed'))), mime, .94));
}

function showPreview({ image, blob, format, label, scale, failedImageCount, failedImageUrls, locale, retry }: {
  image: HTMLImageElement;
  blob: Blob;
  format: CaptureFormat;
  label: string;
  scale: number;
  failedImageCount: number;
  failedImageUrls: string[];
  locale: UiLocale;
  retry: { target: Element; settings: CaptureSettings; label: string; locale: UiLocale };
}) {
  removeExtensionUi();
  const host = createHost('preview');
  syncPreviewViewport(host);
  const shadow = host.shadowRoot!;
  const url = URL.createObjectURL(blob);
  const size = formatBytes(blob.size);
  const extension = format === 'jpg' ? 'jpg' : format;
  const hasResourceWarning = failedImageCount > 0;
  const failedOrigins = imageOrigins(failedImageUrls);
  const previewTitle = t(locale, hasResourceWarning ? 'capturePartial' : 'captureComplete');
  const failedImageMessage = plural(locale, 'imageFailedOne', 'imageFailedMany', failedImageCount);
  const authorizeOrigins = plural(locale, 'authorizeOriginOne', 'authorizeOriginMany', failedOrigins.length);
  shadow.innerHTML = `
    ${sharedStyles()}
    <style>${previewStyles()}</style>
    <aside class="preview-card${hasResourceWarning ? ' has-resource-warning' : ''}" role="dialog" aria-label="${previewTitle}">
      <div class="preview-head">
        <div><span class="status-dot">${hasResourceWarning ? '!' : '✓'}</span><strong class="preview-title">${previewTitle}</strong></div>
        <button class="icon-button close" type="button" aria-label="${t(locale, 'close')}">×</button>
      </div>
      <div class="image-stage"><img src="${url}" alt="${escapeHtml(t(locale, 'previewAlt', { label }))}" /></div>
      ${hasResourceWarning ? `<div class="resource-warning" role="alert"><span>${failedImageMessage}</span>${failedOrigins.length ? `<button class="grant-images" type="button">${authorizeOrigins}</button>` : ''}</div>` : ''}
      <div class="permission-panel" hidden>
        <iframe title="${t(locale, 'imageSourcePermission')}"></iframe>
        <button class="open-permission-window" type="button">${t(locale, 'openStandalone')}</button>
      </div>
      <div class="meta">
        <span>${escapeHtml(label)}</span>
        <span>${image.naturalWidth} × ${image.naturalHeight} · ${scale}× · ${size}</span>
      </div>
      <div class="preview-actions">
        <button class="copy" type="button">${t(locale, 'copyImage')}</button>
        <button class="download" type="button">${t(locale, 'downloadFormat', { format: extension.toUpperCase() })}</button>
      </div>
      <p class="feedback" role="status"></p>
      <span class="copy-status" aria-live="polite" aria-atomic="true"></span>
    </aside>`;

  let retryToken: string | null = null;
  let copyResetTimer: number | null = null;
  const cleanup = () => {
    if (retryToken) void chrome.runtime.sendMessage({ type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION', token: retryToken } satisfies ExtensionMessage).catch(() => {});
    if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
    URL.revokeObjectURL(url);
    window.removeEventListener('message', onPermissionMessage);
    removeHost(host);
  };
  const card = shadow.querySelector<HTMLElement>('.preview-card')!;
  const title = shadow.querySelector<HTMLElement>('.preview-title')!;
  const statusDot = shadow.querySelector<HTMLElement>('.status-dot')!;
  const permissionPanel = shadow.querySelector<HTMLElement>('.permission-panel')!;
  const permissionFrame = permissionPanel.querySelector<HTMLIFrameElement>('iframe')!;
  const restorePreview = () => {
    card.classList.remove('is-authorizing');
    card.setAttribute('aria-label', previewTitle);
    title.textContent = previewTitle;
    statusDot.textContent = '!';
    permissionPanel.hidden = true;
    permissionFrame.removeAttribute('src');
  };
  const onPermissionMessage = (event: MessageEvent) => {
    if (event.source !== permissionFrame.contentWindow || event.data?.type !== 'DOMSHOT_PERMISSION_CANCEL') return;
    restorePreview();
  };
  window.addEventListener('message', onPermissionMessage);
  shadow.querySelector('.close')!.addEventListener('click', cleanup);
  const grantButton = shadow.querySelector<HTMLButtonElement>('.grant-images');
  grantButton?.addEventListener('click', async () => {
    retryToken ??= crypto.randomUUID();
    pendingCaptureRetries.set(retryToken, { ...retry, expires: Date.now() + 10 * 60 * 1000 });
    grantButton.disabled = true;
    grantButton.textContent = t(locale, 'preparingPermission');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION',
        token: retryToken,
        origins: failedOrigins,
        locale,
      } satisfies ExtensionMessage) as { prepared?: boolean; frameUrl?: string } | undefined;
      if (!response?.prepared || !response.frameUrl) throw new Error(t(locale, 'permissionPrepareFailed'));
      card.classList.add('is-authorizing');
      card.setAttribute('aria-label', t(locale, 'authorizeImageSources'));
      title.textContent = t(locale, 'authorizeImageSources');
      statusDot.textContent = '↗';
      permissionPanel.hidden = false;
      permissionFrame.src = response.frameUrl;
    } catch {
      feedback(shadow, t(locale, 'permissionLoadFailed'), true);
    } finally {
      grantButton.disabled = false;
      grantButton.textContent = authorizeOrigins;
    }
  });
  shadow.querySelector('.open-permission-window')!.addEventListener('click', async () => {
    if (!retryToken) return;
    const response = await chrome.runtime.sendMessage({ type: 'DOMSHOT_OPEN_IMAGE_PERMISSION', token: retryToken } satisfies ExtensionMessage) as { opened?: boolean } | undefined;
    if (!response?.opened) feedback(shadow, t(locale, 'permissionWindowFailed'), true);
  });
  shadow.querySelector('.download')!.addEventListener('click', () => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `domshot-${safeFilename(label)}-${timestamp()}.${extension}`;
    anchor.click();
    feedback(shadow, t(locale, 'downloadStarted'));
  });
  const copyButton = shadow.querySelector<HTMLButtonElement>('.copy')!;
  const copyStatus = shadow.querySelector<HTMLElement>('.copy-status')!;
  const resetCopyButton = () => {
    copyButton.classList.remove('is-success');
    copyButton.textContent = t(locale, 'copyImage');
    copyStatus.textContent = '';
    copyResetTimer = null;
  };
  copyButton.addEventListener('click', async () => {
    try {
      const png = format === 'png' ? blob : await toPngBlob(image, locale);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
      feedback(shadow, '');
      copyButton.classList.add('is-success');
      copyButton.textContent = t(locale, 'copied');
      copyStatus.textContent = t(locale, format === 'png' ? 'imageCopied' : 'convertedCopied');
      copyResetTimer = window.setTimeout(resetCopyButton, 1800);
    } catch {
      if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
      resetCopyButton();
      feedback(shadow, t(locale, 'clipboardDenied'), true);
    }
  });
  document.documentElement.appendChild(host);
}

async function toPngBlob(image: HTMLImageElement, locale: UiLocale): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t(locale, 'pngConversionFailed'))), 'image/png'));
}

function showProgress(label: string, locale: UiLocale): HTMLElement {
  removeExtensionUi();
  const host = createHost('progress');
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <div class="toast progress"><span class="spinner"></span><span><strong>${t(locale, 'generatingImage')}</strong><small>${escapeHtml(t(locale, 'doNotSwitch', { label }))}</small></span></div>`;
  document.documentElement.appendChild(host);
  return host;
}

function showError(message: string, locale: UiLocale) {
  const host = createHost('error');
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <div class="toast error"><span class="error-mark">!</span><span><strong>${t(locale, 'captureFailed')}</strong><small>${escapeHtml(t(locale, 'checkResources', { message }))}</small></span><button type="button">${t(locale, 'close')}</button></div>`;
  host.shadowRoot!.querySelector('button')!.addEventListener('click', () => host.remove());
  document.documentElement.appendChild(host);
}

function showToast(message: string) {
  removeExtensionUi();
  const host = createHost('toast');
  host.shadowRoot!.innerHTML = `${sharedStyles()}<style>${toastStyles()}</style><div class="toast compact"><strong>${escapeHtml(message)}</strong></div>`;
  document.documentElement.appendChild(host);
  window.setTimeout(() => host.remove(), 1800);
}

function createHost(kind: string): HTMLDivElement {
  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.dataset.domshotUi = kind;
  host.attachShadow({ mode: 'open' });
  return host;
}

function syncPreviewViewport(host: HTMLElement) {
  const viewport = window.visualViewport;
  const update = () => {
    const safePageZoom = currentPageZoom;
    const visualScale = viewport && Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    host.style.setProperty('--domshot-ui-scale', String(1 / (safePageZoom * visualScale)));
    host.dataset.domshotPageZoom = String(safePageZoom);
    host.dataset.domshotVisualScale = String(visualScale);
    host.style.setProperty('--domshot-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    host.style.setProperty('--domshot-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    host.style.setProperty('--domshot-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
    host.style.setProperty('--domshot-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
  };

  update();
  currentPreviewUpdate = update;
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  hostCleanups.set(host, () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    if (currentPreviewUpdate === update) currentPreviewUpdate = null;
  });
}

function setPageZoom(pageZoom: number) {
  currentPageZoom = Number.isFinite(pageZoom) && pageZoom > 0 ? pageZoom : 1;
  currentPreviewUpdate?.();
}

function removeHost(host: Element) {
  hostCleanups.get(host)?.();
  hostCleanups.delete(host);
  host.remove();
}

function removeExtensionUi() {
  document.querySelectorAll(`#${ROOT_ID}`).forEach(removeHost);
}

function describeElement(element: Element): string {
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.slice(0, 48);
  const heading = element.querySelector('h1, h2, h3')?.textContent?.trim();
  if (heading) return heading.replace(/\s+/g, ' ').slice(0, 48);
  if (element.id) return `#${element.id}`;
  return element.tagName.toLowerCase();
}

function createImageResourceTracker() {
  const marker = 'data-domshot-image-resource';
  let trackedImages = 0;
  let failedImages = 0;
  let failedImageUrls: string[] = [];
  const trackedUrls = new Map<string, string>();
  const plugin: SnapdomPlugin = {
    name: 'image-resource-tracker',
    async afterClone({ clone }) {
      if (!clone) return;
      const images = clone.matches('img[src]')
        ? [clone as HTMLImageElement]
        : Array.from(clone.querySelectorAll<HTMLImageElement>('img[src]'));
      trackedImages = images.length;
      images.forEach((image, index) => {
        const id = String(index);
        image.setAttribute(marker, id);
        const source = absoluteHttpUrl(image.getAttribute('src'), image.ownerDocument.baseURI);
        if (source) trackedUrls.set(id, source);
      });

      const urls = Array.from(new Set(trackedUrls.values()));
      if (!urls.length) return;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'DOMSHOT_RESOLVE_IMAGES', urls } satisfies ExtensionMessage) as { resources?: ResolvedImageResource[] } | undefined;
        const resolved = new Map(response?.resources?.filter((resource) => resource.dataUrl).map((resource) => [resource.url, resource.dataUrl!]) ?? []);
        images.forEach((image) => {
          const source = trackedUrls.get(image.getAttribute(marker) || '');
          const dataUrl = source && resolved.get(source);
          if (dataUrl) image.setAttribute('src', dataUrl);
        });
      } catch { /* SnapDOM can still resolve resources that already permit CORS. */ }
    },
    beforeRender({ clone }) {
      if (!clone) return;
      const remainingImages = clone.matches(`img[${marker}]`)
        ? [clone as HTMLImageElement]
        : Array.from(clone.querySelectorAll<HTMLImageElement>(`img[${marker}]`));
      const embeddedImages = remainingImages.filter((image) => image.getAttribute('src')?.startsWith('data:')).length;
      failedImages = Math.max(0, trackedImages - embeddedImages);
      const embeddedIds = new Set(remainingImages
        .filter((image) => image.getAttribute('src')?.startsWith('data:'))
        .map((image) => image.getAttribute(marker)!));
      failedImageUrls = Array.from(new Set(Array.from(trackedUrls)
        .filter(([id]) => !embeddedIds.has(id))
        .map(([, url]) => url)));
      remainingImages.forEach((image) => image.removeAttribute(marker));
    },
  };

  return { plugin, failedCount: () => failedImages, failedUrls: () => failedImageUrls };
}

function absoluteHttpUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function imageOrigins(urls: string[]) {
  return Array.from(new Set(urls.map((url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch { return ''; }
  }).filter(Boolean))).slice(0, 16);
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-|-$/g, '').slice(0, 36) || 'capture';
}

function timestamp() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0')).join('');
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function feedback(shadow: ShadowRoot, message: string, error = false) {
  const element = shadow.querySelector<HTMLElement>('.feedback')!;
  element.textContent = message;
  element.classList.toggle('is-error', error);
}

function sharedStyles() {
  return `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:${UI_FONT};color:#0f172a}*{box-sizing:border-box}button{font:inherit}button:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}</style>`;
}

function selectorMarkup(locale: UiLocale) {
  return `
    ${sharedStyles()}
    <style>
      :host{cursor:crosshair}.outline{position:fixed;left:0;top:0;display:none;border:2px solid #2563eb;background:rgba(37,99,235,.1);box-shadow:0 0 0 1px rgba(255,255,255,.9),inset 0 0 0 1px rgba(139,92,246,.25);transition:width .06s,height .06s,transform .06s}.outline.capturing{animation:pulse .7s infinite alternate}.element-label{position:fixed;left:0;top:0;display:none;max-width:300px;padding:5px 8px;border-radius:6px;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);font:600 10px/1.3 ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{position:fixed;left:50%;top:18px;padding:11px 16px;border:1px solid rgba(255,255,255,.72);border-radius:13px;color:#0f172a;background:rgba(255,255,255,.96);box-shadow:0 12px 34px rgba(15,23,42,.18);transform:translateX(-50%);pointer-events:auto}.toolbar strong,.toolbar small{display:block}.toolbar strong{font-size:12px}.toolbar small{color:#64748b;font-size:9px;margin-top:2px}@keyframes pulse{to{background:rgba(139,92,246,.22)}}.spinner{float:left;width:17px;height:17px;margin:2px 10px 0 0;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.outline{transition:none}.spinner{animation-duration:1.5s}}
    </style>
    <div class="outline"></div><div class="element-label"></div>
    <div class="toolbar"><strong>${t(locale, 'selectElementToolbar')}</strong><small>${t(locale, 'moveClick')}</small></div>`;
}

function previewStyles() {
  return `
    :host{position:fixed;inset:auto;left:var(--domshot-viewport-left,0);top:var(--domshot-viewport-top,0);display:flex;box-sizing:border-box;width:var(--domshot-viewport-width,100vw);height:var(--domshot-viewport-height,100vh);align-items:flex-end;justify-content:flex-end;padding:calc(18px * var(--domshot-ui-scale,1))}.preview-card{width:336px;flex:none;padding:12px;border:1px solid #dfe5ee;border-radius:18px;background:#f8fafc;box-shadow:0 18px 52px rgba(15,23,42,.24);transform:scale(var(--domshot-ui-scale,1));transform-origin:right bottom;pointer-events:auto}.preview-head{display:flex;align-items:center;justify-content:space-between;padding:2px 3px 10px;font-size:13px}.status-dot{display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:50%;color:#fff;background:#10b981;font-weight:900}.has-resource-warning .status-dot{background:#f59e0b}.is-authorizing .status-dot{background:linear-gradient(135deg,#2563eb,#8b5cf6)}.icon-button{width:26px;height:26px;border:0;border-radius:8px;color:#64748b;background:transparent;font-size:20px;cursor:pointer}.icon-button:hover{background:#eef2f7}.image-stage{display:flex;align-items:center;justify-content:center;height:196px;padding:10px;border:1px solid #dfe5ee;border-radius:12px;background:repeating-conic-gradient(#e8edf4 0 25%,#fff 0 50%) 50%/14px 14px;overflow:hidden}.image-stage img{display:block;max-width:100%;max-height:100%;border-radius:3px;box-shadow:0 5px 18px rgba(15,23,42,.16)}.resource-warning{display:grid;gap:7px;margin:8px 0 0;padding:8px 10px;border:1px solid #fde68a;border-radius:9px;color:#92400e;background:#fffbeb;font-size:10px;line-height:1.45}.grant-images{min-height:31px;border:1px solid #f3c44e;border-radius:8px;color:#78350f;background:#fff;font-size:9px;font-weight:800;cursor:pointer}.grant-images:hover{border-color:#d79b16;background:#fffcf2}.grant-images:disabled{cursor:wait;opacity:.65}.permission-panel{display:grid;gap:5px}.permission-panel[hidden]{display:none}.permission-panel iframe{display:block;width:100%;height:292px;border:0;border-radius:12px;background:#f8fafc}.open-permission-window{min-height:25px;border:0;color:#64748b;background:transparent;font-size:8px;cursor:pointer}.open-permission-window:hover{color:#2563eb;text-decoration:underline;text-underline-offset:2px}.is-authorizing .image-stage,.is-authorizing .resource-warning,.is-authorizing .meta,.is-authorizing .preview-actions,.is-authorizing .feedback{display:none}.meta{display:flex;justify-content:space-between;gap:8px;padding:10px 2px;color:#64748b;font:9px ui-monospace,SFMono-Regular,monospace}.meta span{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-actions{display:grid;grid-template-columns:1fr 1.2fr;gap:8px}.preview-actions button{min-height:38px;border:1px solid #d6deea;border-radius:10px;color:#0f172a;background:#fff;font-size:11px;font-weight:800;cursor:pointer}.preview-actions .copy.is-success{border-color:#86efac;color:#047857;background:#ecfdf5}.preview-actions .download{border:0;color:#fff;background:linear-gradient(135deg,#2563eb,#8b5cf6)}.preview-actions button:hover{transform:translateY(-1px)}.feedback{height:0;margin:0;color:#10b981;font-size:9px;text-align:center;opacity:0;transition:.15s}.feedback:not(:empty){height:21px;padding-top:8px;opacity:1}.feedback.is-error{color:#ef4444}.copy-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(prefers-reduced-motion:reduce){.preview-actions button,.feedback{transition:none}}`;
}

function toastStyles() {
  return `
    :host{display:flex;align-items:flex-start;justify-content:center;padding-top:18px}.toast{display:flex;align-items:center;gap:11px;min-width:270px;padding:12px 15px;border:1px solid #dfe5ee;border-radius:13px;color:#0f172a;background:rgba(255,255,255,.97);box-shadow:0 12px 34px rgba(15,23,42,.2);pointer-events:auto}.toast strong,.toast small{display:block}.toast strong{font-size:12px}.toast small{max-width:340px;margin-top:3px;color:#64748b;font-size:9px}.spinner{width:18px;height:18px;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}.error-mark{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;background:#ef4444;font-weight:900}.toast button{margin-left:auto;border:0;color:#2563eb;background:none;font-size:10px;cursor:pointer}.compact{min-width:auto}.error{border-color:#fecaca;background:#fff7f7}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.5s}}`;
}
