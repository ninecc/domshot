export type CaptureFormat = 'png' | 'jpg' | 'webp';
export type PostCaptureAction = 'preview' | 'copy' | 'download';
export type ImageQuality = 0.8 | 0.92 | 1;
export type CaptureDelay = 0 | 500 | 1000 | 2000;
export type FilenameMode = 'smart' | 'page-title' | 'timestamp';
export type UiLocale = 'en' | 'zh-CN';
export type LanguagePreference = 'auto' | UiLocale;
export type UiTheme = 'light' | 'dark';
export type ThemePreference = 'auto' | UiTheme;

export const CAPTURE_HISTORY_POLICY = Object.freeze({
  maxItems: 10,
  maxCaptureBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  chunkBytes: 3 * 256 * 1024,
  undoMilliseconds: 5000,
});

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
  blob: Blob;
}

export interface CaptureHistoryTransfer extends CaptureHistoryItem {
  mimeType: string;
  byteLength: number;
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

export const CONTENT_SCRIPT_PROTOCOL = 13;
export const BACKGROUND_PROTOCOL = 3;

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
  | { type: 'DOMSHOT_HISTORY_READ'; id: string; offset: number; length: number }
  | { type: 'DOMSHOT_HISTORY_DELETE'; id: string }
  | { type: 'DOMSHOT_HISTORY_RESTORE'; id: string }
  | { type: 'DOMSHOT_HISTORY_CLEAR' };

export interface ExtensionResponseMap {
  DOMSHOT_PING: { ready: boolean; protocol: number };
  DOMSHOT_BACKGROUND_PING: { protocol: number };
  DOMSHOT_ZOOM_CHANGED: { updated: boolean };
  DOMSHOT_SELECT: { started: boolean };
  DOMSHOT_VISIBLE_AREA: { started: boolean };
  DOMSHOT_FULL_PAGE: { started: boolean };
  DOMSHOT_RESOLVE_IMAGES: { resources: ResolvedImageResource[] };
  DOMSHOT_PREPARE_IMAGE_PERMISSION: { prepared: boolean; frameUrl?: string };
  DOMSHOT_OPEN_IMAGE_PERMISSION: { opened: boolean };
  DOMSHOT_GET_IMAGE_PERMISSION: { ok: boolean; origins?: string[]; patterns?: string[] };
  DOMSHOT_COMPLETE_IMAGE_PERMISSION: { ok: boolean; retried: boolean };
  DOMSHOT_CANCEL_IMAGE_PERMISSION: { ok: boolean };
  DOMSHOT_RETRY_CAPTURE: { started: boolean };
  DOMSHOT_HISTORY_BEGIN: { ok: boolean };
  DOMSHOT_HISTORY_CHUNK: { ok: boolean };
  DOMSHOT_HISTORY_COMMIT: { ok: boolean };
  DOMSHOT_HISTORY_CANCEL: { ok: boolean };
  DOMSHOT_HISTORY_LIST: { captures: CaptureHistoryItem[] };
  DOMSHOT_HISTORY_GET: { capture: CaptureHistoryTransfer | null };
  DOMSHOT_HISTORY_READ: { data: string };
  DOMSHOT_HISTORY_DELETE: { ok: boolean };
  DOMSHOT_HISTORY_RESTORE: { ok: boolean };
  DOMSHOT_HISTORY_CLEAR: { ok: boolean };
}

export type ExtensionMessageType = ExtensionMessage['type'];
export type ExtensionMessageOf<T extends ExtensionMessageType> = Extract<ExtensionMessage, { type: T }>;
export type ExtensionResponse<T extends ExtensionMessageType> = ExtensionResponseMap[T];

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
