export type CaptureFormat = 'png' | 'jpg' | 'webp';

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  embedFonts: boolean;
  reconcile: boolean;
}

export const CONTENT_SCRIPT_PROTOCOL = 3;

export interface ResolvedImageResource {
  url: string;
  dataUrl?: string;
  reason?: 'permission' | 'fetch' | 'invalid';
}

export type ExtensionMessage =
  | { type: 'DOMSHOT_PING' }
  | { type: 'DOMSHOT_ZOOM_CHANGED'; pageZoom: number }
  | { type: 'DOMSHOT_SELECT'; settings: CaptureSettings; pageZoom: number }
  | { type: 'DOMSHOT_FULL_PAGE'; settings: CaptureSettings; pageZoom: number }
  | { type: 'DOMSHOT_RESOLVE_IMAGES'; urls: string[] }
  | { type: 'DOMSHOT_PREPARE_IMAGE_PERMISSION'; token: string; origins: string[] }
  | { type: 'DOMSHOT_OPEN_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_GET_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_COMPLETE_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_CANCEL_IMAGE_PERMISSION'; token: string }
  | { type: 'DOMSHOT_RETRY_CAPTURE'; token: string };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  embedFonts: true,
  reconcile: false,
};
