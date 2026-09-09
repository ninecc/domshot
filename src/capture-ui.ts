import type { CaptureRequest } from './capture-request';
import type { CaptureFormat, CaptureSettings, UiLocale, UiTheme } from './types';
import { plural, t } from './i18n';
import { bindCaptureResultActions } from './capture-result';
import { CaptureHistorySession } from './history-client';
import { sendExtensionMessage } from './messaging';
import { formatBytes } from './format';
import { contentUiStyleTags } from './content-ui';
import { createHost, registerHostCleanup, removeHost } from './ui-host';

let currentPageZoom = 1;
let currentPreviewUpdate: (() => void) | null = null;

export interface CaptureRetry {
  request: CaptureRequest;
  settings: CaptureSettings;
  label: string;
  locale: UiLocale;
  theme: UiTheme;
}

export function showPreview({ image, blob, format, label, scale, failedImageCount, failedImageUrls, locale, theme, filename, historySession, retry, registerRetry, cancelRetry, initialCopyFailure, initialHistoryMessage }: {
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
  retry: CaptureRetry;
  registerRetry: (token: string, retry: CaptureRetry) => void;
  cancelRetry: (token: string) => void;
  initialCopyFailure?: boolean;
  initialHistoryMessage?: string;
}) {
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
    ${contentUiStyleTags('preview')}
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
  const historyControlCleanup = bindHistoryRetention(shadow, historySession, locale, initialHistoryMessage);
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
  const disposePreview = () => {
    if (retryToken) {
      cancelRetry(retryToken);
      void sendExtensionMessage({ type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION', token: retryToken }).catch(() => {});
    }
    resetTimers.forEach((timer) => window.clearTimeout(timer));
    resultActions.cleanup();
    historyControlCleanup();
    URL.revokeObjectURL(url);
    window.removeEventListener('message', onPermissionMessage);
  };
  const card = shadow.querySelector<HTMLElement>('.preview-card')!;
  const title = shadow.querySelector<HTMLElement>('.preview-title')!;
  const statusDot = shadow.querySelector<HTMLElement>('.status-dot')!;
  const permissionPanel = shadow.querySelector<HTMLElement>('.permission-panel')!;
  const permissionFrame = permissionPanel.querySelector<HTMLIFrameElement>('iframe')!;
  const closeButton = shadow.querySelector<HTMLButtonElement>('.close')!;
  const onPreviewKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !host.isConnected) return;
    event.preventDefault();
    event.stopPropagation();
    removeHost(host);
  };
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
  window.addEventListener('keydown', onPreviewKeyDown, true);
  registerHostCleanup(host, () => window.removeEventListener('keydown', onPreviewKeyDown, true));
  registerHostCleanup(host, disposePreview);
  closeButton.addEventListener('click', () => removeHost(host));
  const grantButton = shadow.querySelector<HTMLButtonElement>('.grant-images');
  grantButton?.addEventListener('click', async () => {
    retryToken ??= crypto.randomUUID();
    registerRetry(retryToken, retry);
    grantButton.disabled = true;
    grantButton.textContent = t(locale, 'preparingPermission');
    let failed = false;
    try {
      const response = await sendExtensionMessage({
        type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION',
        token: retryToken,
        origins: failedOrigins,
        locale,
        theme,
      });
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
    const response = await sendExtensionMessage({ type: 'DOMSHOT_OPEN_IMAGE_PERMISSION', token: retryToken });
    if (!response?.opened) showButtonState(openPermissionButton, t(locale, 'openFailed'), 'error', openPermissionLabel, t(locale, 'permissionWindowFailed'));
  });
  document.documentElement.appendChild(host);
  closeButton.focus({ preventScroll: true });
  if (initialCopyFailure) resultActions.showInitialCopyFailure();
}

function bindHistoryRetention(root: ParentNode, session: CaptureHistorySession, locale: UiLocale, initialMessage?: string): () => void {
  const status = root.querySelector<HTMLElement>('.history-retention-status')!;
  const button = root.querySelector<HTMLButtonElement>('.history-retention-toggle')!;
  let removedByUser = false;
  let message = initialMessage;
  let disposed = false;
  let busy = false;
  const render = () => {
    status.textContent = message ?? (session.saved
      ? `✓ ${t(locale, 'savedToRecent')}`
      : t(locale, removedByUser ? 'notKeptInRecent' : 'historyNotSaved'));
    button.textContent = session.saved
      ? t(locale, 'dontSaveThisCapture')
      : t(locale, removedByUser ? 'restoreHistorySave' : 'saveToRecent');
    button.dataset.state = session.saved ? 'remove' : 'save';
  };
  const refresh = async () => {
    if (disposed || busy) return;
    busy = true;
    button.disabled = true;
    try {
      await session.refresh();
      if (disposed) return;
      removedByUser = false;
      message = undefined;
      render();
    } catch {
      if (!disposed) status.textContent = t(locale, 'historyActionFailed');
    } finally {
      busy = false;
      if (!disposed) button.disabled = false;
    }
  };
  const toggle = async () => {
    if (disposed || busy) return;
    busy = true;
    button.disabled = true;
    try {
      await session.refresh();
      if (disposed) return;
      message = undefined;
      removedByUser = false;
      if (session.saved) {
        await session.remove();
        removedByUser = true;
      } else {
        await session.save();
        removedByUser = false;
      }
      message = undefined;
      render();
    } catch {
      if (!disposed) status.textContent = t(locale, 'historyActionFailed');
    } finally {
      busy = false;
      if (!disposed) button.disabled = false;
    }
  };
  const onFocus = () => void refresh();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  button.addEventListener('click', toggle);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  render();
  return () => {
    disposed = true;
    button.removeEventListener('click', toggle);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

type ToastAction = { label: string; run: () => Promise<string> };

export function historyToastAction(session: CaptureHistorySession, locale: UiLocale): ToastAction | undefined {
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

export function showProgress(label: string, locale: UiLocale, theme: UiTheme): HTMLElement {
  const host = createHost('progress', theme);
  host.shadowRoot!.innerHTML = `
    ${contentUiStyleTags('toast')}
    <div class="toast progress"><span class="spinner"></span><span><strong>${t(locale, 'generatingImage')}</strong><small>${escapeHtml(t(locale, 'doNotSwitch', { label }))}</small></span></div>`;
  document.documentElement.appendChild(host);
  return host;
}

export function showError(message: string, locale: UiLocale, theme: UiTheme) {
  const host = createHost('error', theme);
  host.shadowRoot!.innerHTML = `
    ${contentUiStyleTags('toast')}
    <div class="toast error"><span class="error-mark">!</span><span><strong>${t(locale, 'captureFailed')}</strong><small>${escapeHtml(t(locale, 'checkResources', { message }))}</small></span><button type="button">${t(locale, 'close')}</button></div>`;
  host.shadowRoot!.querySelector('button')!.addEventListener('click', () => removeHost(host));
  document.documentElement.appendChild(host);
}

export function showToast(message: string, theme: UiTheme, action?: ToastAction) {
  const host = createHost('toast', theme);
  host.shadowRoot!.innerHTML = `${contentUiStyleTags('toast')}<div class="toast compact"><strong>${escapeHtml(message)}</strong>${action ? `<button type="button">${escapeHtml(action.label)}</button>` : ''}</div>`;
  document.documentElement.appendChild(host);
  let timer = window.setTimeout(() => removeHost(host), action ? 4200 : 1800);
  registerHostCleanup(host, () => window.clearTimeout(timer));
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>('button');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    try {
      host.shadowRoot!.querySelector('strong')!.textContent = await action!.run();
      button.remove();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => removeHost(host), 1800);
    } catch { button.disabled = false; }
  });
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
  registerHostCleanup(host, () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    if (currentPreviewUpdate === update) currentPreviewUpdate = null;
  });
}

export function setPageZoom(pageZoom: number) {
  currentPageZoom = Number.isFinite(pageZoom) && pageZoom > 0 ? pageZoom : 1;
  currentPreviewUpdate?.();
}

function imageOrigins(urls: string[]) {
  return Array.from(new Set(urls.map((url) => {
    try {
      return new URL(url).origin;
    } catch { return ''; }
  }).filter(Boolean))).slice(0, 16);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
