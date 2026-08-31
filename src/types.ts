export type CaptureFormat = 'png' | 'jpg' | 'webp';
export type PostCaptureAction = 'preview' | 'copy' | 'download';
export type ImageQuality = 0.8 | 0.92 | 1;
export type CaptureDelay = 0 | 500 | 1000 | 2000;
export type FilenameMode = 'smart' | 'page-title' | 'timestamp';
export type UiLocale = 'en' | 'zh-CN';
export type LanguagePreference = 'auto' | UiLocale;
export type UiTheme = 'light' | 'dark';
export type ThemePreference = 'auto' | UiTheme;

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  quality: ImageQuality;
  afterCapture: PostCaptureAction;
  filenameMode: FilenameMode;
  captureDelay: CaptureDelay;
  embedFonts: boolean;
  reconcile: boolean;
  outerShadows: boolean;
  compress: boolean;
}

export const CONTENT_SCRIPT_PROTOCOL = 8;

export interface ResolvedImageResource {
  url: string;
  dataUrl?: string;
  reason?: 'permission' | 'fetch' | 'invalid';
}

export type ExtensionMessage =
  | { type: 'DOMSHOT_PING' }
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
  | { type: 'DOMSHOT_RETRY_CAPTURE'; token: string };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  quality: 0.92,
  afterCapture: 'preview',
  filenameMode: 'smart',
  captureDelay: 0,
  embedFonts: true,
  reconcile: false,
  outerShadows: false,
  compress: true,
};
