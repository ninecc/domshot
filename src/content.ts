import { snapdom } from '@zumer/snapdom';
import type { CaptureFormat, CaptureSettings, ExtensionMessage, UiLocale, UiTheme } from './types';
import { CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import { plural, resolveLocale, t } from './i18n';
import { resolveTheme } from './theme';
import { bindCaptureResultActions, copyCaptureResult, downloadCaptureResult } from './capture-result';
import type { CaptureResultAsset } from './capture-result';
import { CaptureHistorySession } from './history-client';
import { trackImageResources } from './image-resource-tracker';
import { selectorMarkup } from './content-ui';
import { createHost, extensionUiCapturePlugin, isExtensionUi, registerHostCleanup, removeExtensionUi, removeHost } from './ui-host';
import {
  historyToastAction,
  setPageZoom,
  showError,
  showPreview,
  showProgress,
  showToast,
} from './capture-ui';
import type { CaptureClip, CaptureRetry } from './capture-ui';

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

let currentSession: ViewfinderSession | null = null;
const pendingCaptureRetries = new Map<string, { target: Element; settings: CaptureSettings; label: string; locale: UiLocale; theme: UiTheme; clip: CaptureClip; expires: number }>();

function registerCaptureRetry(token: string, retry: CaptureRetry) {
  pendingCaptureRetries.set(token, { ...retry, expires: Date.now() + 10 * 60 * 1000 });
}

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
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    currentSession?.destroy();
    removeExtensionUi();
    pendingCaptureRetries.clear();
  };
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
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private outline: HTMLElement;
  private label: HTMLElement;
  private toolbar: HTMLElement;
  private hovered: Element | null = null;
  private active = false;

  constructor(private settings: CaptureSettings, private locale: UiLocale, private theme: UiTheme) {
    this.host = createHost('selector', theme);
    this.shadow = this.host.shadowRoot!;
    this.shadow.innerHTML = selectorMarkup(this.locale);
    this.outline = this.shadow.querySelector<HTMLElement>('.outline')!;
    this.label = this.shadow.querySelector<HTMLElement>('.element-label')!;
    this.toolbar = this.shadow.querySelector<HTMLElement>('.toolbar')!;
  }

  start() {
    document.documentElement.appendChild(this.host);
    this.active = true;
    registerHostCleanup(this.host, () => this.dispose());
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  destroy() {
    removeHost(this.host);
  }

  private dispose() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (currentSession === this) currentSession = null;
  }

  private onMove = (event: MouseEvent) => {
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    if (!candidate || isExtensionUi(candidate)) return;
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
  const imageResources = trackImageResources();
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
      backgroundColor: settings.format === 'png' ? undefined : '#ffffff',
      plugins: [extensionUiCapturePlugin(), imageResources.plugin],
    });

    const image = await exportImage(result, settings.format, settings.quality);
    const blob = await imageToBlob(image, settings.format, locale);
    const resourceReport = imageResources.report();
    const filename = captureFilename(settings.filenameMode, label, settings.format, target === document.documentElement);
    removeHost(progress);
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
      failedImageCount: resourceReport.failedCount,
      failedImageUrls: resourceReport.failedUrls,
      locale,
      theme,
      filename,
      historySession,
      retry: { target, settings, label, locale, theme, clip },
      registerRetry: registerCaptureRetry,
      cancelRetry: (token: string) => pendingCaptureRetries.delete(token),
    };
    if (resourceReport.failedCount > 0 || settings.afterCapture === 'preview') {
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
    removeHost(progress);
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


function captureFilename(mode: CaptureSettings['filenameMode'], label: string, format: CaptureFormat, fullPage: boolean): string {
  const stamp = timestamp();
  if (mode === 'timestamp') return `domshot-${stamp}.${format}`;
  const pageTitle = document.title.trim();
  const source = mode === 'page-title' || fullPage ? pageTitle || label : label;
  return `domshot-${safeFilename(source)}-${stamp}.${format}`;
}


function describeElement(element: Element): string {
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.slice(0, 48);
  const heading = element.querySelector('h1, h2, h3')?.textContent?.trim();
  if (heading) return heading.replace(/\s+/g, ' ').slice(0, 48);
  if (element.id) return `#${element.id}`;
  return element.tagName.toLowerCase();
}


function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 36) || 'capture';
}

function timestamp() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0')).join('');
}
