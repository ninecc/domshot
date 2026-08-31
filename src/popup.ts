import type { CaptureSettings, ExtensionMessage } from './types';
import { CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import type { LanguagePreference, UiLocale } from './types';
import { loadLanguagePreference, localizeDocument, resolveLocale, saveLanguagePreference, t } from './i18n';
import type { ThemePreference, UiTheme } from './types';
import { applyDocumentTheme, loadThemePreference, resolveTheme, saveThemePreference } from './theme';
import './popup.css';

const status = document.querySelector<HTMLElement>('#status')!;
const pixelHint = document.querySelector<HTMLElement>('#pixelHint')!;
const qualityRow = document.querySelector<HTMLElement>('#qualityRow')!;
const filenameHint = document.querySelector<HTMLElement>('#filenameHint')!;
const selectButton = document.querySelector<HTMLButtonElement>('#selectElement')!;
const visibleButton = document.querySelector<HTMLButtonElement>('#captureVisible')!;
const pageButton = document.querySelector<HTMLButtonElement>('#capturePage')!;
const embedFonts = document.querySelector<HTMLInputElement>('#embedFonts')!;
const reconcile = document.querySelector<HTMLInputElement>('#reconcile')!;
const outerShadows = document.querySelector<HTMLInputElement>('#outerShadows')!;
const compressImages = document.querySelector<HTMLInputElement>('#compressImages')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settingsButton')!;
const backButton = document.querySelector<HTMLButtonElement>('#backButton')!;
const homePanel = document.querySelector<HTMLElement>('#homePanel')!;
const settingsPanel = document.querySelector<HTMLElement>('#settingsPanel')!;
let activeLocale: UiLocale = resolveLocale('auto');
let activeTheme: UiTheme = resolveTheme('auto');

function chosen<T extends string>(name: string): T {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value as T;
}

function readSettings(): CaptureSettings {
  return {
    format: chosen<CaptureSettings['format']>('format'),
    scale: Number(chosen('scale')) as CaptureSettings['scale'],
    quality: Number(chosen('quality')) as CaptureSettings['quality'],
    afterCapture: chosen<CaptureSettings['afterCapture']>('afterCapture'),
    filenameMode: chosen<CaptureSettings['filenameMode']>('filenameMode'),
    captureDelay: Number(chosen('captureDelay')) as CaptureSettings['captureDelay'],
    embedFonts: embedFonts.checked,
    reconcile: reconcile.checked,
    outerShadows: outerShadows.checked,
    compress: compressImages.checked,
  };
}

function readLanguagePreference(): LanguagePreference {
  return chosen<LanguagePreference>('language');
}

function readThemePreference(): ThemePreference {
  return chosen<ThemePreference>('theme');
}

function applySettings(settings: CaptureSettings) {
  const format = document.querySelector<HTMLInputElement>(`input[name="format"][value="${settings.format}"]`);
  const scale = document.querySelector<HTMLInputElement>(`input[name="scale"][value="${settings.scale}"]`);
  const quality = document.querySelector<HTMLInputElement>(`input[name="quality"][value="${settings.quality}"]`);
  const afterCapture = document.querySelector<HTMLInputElement>(`input[name="afterCapture"][value="${settings.afterCapture}"]`);
  const filenameMode = document.querySelector<HTMLInputElement>(`input[name="filenameMode"][value="${settings.filenameMode}"]`);
  const captureDelay = document.querySelector<HTMLInputElement>(`input[name="captureDelay"][value="${settings.captureDelay}"]`);
  if (format) format.checked = true;
  if (scale) scale.checked = true;
  if (quality) quality.checked = true;
  if (afterCapture) afterCapture.checked = true;
  if (filenameMode) filenameMode.checked = true;
  if (captureDelay) captureDelay.checked = true;
  embedFonts.checked = settings.embedFonts;
  reconcile.checked = settings.reconcile;
  outerShadows.checked = settings.outerShadows;
  compressImages.checked = settings.compress;
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: settings.scale });
  updateFormatDependentSettings(settings.format);
  updateFilenameHint(settings.filenameMode);
}

function updateFormatDependentSettings(format: CaptureSettings['format']) {
  qualityRow.hidden = format === 'png';
}

function updateFilenameHint(mode: CaptureSettings['filenameMode']) {
  const key = mode === 'page-title' ? 'pageTitleFilenameDesc' : mode === 'timestamp' ? 'timestampFilenameDesc' : 'smartFilenameDesc';
  filenameHint.textContent = t(activeLocale, key);
}

function applyLanguagePreference(preference: LanguagePreference) {
  const input = document.querySelector<HTMLInputElement>(`input[name="language"][value="${preference}"]`);
  if (input) input.checked = true;
  activeLocale = resolveLocale(preference);
  localizeDocument(activeLocale);
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: readSettings().scale });
  updateFilenameHint(readSettings().filenameMode);
}

function applyThemePreference(preference: ThemePreference) {
  const input = document.querySelector<HTMLInputElement>(`input[name="theme"][value="${preference}"]`);
  if (input) input.checked = true;
  activeTheme = resolveTheme(preference);
  applyDocumentTheme(activeTheme);
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

async function begin(type: 'DOMSHOT_SELECT' | 'DOMSHOT_VISIBLE_AREA' | 'DOMSHOT_FULL_PAGE') {
  const button = type === 'DOMSHOT_SELECT' ? selectButton : type === 'DOMSHOT_VISIBLE_AREA' ? visibleButton : pageButton;
  const settings = readSettings();
  button.disabled = true;
  status.textContent = t(activeLocale, type === 'DOMSHOT_SELECT' ? 'openingViewfinder' : type === 'DOMSHOT_VISIBLE_AREA' ? 'preparingVisible' : 'preparingPage');

  try {
    await chrome.storage.sync.set({ captureSettings: settings });
    const tab = await getActiveTab();
    const pageZoom = await chrome.tabs.getZoom(tab.id!);
    await ensureContentScript(tab.id!);
    await chrome.tabs.sendMessage(tab.id!, { type, settings, pageZoom, locale: activeLocale, theme: activeTheme } satisfies ExtensionMessage);
    window.close();
  } catch (error) {
    button.disabled = false;
    status.textContent = error instanceof Error ? error.message : t(activeLocale, 'cannotRun');
    status.classList.add('is-error');
  }
}

document.querySelectorAll<HTMLInputElement>('input:not([name="language"]):not([name="theme"])').forEach((input) => {
  input.addEventListener('change', async () => {
    const settings = readSettings();
    pixelHint.textContent = t(activeLocale, 'currentScale', { scale: settings.scale });
    updateFormatDependentSettings(settings.format);
    updateFilenameHint(settings.filenameMode);
    await chrome.storage.sync.set({ captureSettings: settings });
  });
});

document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((input) => {
  input.addEventListener('change', () => {
    const preference = readThemePreference();
    applyThemePreference(preference);
    void saveThemePreference(preference);
  });
});

try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readThemePreference() === 'auto') applyThemePreference('auto');
  });
} catch { /* Older Chrome versions can still apply the theme when the popup reopens. */ }

document.querySelectorAll<HTMLInputElement>('input[name="language"]').forEach((input) => {
  input.addEventListener('change', () => {
    const preference = readLanguagePreference();
    applyLanguagePreference(preference);
    void saveLanguagePreference(preference);
  });
});

selectButton.addEventListener('click', () => void begin('DOMSHOT_SELECT'));
visibleButton.addEventListener('click', () => void begin('DOMSHOT_VISIBLE_AREA'));
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
  loadThemePreference(),
]).then(([stored, languagePreference, themePreference]) => {
  const captureSettings = (stored as Record<string, unknown>).captureSettings as Partial<CaptureSettings> | undefined;
  applyLanguagePreference(languagePreference);
  applyThemePreference(themePreference);
  applySettings({ ...DEFAULT_SETTINGS, ...(captureSettings ?? {}) });
});
