import { snapdom } from '@zumer/snapdom';
import type { SnapdomPlugin } from '@zumer/snapdom';
import type { CaptureSettings } from './types';
import { captureGeometry, captureTarget } from './capture-request';
import type { CaptureRequest } from './capture-request';
import { documentCapturePlugin } from './document-capture';
import { snapshotStylesPlugin } from './snapshot-styles';

export function renderCapture(request: CaptureRequest, settings: CaptureSettings, plugins: SnapdomPlugin[]) {
  const geometry = captureGeometry(request);
  return snapdom(captureTarget(request), {
    scale: settings.scale, dpr: 1, embedFonts: settings.embedFonts,
    reconcile: settings.reconcile, outerShadows: settings.outerShadows,
    compress: settings.compress, clip: geometry?.clip ?? null,
    backgroundColor: settings.format === 'png' ? undefined : '#ffffff',
    plugins: [snapshotStylesPlugin(), ...(geometry && request.kind !== 'element' ? [documentCapturePlugin(request.document, geometry)] : []), ...plugins],
  });
}
