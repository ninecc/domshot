export type CaptureFormat = 'png' | 'jpg' | 'webp';

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  embedFonts: boolean;
}

export type ExtensionMessage =
  | { type: 'DOMSHOT_PING' }
  | { type: 'DOMSHOT_SELECT'; settings: CaptureSettings }
  | { type: 'DOMSHOT_FULL_PAGE'; settings: CaptureSettings };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  embedFonts: true,
};
