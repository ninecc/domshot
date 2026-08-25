export type CaptureFormat = 'png' | 'jpg' | 'webp';

export interface CaptureSettings {
  format: CaptureFormat;
  scale: 1 | 2 | 3;
  embedFonts: boolean;
}

export type ExtensionMessage =
  | { type: 'SNAPDOM_PING' }
  | { type: 'SNAPDOM_SELECT'; settings: CaptureSettings }
  | { type: 'SNAPDOM_FULL_PAGE'; settings: CaptureSettings };

export const DEFAULT_SETTINGS: CaptureSettings = {
  format: 'png',
  scale: 2,
  embedFonts: true,
};
