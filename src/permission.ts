import type { ExtensionMessage } from './types';
import './permission.css';

const grantButton = document.querySelector<HTMLButtonElement>('#grantPermission')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancelPermission')!;
const status = document.querySelector<HTMLElement>('#permissionStatus')!;
const originList = document.querySelector<HTMLUListElement>('#originList')!;
const originCount = document.querySelector<HTMLElement>('#originCount')!;
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const inline = params.get('mode') === 'inline';
document.documentElement.dataset.mode = inline ? 'inline' : 'window';
if (inline) cancelButton.textContent = '返回截图';
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
      showUnavailable('授权请求已失效，请返回原页面重新截图。');
      return;
    }
    patterns = response.patterns;
    originCount.textContent = `${response.origins.length} 个`;
    originList.replaceChildren(...response.origins.map(originItem));
    grantButton.disabled = false;
  } catch {
    showUnavailable('无法读取授权请求，请关闭窗口后重试。');
  }
}

grantButton.addEventListener('click', async () => {
  if (!patterns.length) return;
  grantButton.disabled = true;
  cancelButton.disabled = true;
  grantButton.textContent = '等待浏览器确认…';
  status.textContent = '';
  try {
    const granted = await chrome.permissions.request({ origins: patterns });
    if (!granted) {
      status.textContent = '未授权。当前截图仍可使用占位内容；需要时可以再次授权。';
      status.className = 'permission-status is-declined';
      grantButton.textContent = '再次授权';
      grantButton.disabled = false;
      cancelButton.disabled = false;
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION', token } satisfies ExtensionMessage) as { retried?: boolean } | undefined;
    status.textContent = result?.retried ? '已授权，正在原页面重新截图…' : '已授权，但原页面已关闭或发生了跳转。';
    status.className = result?.retried ? 'permission-status is-success' : 'permission-status is-declined';
    grantButton.textContent = result?.retried ? '正在重新截图' : '已授权';
    if (result?.retried && !inline) window.setTimeout(() => window.close(), 900);
  } catch {
    status.textContent = '权限请求未完成，请稍后再次尝试。';
    status.className = 'permission-status is-declined';
    grantButton.textContent = '再次授权';
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
  item.innerHTML = `<span class="origin-icon" aria-hidden="true">IMG</span><span><strong>${escapeHtml(url.hostname)}</strong><small>${escapeHtml(url.protocol.replace(':', '').toUpperCase())}${url.port ? ` · 端口 ${escapeHtml(url.port)}` : ''}</small></span>`;
  return item;
}

function showUnavailable(message: string) {
  status.textContent = message;
  status.className = 'permission-status is-declined';
  grantButton.disabled = true;
  originList.innerHTML = '<li class="empty">没有待处理的图片来源</li>';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
