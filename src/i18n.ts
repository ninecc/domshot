import type { LanguagePreference, UiLocale } from './types';

export const LANGUAGE_STORAGE_KEY = 'uiLanguage';

const en = {
  homeAria: 'Capture options', openSettings: 'Open settings', openHistory: 'Open recent captures', introTitle: 'Capture any part of a webpage',
  introSubtitle: 'Keep the original styles, fonts, and layout', captureActions: 'Capture options',
  selectElement: 'Capture an element', selectElementDesc: 'Point to an element, then click to capture it',
  captureVisible: 'Capture visible area', captureVisibleDesc: 'Capture what’s visible in the current tab',
  capturePage: 'Capture full page', capturePageDesc: 'Capture the entire page', outputSettings: 'Output',
  currentScale: 'Scale: {scale}×', imageFormat: 'Image format', imageClarity: 'Resolution', lossyQuality: 'Image quality', settings: 'Settings',
  compactQuality: 'Compact', standardQuality: 'Standard', maximumQuality: 'Max',
  compactQualityLabel: 'Compact, 80% quality', standardQualityLabel: 'Standard, 92% quality', maximumQualityLabel: 'Maximum, 100% quality',
  backHome: 'Back to capture', generalSettings: 'General', language: 'Language', followBrowser: 'Auto',
  theme: 'Appearance', themeAuto: 'Auto', lightTheme: 'Light', darkTheme: 'Dark',
  afterCapture: 'After capture', showPreview: 'Preview', autoCopy: 'Copy', autoDownload: 'Download',
  filenameMode: 'File names', smartFilename: 'Smart', pageTitleFilename: 'Page title', timestampFilename: 'Timestamp',
  smartFilenameDesc: 'Uses the page title for full pages and the element name for selections.',
  pageTitleFilenameDesc: 'Always uses the current page title.', timestampFilenameDesc: 'Uses DOMShot with the capture date and time.',
  saveRecentCaptures: 'Automatically save captures to history', saveRecentCapturesDesc: 'Keep recent captures in this browser',
  chinese: '中文', english: 'English', advancedSettings: 'Advanced', autosave: 'Auto-saved',
  embedFonts: 'Embed web fonts', embedFontsDesc: 'Preserves custom fonts but takes longer',
  reconcile: 'Improve layout accuracy', reconcileDesc: 'Reduces text wrapping and layout shifts, but takes about twice as long',
  outerShadows: 'Include outer shadows', outerShadowsDesc: 'Captures shadows and outlines outside the selected element',
  compressImages: 'Optimize embedded images', compressImagesDesc: 'Resizes images to their displayed dimensions to reduce file size',
  captureDelay: 'Delay before capture', noDelay: '0s', noDelayLabel: 'No delay', halfSecond: '0.5s', oneSecond: '1s', twoSeconds: '2s',
  readyLocal: 'Ready · Processing stays on this device', thirdPartyLicenses: 'Third-party licenses',
  protectedPage: 'This page is protected by the browser and can’t be captured', scriptRefresh: 'DOMShot couldn’t connect to this page. Refresh it and try again.',
  openingViewfinder: 'Opening the element picker…', preparingVisible: 'Preparing visible-area capture…', preparingPage: 'Preparing full-page capture…', cannotRun: 'DOMShot can’t run on this page',
  visibleArea: 'Visible area', fullPage: 'Full page', generatingImage: 'Generating image', embeddingResources: 'Collecting styles and resources…',
  captureCanceled: 'Capture canceled', pageResourceFailed: 'Some page resources couldn’t be rendered', imageEncodeFailed: 'Couldn’t encode the image',
  captureComplete: 'Capture complete', capturePartial: 'Capture complete · Some images couldn’t be loaded', close: 'Close',
  previewAlt: '{label} capture preview', imageFailedOne: '1 image couldn’t be loaded and appears as a placeholder.',
  imageFailedMany: '{count} images couldn’t be loaded and appear as placeholders.', authorizeOriginOne: 'Allow 1 image source and retry',
  authorizeOriginMany: 'Allow {count} image sources and retry', imageSourcePermission: 'Image access request',
  openStandalone: 'Can’t see this? Open it in a separate window', copyImage: 'Copy image', downloadFormat: 'Download {format}',
  preparingPermission: 'Preparing access request…', permissionPrepareFailed: 'Couldn’t prepare the access request',
  authorizeImageSources: 'Allow image access', permissionLoadFailed: 'Couldn’t load the access request. Try again.',
  permissionWindowFailed: 'Couldn’t open the access window. Try again.', downloadStarted: 'Download started', copied: '✓ Copied',
  downloaded: '✓ Download started', copyFailed: 'Copy failed. Try again.', downloadFailed: 'Download failed. Try again.', permissionFailed: 'Couldn’t request access. Try again.', openFailed: 'Couldn’t open the window. Try again.',
  imageCopied: 'Image copied', convertedCopied: 'Converted to PNG and copied', clipboardDenied: 'Clipboard access was blocked by the browser',
  copyFallback: 'Automatic copy failed. Use the preview to copy or download the image.',
  pngConversionFailed: 'Couldn’t convert the image to PNG', doNotSwitch: '{label} · Keep this tab active', captureFailed: 'Capture failed',
  checkResources: '{message}. Check whether cross-origin images or fonts are blocked.', selectElementToolbar: 'Select an element',
  moveClick: 'Move the pointer to highlight an element · Click to capture', backgroundFailure: 'DOMShot couldn’t finish the request',
  permissionDocumentTitle: 'Allow image access · DOMShot', permissionBrand: 'DOMShot · Image access',
  permissionEyebrow: 'For images used in this capture', permissionHeading: 'Allow image access',
  permissionIntro: 'DOMShot needs access to the sites below to load images for this capture. Access remains available for future captures until you remove it in Chrome.',
  pendingOrigins: 'Sites that need access', originCountOne: '1 site', originCountMany: '{count} sites',
  privacyTitle: 'Your captures stay on this device', privacyBody: 'DOMShot does not upload captures. Image requests are made without cookies. Captures are stored in this browser only when capture history is enabled.',
  notNow: 'Not now', allowRetry: 'Allow and retry', backCapture: 'Back to capture', requestExpired: 'This access request expired. Return to the original page and capture again.',
  requestReadFailed: 'Couldn’t load this access request. Close this window and try again.', waitingBrowser: 'Waiting for browser approval…',
  permissionDeclined: 'Access wasn’t granted. You can keep the placeholders or allow access later.', retryPermission: 'Request access again',
  authorizedRetrying: 'Access granted. Retrying the capture in the original tab…', authorizedNavigated: 'Access granted, but the original tab was closed or navigated away.',
  recapturing: 'Retrying capture…', authorized: 'Access granted', permissionIncomplete: 'The access request didn’t finish. Try again.',
  port: 'Port {port}', noPendingOrigins: 'No image sources need access',
  recentCaptures: 'Recent captures', clearAll: 'Clear all', confirmClear: 'Clear now', confirmClearPrompt: 'Click again to clear all recent captures', historyLocal: 'Stored in this browser only', historySavingOff: 'New captures aren’t saved automatically · Existing captures stay here',
  noRecentCaptures: 'No recent captures', historyEmptyHint: 'New captures are saved here automatically, ready to copy or download again.',
  historyEmptyHintOff: 'New captures won’t be saved here automatically. You can still save one from its preview.', historyPreview: 'Capture preview',
  backHistory: 'Back to recent captures', previewCapture: 'Preview', downloadImage: 'Download', deleteCapture: 'Delete', historyLoadFailed: 'Couldn’t load recent captures',
  historyActionFailed: 'Couldn’t complete that action', captureDeletedUndo: 'Deleted “{label}”', undoDelete: 'Undo', captureRestored: 'Capture restored', historyCleared: 'Recent captures cleared',
  extensionReloadRequired: 'DOMShot was updated. Reload the extension and try again.',
  savedToRecent: 'Saved to capture history', dontSaveThisCapture: 'Remove from history', historyNotSaved: 'Not saved to capture history',
  notKeptInRecent: 'Removed from history · Copy and download are still available', restoreHistorySave: 'Save to history again', saveToRecent: 'Save to history',
  historySavingEnabled: 'New captures will be saved to history', historySavingDisabled: 'New captures won’t be saved to history · Existing captures stay here',
  historyPreferenceEnabled: 'New captures will be saved to history', historyPreferenceDisabledEmpty: 'No saved captures',
  historyPreferenceDisabledOne: '1 saved capture remains', historyPreferenceDisabledMany: '{count} saved captures remain',
  clearSavedCaptures: 'Clear', confirmClearSavedPrompt: 'Click again to clear all saved captures',
} as const;

type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  homeAria: '截图主页', openSettings: '打开设置', openHistory: '打开最近截图', introTitle: '精准截取网页内容', introSubtitle: '保留原有样式、字体与布局细节',
  captureActions: '截图操作', selectElement: '截取页面元素', selectElementDesc: '悬停选择元素，单击即可截图', capturePage: '截取完整页面',
  captureVisible: '截取可见区域', captureVisibleDesc: '截取当前标签页中的可见内容',
  capturePageDesc: '截取当前页面的全部内容', outputSettings: '输出设置', currentScale: '当前 {scale}×', imageFormat: '图片格式',
  imageClarity: '图片清晰度', lossyQuality: '图片质量', settings: '设置', backHome: '返回截图主页', generalSettings: '通用设置', language: '语言',
  theme: '外观', themeAuto: '自动', lightTheme: '浅色', darkTheme: '深色',
  compactQuality: '省空间', standardQuality: '标准', maximumQuality: '最高',
  compactQualityLabel: '省空间，80%', standardQualityLabel: '标准质量，92%', maximumQualityLabel: '最高质量，100%',
  afterCapture: '截图完成后', showPreview: '预览', autoCopy: '复制', autoDownload: '下载',
  filenameMode: '文件命名', smartFilename: '智能', pageTitleFilename: '页面标题', timestampFilename: '时间',
  smartFilenameDesc: '整页使用页面标题，元素使用元素名称。',
  pageTitleFilenameDesc: '始终使用当前页面标题。', timestampFilenameDesc: '使用 DOMShot 和截图时间。',
  saveRecentCaptures: '自动保存到截图历史', saveRecentCapturesDesc: '在此浏览器中保留截图历史，方便快速使用',
  followBrowser: '自动', chinese: '中文', english: 'English', advancedSettings: '高级设置', autosave: '自动保存',
  embedFonts: '嵌入网页字体', embedFontsDesc: '提升自定义字体还原度，处理时间更长', reconcile: '提升布局准确度',
  reconcileDesc: '减少换行和布局偏差，处理时间约翻倍', readyLocal: '准备就绪 · 图片仅在本地处理', thirdPartyLicenses: '第三方许可',
  outerShadows: '保留外层阴影', outerShadowsDesc: '保留根元素周围的阴影和轮廓',
  compressImages: '优化内嵌图片', compressImagesDesc: '按显示尺寸压缩图片，减小文件体积',
  captureDelay: '截图前等待', noDelay: '0s', noDelayLabel: '不等待', halfSecond: '0.5s', oneSecond: '1s', twoSeconds: '2s',
  protectedPage: '当前页面受浏览器保护，无法截图', scriptRefresh: 'DOMShot 无法连接到此页面，请刷新后重试',
  openingViewfinder: '正在打开元素选择器…', preparingVisible: '正在准备可见区域截图…', preparingPage: '正在准备整页截图…', cannotRun: '无法在当前页面运行', visibleArea: '可见区域', fullPage: '完整页面',
  generatingImage: '正在生成图片', embeddingResources: '正在收集样式与资源…', captureCanceled: '已取消截图',
  pageResourceFailed: '部分页面资源无法渲染', imageEncodeFailed: '无法编码图片', captureComplete: '截图完成',
  capturePartial: '截图完成 · 部分图片加载失败', close: '关闭', previewAlt: '{label} 的截图预览',
  imageFailedOne: '1 张图片加载失败，截图中已显示为占位内容。', imageFailedMany: '{count} 张图片加载失败，截图中已显示为占位内容。',
  authorizeOriginOne: '允许访问 1 个图片来源并重试', authorizeOriginMany: '允许访问 {count} 个图片来源并重试', imageSourcePermission: '图片访问权限',
  openStandalone: '无法显示？在独立窗口打开', copyImage: '复制图片', downloadFormat: '下载 {format}', preparingPermission: '正在准备访问请求…',
  permissionPrepareFailed: '无法准备访问请求', authorizeImageSources: '允许访问图片来源', permissionLoadFailed: '无法加载访问请求，请重试',
  permissionWindowFailed: '无法打开访问窗口，请重试', downloadStarted: '已开始下载', copied: '✓ 已复制', imageCopied: '图片已复制',
  downloaded: '✓ 已开始下载', copyFailed: '复制失败，请重试', downloadFailed: '下载失败，请重试', permissionFailed: '无法请求访问权限，请重试', openFailed: '打开失败，请重试',
  convertedCopied: '已转为 PNG 并复制', clipboardDenied: '浏览器阻止了剪贴板访问', copyFallback: '自动复制失败，请在预览中复制或下载图片。', pngConversionFailed: 'PNG 转换失败',
  doNotSwitch: '{label} · 请保持当前标签页处于活动状态', captureFailed: '截图失败', checkResources: '{message}。请检查跨域图片或字体是否被阻止。',
  selectElementToolbar: '选择一个页面元素', moveClick: '移动鼠标选择元素 · 单击截图', backgroundFailure: 'DOMShot 无法完成请求',
  permissionDocumentTitle: '允许访问图片 · DOMShot', permissionBrand: 'DOMShot · 图片访问', permissionEyebrow: '用于加载本次截图中的图片',
  permissionHeading: '允许访问图片', permissionIntro: 'DOMShot 需要访问以下网站，才能加载本次截图中的图片。访问权限会保留，直到你在 Chrome 中移除。',
  pendingOrigins: '需要访问的网站', originCountOne: '1 个网站', originCountMany: '{count} 个网站', privacyTitle: '截图不会上传',
  privacyBody: 'DOMShot 不会上传截图。读取图片时不会携带 Cookie。只有启用“最近截图”后，截图才会保存在此浏览器中。', notNow: '暂不授权', allowRetry: '允许并重新截图', backCapture: '返回截图',
  requestExpired: '访问请求已失效，请返回原页面重新截图。', requestReadFailed: '无法加载访问请求，请关闭窗口后重试。', waitingBrowser: '等待浏览器授权…',
  permissionDeclined: '未获得访问权限。你可以保留占位内容，或稍后再次授权。', retryPermission: '重新请求访问权限',
  authorizedRetrying: '已获得访问权限，正在原标签页重新截图…', authorizedNavigated: '已获得访问权限，但原标签页已关闭或跳转到其他页面。', recapturing: '正在重新截图',
  authorized: '已获得访问权限', permissionIncomplete: '访问请求未完成，请稍后重试。', port: '端口 {port}', noPendingOrigins: '没有需要访问的图片来源',
  recentCaptures: '最近截图', clearAll: '全部清空', confirmClear: '确认清空', confirmClearPrompt: '再次点击将清空全部最近截图', historyLocal: '仅保存在此浏览器', historySavingOff: '新截图不会自动保存到历史 · 已有截图仍会保留',
  noRecentCaptures: '暂无最近截图', historyEmptyHint: '新截图会自动保存到这里，方便再次复制或下载。',
  historyEmptyHintOff: '新截图不会自动保存到这里，你仍可在预览中单独保存。', historyPreview: '截图预览', backHistory: '返回最近截图',
  previewCapture: '预览', downloadImage: '下载', deleteCapture: '删除', historyLoadFailed: '无法加载最近截图', historyActionFailed: '无法完成此操作',
  captureDeletedUndo: '已删除“{label}”', undoDelete: '撤销', captureRestored: '截图已恢复', historyCleared: '最近截图已清空', extensionReloadRequired: 'DOMShot 已更新，请重新加载扩展后再试。',
  savedToRecent: '已保存到截图历史', dontSaveThisCapture: '从截图历史中移除', historyNotSaved: '未保存到截图历史',
  notKeptInRecent: '已从截图历史中移除 · 仍可复制或下载', restoreHistorySave: '重新保存到历史', saveToRecent: '保存到截图历史',
  historySavingEnabled: '新截图将自动保存到历史', historySavingDisabled: '新截图不会再保存到历史 · 已有截图保持不变',
  historyPreferenceEnabled: '新截图将自动保存到历史', historyPreferenceDisabledEmpty: '没有已保存截图',
  historyPreferenceDisabledOne: '已有 1 张截图仍保留', historyPreferenceDisabledMany: '已有 {count} 张截图仍保留',
  clearSavedCaptures: '清空', confirmClearSavedPrompt: '再次点击将清空全部已有截图',
};

const messages: Record<UiLocale, Record<MessageKey, string>> = { en, 'zh-CN': zh };

export function isUiLocale(value: unknown): value is UiLocale {
  return value === 'en' || value === 'zh-CN';
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || isUiLocale(value);
}

export function browserLanguage(): string {
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language;
  try { return chrome.i18n?.getUILanguage?.() || navigatorLanguage || 'en'; } catch { return navigatorLanguage || 'en'; }
}

export function resolveLocale(preference: LanguagePreference, detectedLanguage = browserLanguage()): UiLocale {
  if (isUiLocale(preference)) return preference;
  return detectedLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function t(locale: UiLocale, key: MessageKey, replacements: Record<string, string | number> = {}): string {
  return Object.entries(replacements).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), messages[locale][key]);
}

export function plural(locale: UiLocale, one: MessageKey, many: MessageKey, count: number): string {
  return t(locale, locale === 'en' && count === 1 ? one : many, { count });
}

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const stored = await chrome.storage?.sync?.get(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(stored?.[LANGUAGE_STORAGE_KEY]) ? stored[LANGUAGE_STORAGE_KEY] : 'auto';
  } catch { return 'auto'; }
}

export async function saveLanguagePreference(preference: LanguagePreference): Promise<void> {
  try { await chrome.storage?.sync?.set({ [LANGUAGE_STORAGE_KEY]: preference }); } catch { /* Storage is unavailable on standalone test pages. */ }
}

export function localizeDocument(locale: UiLocale, root: ParentNode = document): void {
  document.documentElement.lang = locale;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(locale, element.dataset.i18n as MessageKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(locale, element.dataset.i18nAriaLabel as MessageKey));
  });
}
