import type { CaptureSettings, ExtensionMessage } from './types';
import { CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import './popup.css';

const status = document.querySelector<HTMLElement>('#status')!;
const pixelHint = document.querySelector<HTMLElement>('#pixelHint')!;
const selectButton = document.querySelector<HTMLButtonElement>('#selectElement')!;
const pageButton = document.querySelector<HTMLButtonElement>('#capturePage')!;
const embedFonts = document.querySelector<HTMLInputElement>('#embedFonts')!;
const reconcile = document.querySelector<HTMLInputElement>('#reconcile')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settingsButton')!;
const advancedSettings = document.querySelector<HTMLElement>('#advancedSettings')!;

function chosen<T extends string>(name: string): T {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value as T;
}

function readSettings(): CaptureSettings {
  return {
    format: chosen<CaptureSettings['format']>('format'),
    scale: Number(chosen('scale')) as CaptureSettings['scale'],
    embedFonts: embedFonts.checked,
    reconcile: reconcile.checked,
  };
}

function applySettings(settings: CaptureSettings) {
  const format = document.querySelector<HTMLInputElement>(`input[name="format"][value="${settings.format}"]`);
  const scale = document.querySelector<HTMLInputElement>(`input[name="scale"][value="${settings.scale}"]`);
  if (format) format.checked = true;
  if (scale) scale.checked = true;
  embedFonts.checked = settings.embedFonts;
  reconcile.checked = settings.reconcile;
  pixelHint.textContent = `${settings.scale}× 清晰度`;
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || /^(chrome|edge|about|view-source):/.test(tab.url)) {
    throw new Error('当前页面受浏览器保护，无法截图');
  }
  return tab;
}

async function ensureContentScript(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'DOMSHOT_PING' } satisfies ExtensionMessage) as { protocol?: number } | undefined;
    if (response?.protocol === CONTENT_SCRIPT_PROTOCOL) return;
  } catch { /* Inject below when no current content script responds. */ }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const response = await chrome.tabs.sendMessage(tabId, { type: 'DOMSHOT_PING' } satisfies ExtensionMessage) as { protocol?: number } | undefined;
  if (response?.protocol !== CONTENT_SCRIPT_PROTOCOL) throw new Error('页面中的 DOMShot 脚本未能更新，请刷新页面后重试');
}

async function begin(type: 'DOMSHOT_SELECT' | 'DOMSHOT_FULL_PAGE') {
  const button = type === 'DOMSHOT_SELECT' ? selectButton : pageButton;
  const settings = readSettings();
  button.disabled = true;
  status.textContent = type === 'DOMSHOT_SELECT' ? '正在打开取景器…' : '正在准备整个页面…';

  try {
    await chrome.storage.sync.set({ captureSettings: settings });
    const tab = await getActiveTab();
    const pageZoom = await chrome.tabs.getZoom(tab.id!);
    await ensureContentScript(tab.id!);
    await chrome.tabs.sendMessage(tab.id!, { type, settings, pageZoom } satisfies ExtensionMessage);
    window.close();
  } catch (error) {
    button.disabled = false;
    status.textContent = error instanceof Error ? error.message : '无法在当前页面运行';
    status.classList.add('is-error');
  }
}

document.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
  input.addEventListener('change', async () => {
    const settings = readSettings();
    pixelHint.textContent = `${settings.scale}× 清晰度`;
    await chrome.storage.sync.set({ captureSettings: settings });
  });
});

selectButton.addEventListener('click', () => void begin('DOMSHOT_SELECT'));
pageButton.addEventListener('click', () => void begin('DOMSHOT_FULL_PAGE'));
settingsButton.addEventListener('click', () => {
  const opening = advancedSettings.hidden;
  advancedSettings.hidden = !opening;
  settingsButton.setAttribute('aria-expanded', String(opening));
  settingsButton.setAttribute('aria-label', opening ? '关闭高级设置' : '打开高级设置');
});

chrome.storage.sync.get('captureSettings').then(({ captureSettings }) => {
  applySettings({ ...DEFAULT_SETTINGS, ...(captureSettings ?? {}) });
});
