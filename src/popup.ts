import type { CaptureSettings, ExtensionMessage } from './types';
import { CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import type { LanguagePreference, UiLocale } from './types';
import { loadLanguagePreference, localizeDocument, resolveLocale, saveLanguagePreference, t } from './i18n';
import './popup.css';

const status = document.querySelector<HTMLElement>('#status')!;
const pixelHint = document.querySelector<HTMLElement>('#pixelHint')!;
const selectButton = document.querySelector<HTMLButtonElement>('#selectElement')!;
const pageButton = document.querySelector<HTMLButtonElement>('#capturePage')!;
const embedFonts = document.querySelector<HTMLInputElement>('#embedFonts')!;
const reconcile = document.querySelector<HTMLInputElement>('#reconcile')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settingsButton')!;
const backButton = document.querySelector<HTMLButtonElement>('#backButton')!;
const homePanel = document.querySelector<HTMLElement>('#homePanel')!;
const settingsPanel = document.querySelector<HTMLElement>('#settingsPanel')!;
let activeLocale: UiLocale = resolveLocale('auto');

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

function readLanguagePreference(): LanguagePreference {
  return chosen<LanguagePreference>('language');
}

function applySettings(settings: CaptureSettings) {
  const format = document.querySelector<HTMLInputElement>(`input[name="format"][value="${settings.format}"]`);
  const scale = document.querySelector<HTMLInputElement>(`input[name="scale"][value="${settings.scale}"]`);
  if (format) format.checked = true;
  if (scale) scale.checked = true;
  embedFonts.checked = settings.embedFonts;
  reconcile.checked = settings.reconcile;
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: settings.scale });
}

function applyLanguagePreference(preference: LanguagePreference) {
  const input = document.querySelector<HTMLInputElement>(`input[name="language"][value="${preference}"]`);
  if (input) input.checked = true;
  activeLocale = resolveLocale(preference);
  localizeDocument(activeLocale);
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: readSettings().scale });
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || /^(chrome|edge|about|view-source):/.test(tab.url)) {
    throw new Error(t(activeLocale, 'protectedPage'));
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
  if (response?.protocol !== CONTENT_SCRIPT_PROTOCOL) throw new Error(t(activeLocale, 'scriptRefresh'));
}

async function begin(type: 'DOMSHOT_SELECT' | 'DOMSHOT_FULL_PAGE') {
  const button = type === 'DOMSHOT_SELECT' ? selectButton : pageButton;
  const settings = readSettings();
  button.disabled = true;
  status.textContent = t(activeLocale, type === 'DOMSHOT_SELECT' ? 'openingViewfinder' : 'preparingPage');

  try {
    await chrome.storage.sync.set({ captureSettings: settings });
    const tab = await getActiveTab();
    const pageZoom = await chrome.tabs.getZoom(tab.id!);
    await ensureContentScript(tab.id!);
    await chrome.tabs.sendMessage(tab.id!, { type, settings, pageZoom, locale: activeLocale } satisfies ExtensionMessage);
    window.close();
  } catch (error) {
    button.disabled = false;
    status.textContent = error instanceof Error ? error.message : t(activeLocale, 'cannotRun');
    status.classList.add('is-error');
  }
}

document.querySelectorAll<HTMLInputElement>('input:not([name="language"])').forEach((input) => {
  input.addEventListener('change', async () => {
    const settings = readSettings();
    pixelHint.textContent = t(activeLocale, 'currentScale', { scale: settings.scale });
    await chrome.storage.sync.set({ captureSettings: settings });
  });
});

document.querySelectorAll<HTMLInputElement>('input[name="language"]').forEach((input) => {
  input.addEventListener('change', () => {
    const preference = readLanguagePreference();
    applyLanguagePreference(preference);
    void saveLanguagePreference(preference);
  });
});

selectButton.addEventListener('click', () => void begin('DOMSHOT_SELECT'));
pageButton.addEventListener('click', () => void begin('DOMSHOT_FULL_PAGE'));
settingsButton.addEventListener('click', () => {
  homePanel.hidden = true;
  settingsPanel.hidden = false;
  requestAnimationFrame(() => backButton.focus());
});
backButton.addEventListener('click', () => {
  settingsPanel.hidden = true;
  homePanel.hidden = false;
  requestAnimationFrame(() => settingsButton.focus());
});

void Promise.all([
  chrome.storage.sync.get('captureSettings').catch(() => ({})),
  loadLanguagePreference(),
]).then(([stored, languagePreference]) => {
  const captureSettings = (stored as Record<string, unknown>).captureSettings as Partial<CaptureSettings> | undefined;
  applyLanguagePreference(languagePreference);
  applySettings({ ...DEFAULT_SETTINGS, ...(captureSettings ?? {}) });
});
