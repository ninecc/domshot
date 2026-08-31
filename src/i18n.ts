import type { LanguagePreference, UiLocale } from './types';

export const LANGUAGE_STORAGE_KEY = 'uiLanguage';

const en = {
  homeAria: 'Capture home', openSettings: 'Open settings', introTitle: 'Capture web content precisely',
  introSubtitle: 'Preserve original styles, fonts, and layout details', captureActions: 'Capture actions',
  selectElement: 'Capture page element', selectElementDesc: 'Hover to select an element, then click to capture',
  captureVisible: 'Capture visible area', captureVisibleDesc: 'Save what is currently visible in the viewport',
  capturePage: 'Capture full page', capturePageDesc: 'Save all content on the current page', outputSettings: 'Output',
  currentScale: 'Current {scale}×', imageFormat: 'Image format', imageClarity: 'Resolution', lossyQuality: 'File quality', settings: 'Settings',
  compactQuality: 'Compact', standardQuality: 'Standard', maximumQuality: 'Max',
  compactQualityLabel: 'Compact quality, 80%', standardQualityLabel: 'Standard quality, 92%', maximumQualityLabel: 'Maximum quality, 100%',
  backHome: 'Back to capture home', generalSettings: 'General', language: 'Language', followBrowser: 'Auto',
  afterCapture: 'After capture', showPreview: 'Preview', autoCopy: 'Copy', autoDownload: 'Download',
  filenameMode: 'File names', smartFilename: 'Smart', pageTitleFilename: 'Page title', timestampFilename: 'Timestamp',
  smartFilenameDesc: 'Full pages use the page title; elements use their label.',
  pageTitleFilenameDesc: 'Always uses the current page title.', timestampFilenameDesc: 'Uses DOMShot and the capture time.',
  chinese: '中文', english: 'English', advancedSettings: 'Advanced', autosave: 'Auto-saved',
  embedFonts: 'Embed web fonts', embedFontsDesc: 'Improves custom font fidelity but takes longer',
  reconcile: 'Precise layout calibration', reconcileDesc: 'More accurate layouts, about 2× slower',
  outerShadows: 'Keep outer shadows', outerShadowsDesc: 'Includes shadows and outlines around the root element',
  compressImages: 'Optimize embedded images', compressImagesDesc: 'Downsamples images to their displayed size',
  captureDelay: 'Capture delay', noDelay: 'None', halfSecond: '0.5s', oneSecond: '1s', twoSeconds: '2s',
  readyLocal: 'Ready · Images are processed locally', thirdPartyLicenses: 'Third-party licenses',
  protectedPage: 'This browser-protected page cannot be captured', scriptRefresh: 'DOMShot could not update on this page. Refresh the page and try again.',
  openingViewfinder: 'Opening the viewfinder…', preparingVisible: 'Preparing the visible area…', preparingPage: 'Preparing the full page…', cannotRun: 'DOMShot cannot run on this page',
  visibleArea: 'Visible area', fullPage: 'Full page', generatingImage: 'Generating image', embeddingResources: 'Embedding styles and resources…',
  captureCanceled: 'Capture canceled', pageResourceFailed: 'Page resources could not be converted to an image', imageEncodeFailed: 'Image encoding failed',
  captureComplete: 'Capture complete', capturePartial: 'Capture complete, but some images failed to load', close: 'Close',
  previewAlt: 'Capture preview of {label}', imageFailedOne: '1 image failed to load and is shown as a placeholder.',
  imageFailedMany: '{count} images failed to load and are shown as placeholders.', authorizeOriginOne: 'Authorize 1 image source and retry',
  authorizeOriginMany: 'Authorize {count} image sources and retry', imageSourcePermission: 'Image source permission',
  openStandalone: 'Not visible? Open in a separate window', copyImage: 'Copy image', downloadFormat: 'Download {format}',
  preparingPermission: 'Preparing permission…', permissionPrepareFailed: 'Permission content could not be prepared',
  authorizeImageSources: 'Authorize image sources', permissionLoadFailed: 'Could not load permission content. Try again.',
  permissionWindowFailed: 'Could not open the permission window. Try again.', downloadStarted: 'Download started', copied: '✓ Copied',
  downloaded: '✓ Download started', copyFailed: 'Copy failed, retry', downloadFailed: 'Download failed, retry', permissionFailed: 'Permission failed, retry', openFailed: 'Open failed, retry',
  imageCopied: 'Image copied', convertedCopied: 'Converted to PNG and copied', clipboardDenied: 'The browser denied clipboard access',
  copyFallback: 'Automatic copy failed. Use the preview to copy or download the image.',
  pngConversionFailed: 'PNG conversion failed', doNotSwitch: '{label} · Keep this page active', captureFailed: 'Capture failed',
  checkResources: '{message}. Check cross-origin images or fonts.', selectElementToolbar: 'Select a page element',
  moveClick: 'Move the pointer to locate · Click to capture', backgroundFailure: 'Background processing failed',
  permissionDocumentTitle: 'Allow image sources · DOMShot', permissionBrand: 'DOMShot · Image access',
  permissionEyebrow: 'Only for sources needed by this capture', permissionHeading: 'Allow cross-origin images',
  permissionIntro: 'The browser blocked the image sources below. Once allowed, DOMShot will read them locally and retry the capture.',
  pendingOrigins: 'Sources awaiting permission', originCountOne: '1 source', originCountMany: '{count} sources',
  privacyTitle: 'Images are never uploaded', privacyBody: 'Login cookies are not sent, and image content or browsing history is not stored.',
  notNow: 'Not now', allowRetry: 'Allow and retry', backCapture: 'Back to capture', requestExpired: 'This permission request expired. Return to the original page and capture again.',
  requestReadFailed: 'Could not read the permission request. Close this window and try again.', waitingBrowser: 'Waiting for browser confirmation…',
  permissionDeclined: 'Not allowed. The current capture can still use placeholders; you can allow access later.', retryPermission: 'Try again',
  authorizedRetrying: 'Allowed. Retrying the capture on the original page…', authorizedNavigated: 'Allowed, but the original page was closed or navigated away.',
  recapturing: 'Retrying capture', authorized: 'Allowed', permissionIncomplete: 'The permission request did not complete. Try again later.',
  port: 'Port {port}', noPendingOrigins: 'No image sources are waiting for permission',
} as const;

type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  homeAria: '截图主页', openSettings: '打开设置', introTitle: '精确捕获网页内容', introSubtitle: '保留原有样式、字体与布局细节',
  captureActions: '截图操作', selectElement: '截取页面元素', selectElementDesc: '悬停选择元素，单击即可截图', capturePage: '截取完整页面',
  captureVisible: '截取可见区域', captureVisibleDesc: '保存当前视口中可见的页面内容',
  capturePageDesc: '保存当前页面的全部内容', outputSettings: '输出设置', currentScale: '当前 {scale}×', imageFormat: '图片格式',
  imageClarity: '图片清晰度', lossyQuality: '图片质量', settings: '设置', backHome: '返回截图主页', generalSettings: '通用设置', language: '语言',
  compactQuality: '省空间', standardQuality: '标准', maximumQuality: '最高',
  compactQualityLabel: '省空间，80%', standardQualityLabel: '标准质量，92%', maximumQualityLabel: '最高质量，100%',
  afterCapture: '截图完成后', showPreview: '预览', autoCopy: '复制', autoDownload: '下载',
  filenameMode: '文件命名', smartFilename: '智能', pageTitleFilename: '页面标题', timestampFilename: '时间',
  smartFilenameDesc: '整页使用页面标题，元素使用元素名称。',
  pageTitleFilenameDesc: '始终使用当前页面标题。', timestampFilenameDesc: '使用 DOMShot 和截图时间。',
  followBrowser: '自动', chinese: '中文', english: 'English', advancedSettings: '高级设置', autosave: '自动保存',
  embedFonts: '嵌入网页字体', embedFontsDesc: '提升自定义字体还原度，处理时间更长', reconcile: '精确布局校准',
  reconcileDesc: '减少换行和布局偏差，处理时间约翻倍', readyLocal: '准备就绪 · 图片仅在本地处理', thirdPartyLicenses: '第三方许可',
  outerShadows: '保留外层阴影', outerShadowsDesc: '保留根元素周围的阴影和轮廓',
  compressImages: '优化内嵌图片', compressImagesDesc: '按显示尺寸压缩图片，减小文件体积',
  captureDelay: '截图前等待', noDelay: '不等待', halfSecond: '0.5秒', oneSecond: '1秒', twoSeconds: '2秒',
  protectedPage: '当前页面受浏览器保护，无法截图', scriptRefresh: '页面中的 DOMShot 脚本未能更新，请刷新页面后重试',
  openingViewfinder: '正在打开取景器…', preparingVisible: '正在准备可见区域…', preparingPage: '正在准备整个页面…', cannotRun: '无法在当前页面运行', visibleArea: '可见区域', fullPage: '完整页面',
  generatingImage: '正在生成图片', embeddingResources: '正在嵌入样式与资源…', captureCanceled: '已取消截图',
  pageResourceFailed: '页面资源无法转换为图片', imageEncodeFailed: '图片编码失败', captureComplete: '截图完成',
  capturePartial: '截图完成，但部分图片加载失败', close: '关闭', previewAlt: '{label} 的截图预览',
  imageFailedOne: '1 张图片加载失败，截图中已显示为占位内容。', imageFailedMany: '{count} 张图片加载失败，截图中已显示为占位内容。',
  authorizeOriginOne: '授权 1 个图片来源并重试', authorizeOriginMany: '授权 {count} 个图片来源并重试', imageSourcePermission: '图片来源授权',
  openStandalone: '无法显示？在独立窗口打开', copyImage: '复制图片', downloadFormat: '下载 {format}', preparingPermission: '正在准备授权…',
  permissionPrepareFailed: '授权内容未能准备', authorizeImageSources: '授权图片来源', permissionLoadFailed: '无法加载授权内容，请重试',
  permissionWindowFailed: '无法打开授权窗口，请重试', downloadStarted: '已开始下载', copied: '✓ 已复制', imageCopied: '图片已复制',
  downloaded: '✓ 已开始下载', copyFailed: '复制失败，请重试', downloadFailed: '下载失败，请重试', permissionFailed: '授权失败，请重试', openFailed: '打开失败，请重试',
  convertedCopied: '已转为 PNG 并复制', clipboardDenied: '浏览器未允许访问剪贴板', copyFallback: '自动复制失败，请在预览中复制或下载图片。', pngConversionFailed: 'PNG 转换失败',
  doNotSwitch: '{label} · 请勿切换页面', captureFailed: '截图失败', checkResources: '{message}。请检查跨域图片或字体。',
  selectElementToolbar: '选择一个页面元素', moveClick: '移动鼠标定位 · 单击完成捕获', backgroundFailure: '后台处理失败',
  permissionDocumentTitle: '允许加载图片来源 · DOMShot', permissionBrand: 'DOMShot · 图片访问', permissionEyebrow: '仅用于本次截图所需来源',
  permissionHeading: '允许加载跨域图片', permissionIntro: '浏览器阻止了以下图片来源。授权后，DOMShot 会在本机读取图片并立即重新截图。',
  pendingOrigins: '待授权来源', originCountOne: '1 个', originCountMany: '{count} 个', privacyTitle: '图片不会上传',
  privacyBody: '不携带登录 Cookie，不保存图片内容或浏览记录。', notNow: '暂不授权', allowRetry: '允许并重新截图', backCapture: '返回截图',
  requestExpired: '授权请求已失效，请返回原页面重新截图。', requestReadFailed: '无法读取授权请求，请关闭窗口后重试。', waitingBrowser: '等待浏览器确认…',
  permissionDeclined: '未授权。当前截图仍可使用占位内容；需要时可以再次授权。', retryPermission: '再次授权',
  authorizedRetrying: '已授权，正在原页面重新截图…', authorizedNavigated: '已授权，但原页面已关闭或发生了跳转。', recapturing: '正在重新截图',
  authorized: '已授权', permissionIncomplete: '权限请求未完成，请稍后再次尝试。', port: '端口 {port}', noPendingOrigins: '没有待处理的图片来源',
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
