export type CaptureFormat = 'png' | 'jpg' | 'webp';

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  embedFonts: boolean;
  reconcile: boolean;
}

export const CONTENT_SCRIPT_PROTOCOL = 3;

export type ExtensionMessage =
  | { type: 'DOMSHOT_PING' }
  | { type: 'DOMSHOT_ZOOM_CHANGED'; pageZoom: number }
  | { type: 'DOMSHOT_SELECT'; settings: CaptureSettings; pageZoom: number }
  | { type: 'DOMSHOT_FULL_PAGE'; settings: CaptureSettings; pageZoom: number };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  embedFonts: true,
  reconcile: false,
};
