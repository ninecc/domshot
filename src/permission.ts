import type { UiLocale } from './types';
import { isUiLocale, localizeDocument, plural, resolveLocale, t } from './i18n';
import { applyDocumentTheme, isUiTheme, resolveTheme } from './theme';
import { sendExtensionMessage } from './messaging';
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
let accessGranted = false;

void loadRequest();

async function loadRequest() {
  try {
    const response = await sendExtensionMessage({ type: 'DOMSHOT_GET_IMAGE_PERMISSION', token });
    if (!response?.ok || !response.origins?.length || !response.patterns?.length) {
      showUnavailable(t(locale, 'requestExpired'));
      return;
    }
    patterns = response.patterns;
    if (typeof chrome.permissions.contains === 'function') {
      accessGranted = await chrome.permissions.contains({ origins: patterns }).catch(() => false);
    }
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
    const grantedNow = typeof chrome.permissions.contains === 'function'
      ? await chrome.permissions.contains({ origins: patterns }).catch(() => false)
      : accessGranted;
    const granted = grantedNow || await chrome.permissions.request({ origins: patterns });
    if (!granted) {
      accessGranted = false;
      status.textContent = t(locale, 'permissionDeclined');
      status.className = 'permission-status is-declined';
      grantButton.textContent = t(locale, 'retryPermission');
      grantButton.disabled = false;
      cancelButton.disabled = false;
      return;
    }
    accessGranted = true;
    const result = await sendExtensionMessage({ type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token });
    if (!result?.ok) {
      accessGranted = false;
      throw new Error(t(locale, 'permissionIncomplete'));
    }
    if (result.retryPending && result.reason === 'busy') {
      status.textContent = t(locale, 'permissionRetryBusy');
      status.className = 'permission-status is-declined';
      grantButton.textContent = t(locale, 'retryCapture');
      grantButton.disabled = false;
      cancelButton.disabled = false;
      return;
    }
    if (result.reason === 'expired') {
      cancelButton.disabled = false;
      showUnavailable(t(locale, 'requestExpired'));
      return;
    }
    if (result.reason === 'disconnected') {
      status.textContent = t(locale, 'authorizedNavigated');
      status.className = 'permission-status is-declined';
      grantButton.textContent = t(locale, 'authorized');
      cancelButton.disabled = false;
      if (inline) window.parent.postMessage({ type: 'DOMSHOT_PERMISSION_CANCEL' }, '*');
      return;
    }
    status.textContent = t(locale, result?.retried ? 'authorizedRetrying' : 'authorizedNavigated');
    status.className = result?.retried ? 'permission-status is-success' : 'permission-status is-declined';
    grantButton.textContent = t(locale, result?.retried ? 'recapturing' : 'authorized');
    if (result?.retried && !inline) window.setTimeout(() => window.close(), 900);
  } catch {
    accessGranted = false;
    status.textContent = t(locale, 'permissionIncomplete');
    status.className = 'permission-status is-declined';
    grantButton.textContent = t(locale, 'retryPermission');
    grantButton.disabled = false;
    cancelButton.disabled = false;
  }
});

cancelButton.addEventListener('click', async () => {
  await sendExtensionMessage({ type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION', token });
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
