export type CaptureFormat = 'png' | 'jpg' | 'webp';
export type PostCaptureAction = 'preview' | 'copy' | 'download';
export type ImageQuality = 0.8 | 0.92 | 1;
export type CaptureDelay = 0 | 500 | 1000 | 2000;
export type FilenameMode = 'smart' | 'page-title' | 'timestamp';
export type UiLocale = 'en' | 'zh-CN';
export type LanguagePreference = 'auto' | UiLocale;
export type UiTheme = 'light' | 'dark';
export type ThemePreference = 'auto' | UiTheme;

export interface CaptureHistoryItem {
  id: string;
  createdAt: number;
  label: string;
  filename: string;
  format: CaptureFormat;
  width: number;
  height: number;
  scale: number;
  size: number;
  sourceHost: string;
  thumbnailDataUrl: string;
}

export interface CaptureHistoryDetail extends CaptureHistoryItem {
  dataUrl: string;
}

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  quality: ImageQuality;
  afterCapture: PostCaptureAction;
  filenameMode: FilenameMode;
  saveRecentCaptures: boolean;
  captureDelay: CaptureDelay;
  embedFonts: boolean;
  reconcile: boolean;
  outerShadows: boolean;
  compress: boolean;
}

export const CONTENT_SCRIPT_PROTOCOL = 10;
export const BACKGROUND_PROTOCOL = 1;

export interface ResolvedImageResource {
  url: string;
  dataUrl?: string;
  reason?: 'permission' | 'fetch' | 'invalid';
}

export type ExtensionMessage =
  | { type: 'DOMSHOT_PING' }
  | { type: 'DOMSHOT_BACKGROUND_PING' }
  | { type: 'DOMSHOT_ZOOM_CHANGED'; pageZoom: number }
  | { type: 'DOMSHOT_SELECT'; settings: CaptureSettings; pageZoom: number; locale: UiLocale; theme: UiTheme }
  | { type: 'DOMSHOT_VISIBLE_AREA'; settings: CaptureSettings; pageZoom: number; locale: UiLocale; theme: UiTheme }
  | { type: 'DOMSHOT_FULL_PAGE'; settings: CaptureSettings; pageZoom: number; locale: UiLocale; theme: UiTheme }
  | { type: 'DOMSHOT_RESOLVE_IMAGES'; urls: string[] }
  | { type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION'; token: string; origins: string[]; locale: UiLocale; theme: UiTheme }
  | { type: 'DOMSHOT_OPEN_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_GET_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_RETRY_CAPTURE'; token: string }
  | { type: 'DOMSHOT_HISTORY_BEGIN'; capture: CaptureHistoryItem; mimeType: string; totalChunks: number }
  | { type: 'DOMSHOT_HISTORY_CHUNK'; id: string; index: number; data: string }
  | { type: 'DOMSHOT_HISTORY_COMMIT'; id: string }
  | { type: 'DOMSHOT_HISTORY_CANCEL'; id: string }
  | { type: 'DOMSHOT_HISTORY_LIST' }
  | { type: 'DOMSHOT_HISTORY_GET'; id: string }
  | { type: 'DOMSHOT_HISTORY_DELETE'; id: string }
  | { type: 'DOMSHOT_HISTORY_CLEAR' };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  quality: 0.92,
  afterCapture: 'preview',
  filenameMode: 'smart',
  saveRecentCaptures: false,
  captureDelay: 0,
  embedFonts: true,
  reconcile: false,
  outerShadows: false,
  compress: true,
};
