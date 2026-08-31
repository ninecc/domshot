import type { ExtensionMessage } from './types';
import type { UiLocale } from './types';
import { isUiLocale, localizeDocument, plural, resolveLocale, t } from './i18n';
import { applyDocumentTheme, isUiTheme, resolveTheme } from './theme';
import './permission.css';

const grantButton = document.querySelector<HTMLButtonElement>('#grantPermission')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancelPermission')!;
const status = document.querySelector<HTMLElement>('#permissionStatus')!;
const originList = document.querySelector<HTMLUListElement>('#originList')!;
const originCount = document.querySelector<HTMLElement>('#originCount')!;
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const inline = params.get('mode') === 'inline';
const requestedLocale = params.get('lang');
const locale: UiLocale = isUiLocale(requestedLocale) ? requestedLocale : resolveLocale('auto');
const requestedTheme = params.get('theme');
const theme = isUiTheme(requestedTheme) ? requestedTheme : resolveTheme('auto');
localizeDocument(locale);
applyDocumentTheme(theme);
document.documentElement.dataset.mode = inline ? 'inline' : 'window';
if (inline) cancelButton.textContent = t(locale, 'backCapture');
let patterns: string[] = [];

void loadRequest();

async function loadRequest() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'DOMSHOT_GET_IMAGE_PERMISSION', token } satisfies ExtensionMessage) as {
      ok?: boolean;
      origins?: string[];
      patterns?: string[];
    } | undefined;
    if (!response?.ok || !response.origins?.length || !response.patterns?.length) {
      showUnavailable(t(locale, 'requestExpired'));
      return;
    }
    patterns = response.patterns;
    originCount.textContent = plural(locale, 'originCountOne', 'originCountMany', response.origins.length);
    originList.replaceChildren(...response.origins.map(originItem));
    grantButton.disabled = false;
  } catch {
    showUnavailable(t(locale, 'requestReadFailed'));
  }
}

grantButton.addEventListener('click', async () => {
  if (!patterns.length) return;
  grantButton.disabled = true;
  cancelButton.disabled = true;
  grantButton.textContent = t(locale, 'waitingBrowser');
  status.textContent = '';
  try {
    const granted = await chrome.permissions.request({ origins: patterns });
    if (!granted) {
      status.textContent = t(locale, 'permissionDeclined');
      status.className = 'permission-status is-declined';
      grantButton.textContent = t(locale, 'retryPermission');
      grantButton.disabled = false;
      cancelButton.disabled = false;
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token } satisfies ExtensionMessage) as { retried?: boolean } | undefined;
    status.textContent = t(locale, result?.retried ? 'authorizedRetrying' : 'authorizedNavigated');
    status.className = result?.retried ? 'permission-status is-success' : 'permission-status is-declined';
    grantButton.textContent = t(locale, result?.retried ? 'recapturing' : 'authorized');
    if (result?.retried && !inline) window.setTimeout(() => window.close(), 900);
  } catch {
    status.textContent = t(locale, 'permissionIncomplete');
    status.className = 'permission-status is-declined';
    grantButton.textContent = t(locale, 'retryPermission');
    grantButton.disabled = false;
    cancelButton.disabled = false;
  }
});

cancelButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION', token } satisfies ExtensionMessage);
  if (inline) window.parent.postMessage({ type: 'DOMSHOT_PERMISSION_CANCEL' }, '*');
  else window.close();
});

function originItem(origin: string) {
  const item = document.createElement('li');
  const url = new URL(origin);
  item.innerHTML = `<span class="origin-icon" aria-hidden="true">IMG</span><span><strong>${escapeHtml(url.hostname)}</strong><small>${escapeHtml(url.protocol.replace(':', '').toUpperCase())}${url.port ? ` · ${escapeHtml(t(locale, 'port', { port: url.port }))}` : ''}</small></span>`;
  return item;
}

function showUnavailable(message: string) {
  status.textContent = message;
  status.className = 'permission-status is-declined';
  grantButton.disabled = true;
  originList.innerHTML = `<li class="empty">${escapeHtml(t(locale, 'noPendingOrigins'))}</li>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
