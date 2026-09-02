import type { CaptureHistoryDetail, CaptureHistoryItem, CaptureSettings, ExtensionMessage } from './types';
import { BACKGROUND_PROTOCOL, CAPTURE_HISTORY_POLICY, CONTENT_SCRIPT_PROTOCOL, DEFAULT_SETTINGS } from './types';
import type { LanguagePreference, UiLocale } from './types';
import { loadLanguagePreference, localizeDocument, plural, resolveLocale, saveLanguagePreference, t } from './i18n';
import type { ThemePreference, UiTheme } from './types';
import { applyDocumentTheme, loadThemePreference, resolveTheme, saveThemePreference } from './theme';
import { bindCaptureResultActions } from './capture-result';
import type { CaptureResultActions, CaptureResultAsset } from './capture-result';
import { clearCaptureHistory, deleteCaptureHistory, getCaptureHistory, listCaptureHistory, restoreCaptureHistory } from './history-client';
import { sendExtensionMessage } from './messaging';
import { formatBytes } from './format';
import './popup.css';

const status = document.querySelector<HTMLElement>('#status')!;
const pixelHint = document.querySelector<HTMLElement>('#pixelHint')!;
const qualityRow = document.querySelector<HTMLElement>('#qualityRow')!;
const filenameHint = document.querySelector<HTMLElement>('#filenameHint')!;
const saveRecentCaptures = document.querySelector<HTMLInputElement>('#saveRecentCaptures')!;
const selectButton = document.querySelector<HTMLButtonElement>('#selectElement')!;
const visibleButton = document.querySelector<HTMLButtonElement>('#captureVisible')!;
const pageButton = document.querySelector<HTMLButtonElement>('#capturePage')!;
const embedFonts = document.querySelector<HTMLInputElement>('#embedFonts')!;
const reconcile = document.querySelector<HTMLInputElement>('#reconcile')!;
const outerShadows = document.querySelector<HTMLInputElement>('#outerShadows')!;
const compressImages = document.querySelector<HTMLInputElement>('#compressImages')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settingsButton')!;
const historyButton = document.querySelector<HTMLButtonElement>('#historyButton')!;
const historyBadge = document.querySelector<HTMLElement>('#historyBadge')!;
const backButton = document.querySelector<HTMLButtonElement>('#backButton')!;
const historyBackButton = document.querySelector<HTMLButtonElement>('#historyBackButton')!;
const homePanel = document.querySelector<HTMLElement>('#homePanel')!;
const settingsPanel = document.querySelector<HTMLElement>('#settingsPanel')!;
const historyPanel = document.querySelector<HTMLElement>('#historyPanel')!;
const historyList = document.querySelector<HTMLElement>('#historyList')!;
const historyEmpty = document.querySelector<HTMLElement>('#historyEmpty')!;
const historyEmptyHint = document.querySelector<HTMLElement>('#historyEmptyHint')!;
const historyStorageStatus = document.querySelector<HTMLElement>('#historyStorageStatus')!;
const historyCount = document.querySelector<HTMLElement>('#historyCount')!;
const clearHistoryButton = document.querySelector<HTMLButtonElement>('#clearHistoryButton')!;
const historyDetail = document.querySelector<HTMLElement>('#historyDetail')!;
const detailBackButton = document.querySelector<HTMLButtonElement>('#detailBackButton')!;
const detailImage = document.querySelector<HTMLImageElement>('#detailImage')!;
const detailTitle = document.querySelector<HTMLElement>('#detailTitle')!;
const detailMeta = document.querySelector<HTMLElement>('#detailMeta')!;
const detailDeleteButton = document.querySelector<HTMLButtonElement>('#detailDeleteButton')!;
const historyPreferenceStatus = document.querySelector<HTMLElement>('#historyPreferenceStatus')!;
const historyPreferenceMessage = document.querySelector<HTMLElement>('#historyPreferenceMessage')!;
const clearSavedCaptures = document.querySelector<HTMLButtonElement>('#clearSavedCaptures')!;
let activeLocale: UiLocale = resolveLocale('auto');
let activeTheme: UiTheme = resolveTheme('auto');
let captures: CaptureHistoryItem[] = [];
let activeCapture: CaptureHistoryDetail | null = null;
let activeCaptureUrl: string | null = null;
let clearConfirmation: { button: HTMLButtonElement; idleLabel: string; prompt: string; timer: number } | null = null;
let historyUndoToast: HTMLElement | null = null;
let historyUndoTimer: number | undefined;
let historyActionCleanups: Array<() => void> = [];
let detailResultActions: CaptureResultActions | null = null;

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
    saveRecentCaptures: saveRecentCaptures.checked,
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
  saveRecentCaptures.checked = settings.saveRecentCaptures;
  embedFonts.checked = settings.embedFonts;
  reconcile.checked = settings.reconcile;
  outerShadows.checked = settings.outerShadows;
  compressImages.checked = settings.compress;
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: settings.scale });
  updateFormatDependentSettings(settings.format);
  updateFilenameHint(settings.filenameMode);
  updateHistoryPreferenceCopy();
}

function updateFormatDependentSettings(format: CaptureSettings['format']) {
  qualityRow.hidden = format === 'png';
}

function updateFilenameHint(mode: CaptureSettings['filenameMode']) {
  const key = mode === 'page-title' ? 'pageTitleFilenameDesc' : mode === 'timestamp' ? 'timestampFilenameDesc' : 'smartFilenameDesc';
  filenameHint.textContent = t(activeLocale, key);
}

function updateHistoryPreferenceCopy() {
  historyStorageStatus.textContent = t(activeLocale, saveRecentCaptures.checked ? 'historyLocal' : 'historySavingOff');
  historyEmptyHint.textContent = t(activeLocale, saveRecentCaptures.checked ? 'historyEmptyHint' : 'historyEmptyHintOff');
  updateHistoryPreferenceStatus();
}

function updateHistoryPreferenceStatus() {
  const enabled = saveRecentCaptures.checked;
  const hasCaptures = captures.length > 0;
  historyPreferenceStatus.dataset.state = enabled ? 'enabled' : hasCaptures ? 'disabled-with-captures' : 'disabled-empty';
  historyPreferenceMessage.textContent = enabled
    ? t(activeLocale, 'historyPreferenceEnabled')
    : hasCaptures
      ? plural(activeLocale, 'historyPreferenceDisabledOne', 'historyPreferenceDisabledMany', captures.length)
      : t(activeLocale, 'historyPreferenceDisabledEmpty');
  clearSavedCaptures.hidden = enabled || !hasCaptures;
  if (clearSavedCaptures.hidden && clearConfirmation?.button === clearSavedCaptures) resetClearConfirmation();
}

function applyLanguagePreference(preference: LanguagePreference) {
  const input = document.querySelector<HTMLInputElement>(`input[name="language"][value="${preference}"]`);
  if (input) input.checked = true;
  activeLocale = resolveLocale(preference);
  localizeDocument(activeLocale);
  pixelHint.textContent = t(activeLocale, 'currentScale', { scale: readSettings().scale });
  updateFilenameHint(readSettings().filenameMode);
  updateHistoryPreferenceCopy();
}

function applyThemePreference(preference: ThemePreference) {
  const input = document.querySelector<HTMLInputElement>(`input[name="theme"][value="${preference}"]`);
  if (input) input.checked = true;
  activeTheme = resolveTheme(preference);
  applyDocumentTheme(activeTheme);
}

async function loadHistory(showFailure = true) {
  try {
    await ensureBackgroundReady();
    captures = await listCaptureHistory();
    renderHistory();
  } catch (error) {
    if (showFailure) status.textContent = error instanceof Error ? error.message : t(activeLocale, 'historyLoadFailed');
  }
}

async function ensureBackgroundReady() {
  const response = await sendExtensionMessage({ type: 'DOMSHOT_BACKGROUND_PING' }).catch(() => null);
  if (response?.protocol !== BACKGROUND_PROTOCOL) throw new Error(t(activeLocale, 'extensionReloadRequired'));
}

function renderHistory() {
  historyActionCleanups.forEach((cleanup) => cleanup());
  historyActionCleanups = [];
  historyList.replaceChildren();
  historyCount.textContent = `${captures.length} / ${CAPTURE_HISTORY_POLICY.maxItems}`;
  historyBadge.textContent = String(captures.length);
  historyBadge.hidden = captures.length === 0;
  historyEmpty.hidden = captures.length !== 0;
  clearHistoryButton.hidden = captures.length === 0;
  for (const capture of captures) historyList.append(createHistoryCard(capture));
  updateHistoryPreferenceStatus();
}

function createHistoryCard(capture: CaptureHistoryItem): HTMLElement {
  const card = document.createElement('article');
  card.className = 'history-card';
  const preview = document.createElement('button');
  preview.className = 'history-thumb';
  preview.type = 'button';
  preview.setAttribute('aria-label', t(activeLocale, 'previewAlt', { label: capture.label }));
  const image = document.createElement('img');
  image.src = capture.thumbnailDataUrl;
  image.alt = '';
  const format = document.createElement('span');
  format.className = 'history-format';
  format.textContent = capture.format.toUpperCase();
  const previewCue = document.createElement('span');
  previewCue.className = 'history-preview-cue';
  previewCue.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.3-5.2 9.2-5.2 9.2 5.2 9.2 5.2-3.3 5.2-9.2 5.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.4"/></svg>';
  previewCue.append(document.createTextNode(t(activeLocale, 'previewCapture')));
  preview.append(image, format, previewCue);
  preview.addEventListener('click', () => void openHistoryDetail(capture.id));

  const copy = document.createElement('button');
  copy.className = 'history-copy'; copy.type = 'button'; copy.dataset.captureAction = 'copy'; copy.textContent = t(activeLocale, 'copyImage');
  const download = document.createElement('button');
  download.className = 'history-download'; download.type = 'button'; download.dataset.captureAction = 'download'; download.textContent = t(activeLocale, 'downloadImage');
  const remove = document.createElement('button');
  remove.className = 'history-delete'; remove.type = 'button';
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.8h6V7m-8 0 .7 12h8.6L17 7M10 10.5v5M14 10.5v5"/></svg>';
  remove.setAttribute('aria-label', t(activeLocale, 'deleteCapture'));
  remove.addEventListener('click', () => void deleteCapture(capture.id));

  const copyBlock = document.createElement('div');
  copyBlock.className = 'history-card-copy';
  const title = document.createElement('strong'); title.textContent = capture.label;
  const source = document.createElement('small'); source.textContent = capture.sourceHost || capture.format.toUpperCase();
  const meta = document.createElement('span');
  meta.textContent = `${formatHistoryDate(capture.createdAt)} · ${capture.width} × ${capture.height} · ${formatBytes(capture.size)}`;
  const actions = document.createElement('div'); actions.className = 'history-card-actions'; actions.append(copy, download);
  copyBlock.append(title, source, meta, actions);
  card.append(preview, copyBlock, remove);
  const resultActions = bindCaptureResultActions(card, {
    locale: activeLocale,
    loadAsset: () => loadHistoryAsset(capture.id),
    announce: (message) => { status.textContent = message; },
  });
  historyActionCleanups.push(() => resultActions.cleanup());
  return card;
}

async function withHistoryDetail(id: string, action: (detail: CaptureHistoryDetail) => Promise<void>) {
  try {
    const capture = await getCaptureHistory(id);
    if (!capture) throw new Error(t(activeLocale, 'historyActionFailed'));
    await action(capture);
  } catch { status.textContent = t(activeLocale, 'historyActionFailed'); }
}

async function openHistoryDetail(id: string) {
  await withHistoryDetail(id, async (capture) => {
    closeHistoryDetail();
    activeCapture = capture;
    activeCaptureUrl = URL.createObjectURL(capture.blob);
    detailImage.src = activeCaptureUrl;
    detailImage.alt = t(activeLocale, 'previewAlt', { label: capture.label });
    detailTitle.textContent = capture.label;
    detailMeta.textContent = `${capture.width} × ${capture.height} · ${capture.format.toUpperCase()} · ${formatBytes(capture.size)}`;
    detailResultActions?.cleanup();
    detailResultActions = bindCaptureResultActions(historyDetail, {
      locale: activeLocale,
      loadAsset: () => captureDetailAsset(capture),
      announce: (message) => { status.textContent = message; },
    });
    historyDetail.hidden = false;
    requestAnimationFrame(() => detailBackButton.focus());
  });
}

async function deleteCapture(id: string) {
  const label = captures.find((capture) => capture.id === id)?.label ?? activeCapture?.label ?? t(activeLocale, 'recentCaptures');
  try { await deleteCaptureHistory(id); } catch { status.textContent = t(activeLocale, 'historyActionFailed'); return; }
  captures = captures.filter((capture) => capture.id !== id);
  if (activeCapture?.id === id) closeHistoryDetail();
  renderHistory();
  showHistoryUndo(id, label);
}

function closeHistoryDetail() {
  detailResultActions?.cleanup();
  detailResultActions = null;
  historyDetail.hidden = true;
  detailImage.removeAttribute('src');
  if (activeCaptureUrl) URL.revokeObjectURL(activeCaptureUrl);
  activeCaptureUrl = null;
  activeCapture = null;
}

function resetClearConfirmation(restoreStatus = true) {
  const current = clearConfirmation;
  if (!current) return;
  window.clearTimeout(current.timer);
  delete current.button.dataset.confirm;
  current.button.textContent = current.idleLabel;
  current.button.removeAttribute('aria-label');
  clearConfirmation = null;
  if (restoreStatus && status.textContent === current.prompt) {
    status.textContent = t(activeLocale, 'readyLocal');
  }
}

function beginClearConfirmation(button: HTMLButtonElement, idleLabel: string, prompt: string) {
  resetClearConfirmation(false);
  button.dataset.confirm = 'true';
  button.textContent = t(activeLocale, 'confirmClear');
  button.setAttribute('aria-label', prompt);
  status.textContent = prompt;
  clearConfirmation = { button, idleLabel, prompt, timer: window.setTimeout(() => resetClearConfirmation(), 3000) };
}

function requestClearHistory(button: HTMLButtonElement, idleLabel: string, prompt: string) {
  if (clearConfirmation?.button !== button || button.dataset.confirm !== 'true') {
    beginClearConfirmation(button, idleLabel, prompt);
    return;
  }
  resetClearConfirmation(false);
  dismissHistoryUndo();
  button.disabled = true;
  void clearCaptureHistory().then(() => {
    captures = [];
    closeHistoryDetail();
    renderHistory();
    status.textContent = t(activeLocale, 'historyCleared');
  }, () => { status.textContent = t(activeLocale, 'historyActionFailed'); })
    .finally(() => { button.disabled = false; });
}

function showHistoryUndo(id: string, label: string) {
  dismissHistoryUndo();
  const toast = document.createElement('div');
  toast.className = 'history-undo-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  const message = document.createElement('span');
  message.textContent = t(activeLocale, 'captureDeletedUndo', { label });
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = t(activeLocale, 'undoDelete');
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    try {
      await restoreCaptureHistory(id);
      await loadHistory(false);
      dismissHistoryUndo();
      status.textContent = t(activeLocale, 'captureRestored');
    } catch {
      undo.disabled = false;
      status.textContent = t(activeLocale, 'historyActionFailed');
    }
  });
  toast.append(message, undo);
  document.querySelector('.shell')!.append(toast);
  historyUndoToast = toast;
  historyUndoTimer = window.setTimeout(dismissHistoryUndo, Math.max(0, CAPTURE_HISTORY_POLICY.undoMilliseconds - 500));
  undo.focus();
}

function dismissHistoryUndo() {
  window.clearTimeout(historyUndoTimer);
  historyUndoTimer = undefined;
  historyUndoToast?.remove();
  historyUndoToast = null;
}

async function loadHistoryAsset(id: string): Promise<CaptureResultAsset> {
  const capture = await getCaptureHistory(id);
  if (!capture) throw new Error('Capture no longer exists');
  return captureDetailAsset(capture);
}

async function captureDetailAsset(capture: CaptureHistoryDetail): Promise<CaptureResultAsset> {
  return { blob: capture.blob, format: capture.format, filename: capture.filename };
}

function formatHistoryDate(value: number) {
  return new Intl.DateTimeFormat(activeLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
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
    await ensureBackgroundReady();
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
    updateHistoryPreferenceCopy();
    await chrome.storage.sync.set({ captureSettings: settings });
    if (input === saveRecentCaptures) {
      status.textContent = t(activeLocale, settings.saveRecentCaptures ? 'historySavingEnabled' : 'historySavingDisabled');
      if (!settings.saveRecentCaptures) await loadHistory(false);
      updateHistoryPreferenceStatus();
    }
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
historyButton.addEventListener('click', () => {
  homePanel.hidden = true;
  historyPanel.hidden = false;
  closeHistoryDetail();
  void loadHistory();
  requestAnimationFrame(() => historyBackButton.focus());
});
historyBackButton.addEventListener('click', () => {
  resetClearConfirmation();
  historyPanel.hidden = true;
  homePanel.hidden = false;
  requestAnimationFrame(() => historyButton.focus());
});
detailBackButton.addEventListener('click', () => {
  closeHistoryDetail();
  requestAnimationFrame(() => historyBackButton.focus());
});
detailDeleteButton.addEventListener('click', () => { if (activeCapture) void deleteCapture(activeCapture.id); });
clearHistoryButton.addEventListener('click', () => {
  requestClearHistory(clearHistoryButton, t(activeLocale, 'clearAll'), t(activeLocale, 'confirmClearPrompt'));
});
clearSavedCaptures.addEventListener('click', () => {
  requestClearHistory(clearSavedCaptures, t(activeLocale, 'clearSavedCaptures'), t(activeLocale, 'confirmClearSavedPrompt'));
});
document.addEventListener('pointerdown', (event) => {
  if (clearConfirmation && event.target instanceof Node && !clearConfirmation.button.contains(event.target)) {
    resetClearConfirmation();
  }
});
backButton.addEventListener('click', () => {
  resetClearConfirmation();
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
  void loadHistory(false);
});
