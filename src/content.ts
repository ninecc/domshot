import { snapdom } from '@zumer/snapdom';
import type { SnapdomPlugin } from '@zumer/snapdom';
import type { CaptureFormat, CaptureSettings, ExtensionMessage, ResolvedImageResource, UiLocale, UiTheme } from './types';
import { CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import { plural, resolveLocale, t } from './i18n';
import { resolveTheme } from './theme';
import { bindCaptureResultActions, copyCaptureResult, downloadCaptureResult } from './capture-result';
import type { CaptureResultAsset } from './capture-result';
import { CaptureHistorySession } from './history-client';

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
type CaptureClip = { x: number; y: number; width: number; height: number } | null;
const pendingCaptureRetries = new Map<string, { target: Element; settings: CaptureSettings; label: string; locale: UiLocale; theme: UiTheme; clip: CaptureClip; expires: number }>();

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
      currentSession = new ViewfinderSession({ ...DEFAULT_SETTINGS, ...message.settings }, message.locale ?? resolveLocale('auto'), message.theme ?? resolveTheme('auto'));
      currentSession.start();
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'DOMSHOT_FULL_PAGE') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = null;
      const locale = message.locale ?? resolveLocale('auto');
      const theme = message.theme ?? resolveTheme('auto');
      void captureElement(document.documentElement, { ...DEFAULT_SETTINGS, ...message.settings }, t(locale, 'fullPage'), locale, theme, null);
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'DOMSHOT_VISIBLE_AREA') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = null;
      const locale = message.locale ?? resolveLocale('auto');
      const theme = message.theme ?? resolveTheme('auto');
      void captureElement(document.documentElement, { ...DEFAULT_SETTINGS, ...message.settings }, t(locale, 'visibleArea'), locale, theme, visibleViewportClip());
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
      void captureElement(retry.target, retry.settings, retry.label, retry.locale, retry.theme, retry.clip);
      sendResponse({ started: true });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

function visibleViewportClip(): NonNullable<CaptureClip> {
  const viewport = window.visualViewport;
  return {
    x: viewport?.pageLeft ?? window.scrollX,
    y: viewport?.pageTop ?? window.scrollY,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

class ViewfinderSession {
  private host = document.createElement('div');
  private shadow: ShadowRoot;
  private outline: HTMLElement;
  private label: HTMLElement;
  private toolbar: HTMLElement;
  private hovered: Element | null = null;
  private active = false;

  constructor(private settings: CaptureSettings, private locale: UiLocale, private theme: UiTheme) {
    this.host.id = ROOT_ID;
    this.host.dataset.domshotUi = 'selector';
    this.host.dataset.domshotTheme = theme;
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
      await captureElement(target, this.settings, label, this.locale, this.theme, null);
    }, 120);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.destroy();
    showToast(t(this.locale, 'captureCanceled'), this.theme);
  };
}

async function captureElement(target: Element, settings: CaptureSettings, label: string, locale: UiLocale, theme: UiTheme, clip: CaptureClip) {
  const progress = showProgress(label, locale, theme);
  const imageResources = createImageResourceTracker();
  try {
    if (settings.captureDelay > 0) await new Promise((resolve) => window.setTimeout(resolve, settings.captureDelay));
    const result = await snapdom(target, {
      scale: settings.scale,
      dpr: 1,
      embedFonts: settings.embedFonts,
      reconcile: settings.reconcile,
      outerShadows: settings.outerShadows,
      compress: settings.compress,
      clip,
      exclude: [`#${ROOT_ID}`, '[data-domshot-ui]'],
      backgroundColor: settings.format === 'png' ? undefined : '#ffffff',
      plugins: [imageResources.plugin],
    });

    const image = await exportImage(result, settings.format, settings.quality);
    const blob = await imageToBlob(image, settings.format, locale);
    const filename = captureFilename(settings.filenameMode, label, settings.format, target === document.documentElement);
    progress.remove();
    const asset: CaptureResultAsset = { blob, format: settings.format, filename };
    const historySession = new CaptureHistorySession({
      createdAt: Date.now(), label, filename, format: settings.format,
      width: image.naturalWidth, height: image.naturalHeight, scale: settings.scale, size: blob.size,
      sourceHost: location.hostname, thumbnailDataUrl: createHistoryThumbnail(image), blob,
    });
    if (settings.saveRecentCaptures) {
      await historySession.save().catch(() => {
        // History is optional; a storage failure must not discard a successful capture.
      });
    }
    const previewOptions = {
      image,
      blob,
      format: settings.format,
      label,
      scale: settings.scale,
      failedImageCount: imageResources.failedCount(),
      failedImageUrls: imageResources.failedUrls(),
      locale,
      theme,
      filename,
      historySession,
      retry: { target, settings, label, locale, theme, clip },
    };
    if (imageResources.failedCount() > 0 || settings.afterCapture === 'preview') {
      showPreview(previewOptions);
    } else if (settings.afterCapture === 'copy') {
      try {
        const announcement = await copyCaptureResult(asset, locale);
        showToast(announcement, theme, historyToastAction(historySession, locale));
      } catch {
        showPreview({ ...previewOptions, initialCopyFailure: true });
      }
    } else {
      downloadCaptureResult(asset);
      showToast(t(locale, 'downloadStarted'), theme, historyToastAction(historySession, locale));
    }
  } catch (error) {
    progress.remove();
    showError(error instanceof Error ? error.message : t(locale, 'pageResourceFailed'), locale, theme);
  }
}

function createHistoryThumbnail(image: HTMLImageElement): string {
  const ratio = Math.min(280 / image.naturalWidth, 180 / image.naturalHeight, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', .76);
}


type SnapResult = Awaited<ReturnType<typeof snapdom>>;

async function exportImage(result: SnapResult, format: CaptureFormat, quality: number): Promise<HTMLImageElement> {
  if (format === 'jpg') return result.toJpg({ quality });
  if (format === 'webp') return result.toWebp({ quality });
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

function showPreview({ image, blob, format, label, scale, failedImageCount, failedImageUrls, locale, theme, filename, historySession, retry, initialCopyFailure }: {
  image: HTMLImageElement;
  blob: Blob;
  format: CaptureFormat;
  label: string;
  scale: number;
  failedImageCount: number;
  failedImageUrls: string[];
  locale: UiLocale;
  theme: UiTheme;
  filename: string;
  historySession: CaptureHistorySession;
  retry: { target: Element; settings: CaptureSettings; label: string; locale: UiLocale; theme: UiTheme; clip: CaptureClip };
  initialCopyFailure?: boolean;
}) {
  removeExtensionUi();
  const host = createHost('preview', theme);
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
    <style>${previewInteractionStyles()}</style>
    <style>${themeStyles()}</style>
    <aside class="preview-card${hasResourceWarning ? ' has-resource-warning' : ''}" role="dialog" aria-label="${previewTitle}">
      <div class="preview-head">
        <div><span class="status-dot">${hasResourceWarning ? '!' : '✓'}</span><strong class="preview-title">${previewTitle}</strong></div>
        <button class="icon-button close" type="button" aria-label="${t(locale, 'close')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
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
      <div class="history-retention"><span class="history-retention-status"></span><button class="history-retention-toggle" type="button"></button></div>
      <div class="preview-actions">
        <button class="copy" type="button" data-capture-action="copy">${t(locale, 'copyImage')}</button>
        <button class="download" type="button" data-capture-action="download">${t(locale, 'downloadFormat', { format: extension.toUpperCase() })}</button>
      </div>
      <span class="action-status" aria-live="polite" aria-atomic="true"></span>
    </aside>`;

  let retryToken: string | null = null;
  const resetTimers = new Map<HTMLButtonElement, number>();
  const actionStatus = shadow.querySelector<HTMLElement>('.action-status')!;
  const resultActions = bindCaptureResultActions(shadow, {
    locale,
    loadAsset: async () => ({ blob, format, filename }),
  });
  const historyControlCleanup = bindHistoryRetention(shadow, historySession, locale);
  const showButtonState = (button: HTMLButtonElement, text: string, state: 'success' | 'error', resetText: string, announcement = text) => {
    const currentTimer = resetTimers.get(button);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    button.classList.toggle('is-success', state === 'success');
    button.classList.toggle('is-error', state === 'error');
    button.textContent = text;
    actionStatus.textContent = announcement;
    const timer = window.setTimeout(() => {
      button.classList.remove('is-success', 'is-error');
      button.textContent = resetText;
      if (actionStatus.textContent === announcement) actionStatus.textContent = '';
      resetTimers.delete(button);
    }, 1800);
    resetTimers.set(button, timer);
  };
  const cleanup = () => {
    if (retryToken) void chrome.runtime.sendMessage({ type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION', token: retryToken } satisfies ExtensionMessage).catch(() => {});
    resetTimers.forEach((timer) => window.clearTimeout(timer));
    resultActions.cleanup();
    historyControlCleanup();
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
    let failed = false;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION',
        token: retryToken,
        origins: failedOrigins,
        locale,
        theme,
      } satisfies ExtensionMessage) as { prepared?: boolean; frameUrl?: string } | undefined;
      if (!response?.prepared || !response.frameUrl) throw new Error(t(locale, 'permissionPrepareFailed'));
      card.classList.add('is-authorizing');
      card.setAttribute('aria-label', t(locale, 'authorizeImageSources'));
      title.textContent = t(locale, 'authorizeImageSources');
      statusDot.textContent = '↗';
      permissionPanel.hidden = false;
      permissionFrame.src = response.frameUrl;
    } catch {
      failed = true;
      showButtonState(grantButton, t(locale, 'permissionFailed'), 'error', authorizeOrigins, t(locale, 'permissionLoadFailed'));
    } finally {
      grantButton.disabled = false;
      if (!failed) grantButton.textContent = authorizeOrigins;
    }
  });
  const openPermissionButton = shadow.querySelector<HTMLButtonElement>('.open-permission-window')!;
  const openPermissionLabel = openPermissionButton.textContent || t(locale, 'openStandalone');
  openPermissionButton.addEventListener('click', async () => {
    if (!retryToken) return;
    const response = await chrome.runtime.sendMessage({ type: 'DOMSHOT_OPEN_IMAGE_PERMISSION', token: retryToken } satisfies ExtensionMessage) as { opened?: boolean } | undefined;
    if (!response?.opened) showButtonState(openPermissionButton, t(locale, 'openFailed'), 'error', openPermissionLabel, t(locale, 'permissionWindowFailed'));
  });
  document.documentElement.appendChild(host);
  if (initialCopyFailure) resultActions.showInitialCopyFailure();
}

function captureFilename(mode: CaptureSettings['filenameMode'], label: string, format: CaptureFormat, fullPage: boolean): string {
  const stamp = timestamp();
  if (mode === 'timestamp') return `domshot-${stamp}.${format}`;
  const pageTitle = document.title.trim();
  const source = mode === 'page-title' || fullPage ? pageTitle || label : label;
  return `domshot-${safeFilename(source)}-${stamp}.${format}`;
}

function bindHistoryRetention(root: ParentNode, session: CaptureHistorySession, locale: UiLocale): () => void {
  const status = root.querySelector<HTMLElement>('.history-retention-status')!;
  const button = root.querySelector<HTMLButtonElement>('.history-retention-toggle')!;
  let removedByUser = false;
  const render = () => {
    status.textContent = session.saved
      ? `✓ ${t(locale, 'savedToRecent')}`
      : t(locale, removedByUser ? 'notKeptInRecent' : 'historyNotSaved');
    button.textContent = session.saved
      ? t(locale, 'dontSaveThisCapture')
      : t(locale, removedByUser ? 'restoreHistorySave' : 'saveToRecent');
    button.dataset.state = session.saved ? 'remove' : 'save';
  };
  const toggle = async () => {
    button.disabled = true;
    try {
      if (session.saved) {
        await session.remove();
        removedByUser = true;
      } else {
        await session.save();
        removedByUser = false;
      }
      render();
    } catch {
      status.textContent = t(locale, 'historyActionFailed');
    } finally { button.disabled = false; }
  };
  button.addEventListener('click', toggle);
  render();
  return () => button.removeEventListener('click', toggle);
}

type ToastAction = { label: string; run: () => Promise<string> };

function historyToastAction(session: CaptureHistorySession, locale: UiLocale): ToastAction | undefined {
  if (session.saved) {
    return {
      label: t(locale, 'dontSaveThisCapture'),
      async run() {
        await session.remove();
        return t(locale, 'notKeptInRecent');
      },
    };
  }
  return {
    label: t(locale, 'saveToRecent'),
    async run() {
      await session.save();
      return t(locale, 'savedToRecent');
    },
  };
}

function showProgress(label: string, locale: UiLocale, theme: UiTheme): HTMLElement {
  removeExtensionUi();
  const host = createHost('progress', theme);
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <style>${themeStyles()}</style>
    <div class="toast progress"><span class="spinner"></span><span><strong>${t(locale, 'generatingImage')}</strong><small>${escapeHtml(t(locale, 'doNotSwitch', { label }))}</small></span></div>`;
  document.documentElement.appendChild(host);
  return host;
}

function showError(message: string, locale: UiLocale, theme: UiTheme) {
  const host = createHost('error', theme);
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <style>${themeStyles()}</style>
    <div class="toast error"><span class="error-mark">!</span><span><strong>${t(locale, 'captureFailed')}</strong><small>${escapeHtml(t(locale, 'checkResources', { message }))}</small></span><button type="button">${t(locale, 'close')}</button></div>`;
  host.shadowRoot!.querySelector('button')!.addEventListener('click', () => host.remove());
  document.documentElement.appendChild(host);
}

function showToast(message: string, theme: UiTheme, action?: ToastAction) {
  removeExtensionUi();
  const host = createHost('toast', theme);
  host.shadowRoot!.innerHTML = `${sharedStyles()}<style>${toastStyles()}</style><style>${themeStyles()}</style><div class="toast compact"><strong>${escapeHtml(message)}</strong>${action ? `<button type="button">${escapeHtml(action.label)}</button>` : ''}</div>`;
  document.documentElement.appendChild(host);
  let timer = window.setTimeout(() => host.remove(), action ? 4200 : 1800);
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>('button');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    try {
      host.shadowRoot!.querySelector('strong')!.textContent = await action!.run();
      button.remove();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => host.remove(), 1800);
    } catch { button.disabled = false; }
  });
}

function createHost(kind: string, theme: UiTheme): HTMLDivElement {
  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.dataset.domshotUi = kind;
  host.dataset.domshotTheme = theme;
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
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 36) || 'capture';
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

function sharedStyles() {
  return `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:${UI_FONT};color:#0f172a}*{box-sizing:border-box}button{font:inherit}button:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}</style>`;
}

function selectorMarkup(locale: UiLocale) {
  return `
    ${sharedStyles()}
    <style>
      :host{cursor:crosshair}.outline{position:fixed;left:0;top:0;display:none;border:2px solid #2563eb;background:rgba(37,99,235,.1);box-shadow:0 0 0 1px rgba(255,255,255,.9),inset 0 0 0 1px rgba(139,92,246,.25);transition:width .06s,height .06s,transform .06s}.outline.capturing{animation:pulse .7s infinite alternate}.element-label{position:fixed;left:0;top:0;display:none;max-width:300px;padding:5px 8px;border-radius:6px;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);font:600 10px/1.3 ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{position:fixed;left:50%;top:18px;padding:11px 16px;border:1px solid rgba(255,255,255,.72);border-radius:13px;color:#0f172a;background:rgba(255,255,255,.96);box-shadow:0 12px 34px rgba(15,23,42,.18);transform:translateX(-50%);pointer-events:auto}.toolbar strong,.toolbar small{display:block}.toolbar strong{font-size:12px}.toolbar small{color:#64748b;font-size:9px;margin-top:2px}@keyframes pulse{to{background:rgba(139,92,246,.22)}}.spinner{float:left;width:17px;height:17px;margin:2px 10px 0 0;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.outline{transition:none}.spinner{animation-duration:1.5s}}
    </style>
    <style>${themeStyles()}</style>
    <div class="outline"></div><div class="element-label"></div>
    <div class="toolbar"><strong>${t(locale, 'selectElementToolbar')}</strong><small>${t(locale, 'moveClick')}</small></div>`;
}

function previewStyles() {
  return `
    :host{position:fixed;inset:auto;left:var(--domshot-viewport-left,0);top:var(--domshot-viewport-top,0);display:flex;box-sizing:border-box;width:var(--domshot-viewport-width,100vw);height:var(--domshot-viewport-height,100vh);align-items:flex-end;justify-content:flex-end;padding:calc(18px * var(--domshot-ui-scale,1))}.preview-card{width:336px;flex:none;padding:12px;border:1px solid #dfe5ee;border-radius:18px;background:#f8fafc;box-shadow:0 18px 52px rgba(15,23,42,.24);transform:scale(var(--domshot-ui-scale,1));transform-origin:right bottom;pointer-events:auto}.preview-head{display:flex;align-items:center;justify-content:space-between;padding:2px 3px 10px;font-size:13px}.status-dot{display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:50%;color:#fff;background:#10b981;font-weight:900}.has-resource-warning .status-dot{background:#f59e0b}.is-authorizing .status-dot{background:linear-gradient(135deg,#2563eb,#8b5cf6)}.icon-button{width:26px;height:26px;border:0;border-radius:8px;color:#64748b;background:transparent;font-size:20px;cursor:pointer}.icon-button:hover{background:#eef2f7}.image-stage{display:flex;align-items:center;justify-content:center;height:196px;padding:10px;border:1px solid #dfe5ee;border-radius:12px;background:repeating-conic-gradient(#e8edf4 0 25%,#fff 0 50%) 50%/14px 14px;overflow:hidden}.image-stage img{display:block;max-width:100%;max-height:100%;border-radius:3px;box-shadow:0 5px 18px rgba(15,23,42,.16)}.resource-warning{display:grid;gap:7px;margin:8px 0 0;padding:8px 10px;border:1px solid #fde68a;border-radius:9px;color:#92400e;background:#fffbeb;font-size:10px;line-height:1.45}.grant-images{min-height:31px;border:1px solid #f3c44e;border-radius:8px;color:#78350f;background:#fff;font-size:9px;font-weight:800;cursor:pointer}.grant-images:hover{border-color:#d79b16;background:#fffcf2}.grant-images:disabled{cursor:wait;opacity:.65}.permission-panel{display:grid;gap:5px}.permission-panel[hidden]{display:none}.permission-panel iframe{display:block;width:100%;height:292px;border:0;border-radius:12px;background:#f8fafc}.open-permission-window{min-height:25px;border:0;color:#64748b;background:transparent;font-size:8px;cursor:pointer}.open-permission-window:hover{color:#2563eb;text-decoration:underline;text-underline-offset:2px}.is-authorizing .image-stage,.is-authorizing .resource-warning,.is-authorizing .meta,.is-authorizing .history-retention,.is-authorizing .preview-actions,.is-authorizing .feedback{display:none}.meta{display:flex;justify-content:space-between;gap:8px;padding:10px 2px 7px;color:#64748b;font:9px ui-monospace,SFMono-Regular,monospace}.meta span{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-retention{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 8px;padding-top:7px;border-top:1px solid #e5eaf1;color:#64748b;font-size:8px;line-height:12px}.history-retention-toggle{min-height:24px;padding:0 8px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;background:#fff;font-size:8px;font-weight:800;cursor:pointer;transition:border-color .15s ease,color .15s ease,background-color .15s ease,box-shadow .15s ease}.history-retention-toggle:hover{border-color:#93b4f5;color:#1d4ed8;background:#eff6ff;box-shadow:0 3px 10px rgba(37,99,235,.1)}.history-retention-toggle[data-state="remove"]:hover{border-color:#fca5a5;color:#b91c1c;background:#fff1f2;box-shadow:0 3px 10px rgba(239,68,68,.08)}.history-retention-toggle:disabled{cursor:wait;opacity:.55}.preview-actions{display:grid;grid-template-columns:1fr 1.2fr;gap:8px}.preview-actions button{min-height:38px;border:1px solid #d6deea;border-radius:10px;color:#0f172a;background:#fff;font-size:11px;font-weight:800;cursor:pointer}.preview-actions .copy.is-success{border-color:#86efac;color:#047857;background:#ecfdf5}.preview-actions .download{border:0;color:#fff;background:linear-gradient(135deg,#2563eb,#8b5cf6)}.preview-actions button:hover{transform:translateY(-1px)}.feedback{height:0;margin:0;color:#10b981;font-size:9px;text-align:center;opacity:0;transition:.15s}.feedback:not(:empty){height:21px;padding-top:8px;opacity:1}.feedback.is-error{color:#ef4444}.copy-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(prefers-reduced-motion:reduce){.history-retention-toggle,.preview-actions button,.feedback{transition:none}}`;
}

function previewInteractionStyles() {
  return `
    .icon-button{display:grid;place-items:center;padding:0;line-height:1;transition:color .15s ease}
    .icon-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
    .icon-button:hover{color:#2563eb;background:transparent}
    .preview-actions button{transition:border-color .15s ease,background-color .15s ease,color .15s ease,box-shadow .15s ease,filter .15s ease}
    .preview-actions .download{border:1px solid transparent}
    .preview-actions button:hover{transform:none;border-color:#b7c9f7;box-shadow:0 7px 18px rgba(37,99,235,.1)}
    .preview-actions .download:not(.is-success):not(.is-error):hover{filter:brightness(.9) saturate(1.08);box-shadow:0 8px 20px rgba(37,99,235,.22)}
    .preview-actions button.is-success{border-color:#86efac;color:#047857;background:#ecfdf5}
    .preview-actions button.is-error{border-color:#fecaca;color:#b91c1c;background:#fff1f2}
    .action-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(prefers-reduced-motion:reduce){.preview-actions button{transition:none}}
  `;
}

function themeStyles() {
  return `
    :host([data-domshot-theme="dark"]){color:#e6edf8}
    :host([data-domshot-theme="dark"]) .toolbar,
    :host([data-domshot-theme="dark"]) .toast{border-color:#334155;color:#e6edf8;background:rgba(15,23,42,.97);box-shadow:0 12px 34px rgba(0,0,0,.38)}
    :host([data-domshot-theme="dark"]) .toolbar small,
    :host([data-domshot-theme="dark"]) .toast small,
    :host([data-domshot-theme="dark"]) .meta{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .preview-card{border-color:#334155;color:#e6edf8;background:#0f172a;box-shadow:0 18px 52px rgba(0,0,0,.48)}
    :host([data-domshot-theme="dark"]) .icon-button{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .icon-button:hover{color:#60a5fa;background:transparent}
    :host([data-domshot-theme="dark"]) .image-stage{border-color:#334155;background:repeating-conic-gradient(#1e293b 0 25%,#0b1220 0 50%) 50%/14px 14px}
    :host([data-domshot-theme="dark"]) .resource-warning{border-color:#854d0e;color:#fcd34d;background:#2a1f0b}
    :host([data-domshot-theme="dark"]) .grant-images{border-color:#a16207;color:#fde68a;background:#1c1917}
    :host([data-domshot-theme="dark"]) .grant-images:hover{border-color:#d97706;background:#29200f}
    :host([data-domshot-theme="dark"]) .permission-panel iframe{background:#0f172a}
    :host([data-domshot-theme="dark"]) .open-permission-window{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .history-retention{border-color:#26354a;color:#94a3b8}
    :host([data-domshot-theme="dark"]) .history-retention-toggle{border-color:#334155;color:#cbd5e1;background:#111b2b}
    :host([data-domshot-theme="dark"]) .history-retention-toggle:hover{border-color:#60a5fa;color:#bfdbfe;background:#16243a;box-shadow:0 3px 12px rgba(37,99,235,.2)}
    :host([data-domshot-theme="dark"]) .history-retention-toggle[data-state="remove"]:hover{border-color:#ef4444;color:#fecaca;background:#3f1118;box-shadow:0 3px 12px rgba(239,68,68,.12)}
    :host([data-domshot-theme="dark"]) .preview-actions button{border-color:#334155;color:#e6edf8;background:#111b2b}
    :host([data-domshot-theme="dark"]) .preview-actions .download{border:1px solid transparent;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed)}
    :host([data-domshot-theme="dark"]) .preview-actions button:not(.is-success):not(.is-error):hover{border-color:#60a5fa;background:#16243a;box-shadow:0 7px 18px rgba(37,99,235,.2)}
    :host([data-domshot-theme="dark"]) .preview-actions .download:not(.is-success):not(.is-error):hover{border-color:#93c5fd;color:#fff;background:linear-gradient(135deg,#1d4ed8,#6d28d9);filter:brightness(.96) saturate(1.08);box-shadow:0 8px 20px rgba(37,99,235,.3)}
    :host([data-domshot-theme="dark"]) .preview-actions button.is-success{border-color:#166534;color:#6ee7b7;background:#063b2c}
    :host([data-domshot-theme="dark"]) .preview-actions button.is-error{border-color:#991b1b;color:#fca5a5;background:#3f1118}
    :host([data-domshot-theme="dark"]) .toast.error{border-color:#7f1d1d;background:#2b1116}
    :host([data-domshot-theme="dark"]) .toast button{color:#60a5fa}
    :host([data-domshot-theme="dark"]) .outline{border-color:#60a5fa;background:rgba(37,99,235,.16);box-shadow:0 0 0 1px rgba(15,23,42,.95),inset 0 0 0 1px rgba(167,139,250,.3)}
  `;
}

function toastStyles() {
  return `
    :host{display:flex;align-items:flex-start;justify-content:center;padding-top:18px}.toast{display:flex;align-items:center;gap:11px;min-width:270px;padding:12px 15px;border:1px solid #dfe5ee;border-radius:13px;color:#0f172a;background:rgba(255,255,255,.97);box-shadow:0 12px 34px rgba(15,23,42,.2);pointer-events:auto}.toast strong,.toast small{display:block}.toast strong{font-size:12px}.toast small{max-width:340px;margin-top:3px;color:#64748b;font-size:9px}.spinner{width:18px;height:18px;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}.error-mark{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;background:#ef4444;font-weight:900}.toast button{margin-left:auto;border:0;color:#2563eb;background:none;font-size:10px;cursor:pointer}.compact{min-width:auto}.error{border-color:#fecaca;background:#fff7f7}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.5s}}`;
}
