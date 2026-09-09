import { t } from './i18n';
import type { CaptureFormat, UiLocale } from './types';

const DOWNLOAD_URL_REVOKE_DELAY = 30_000;

export interface CaptureResultAsset {
  blob: Blob;
  format: CaptureFormat;
  filename: string;
}

export interface CaptureResultActions {
  cleanup(): void;
  showInitialCopyFailure(): void;
}

export function bindCaptureResultActions(root: ParentNode, options: {
  locale: UiLocale;
  loadAsset: () => Promise<CaptureResultAsset>;
  announce?: (message: string) => void;
}): CaptureResultActions {
  const copyButton = root.querySelector<HTMLButtonElement>('[data-capture-action="copy"]')!;
  const downloadButton = root.querySelector<HTMLButtonElement>('[data-capture-action="download"]')!;
  const liveRegion = root.querySelector<HTMLElement>('.action-status');
  const resetTimers = new Map<HTMLButtonElement, number>();
  const copyLabel = copyButton.textContent || t(options.locale, 'copyImage');
  const downloadLabel = downloadButton.textContent || t(options.locale, 'downloadImage');

  const announce = (message: string) => {
    if (liveRegion) liveRegion.textContent = message;
    options.announce?.(message);
  };
  const showButtonState = (button: HTMLButtonElement, text: string, state: 'success' | 'error', resetText: string, announcement = text) => {
    const currentTimer = resetTimers.get(button);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    button.classList.toggle('is-success', state === 'success');
    button.classList.toggle('is-error', state === 'error');
    button.textContent = text;
    announce(announcement);
    const timer = window.setTimeout(() => {
      button.classList.remove('is-success', 'is-error');
      button.textContent = resetText;
      if (liveRegion?.textContent === announcement) liveRegion.textContent = '';
      resetTimers.delete(button);
    }, 1800);
    resetTimers.set(button, timer);
  };

  const onCopy = async () => {
    copyButton.disabled = true;
    try {
      const announcement = await copyCaptureResult(await options.loadAsset(), options.locale);
      showButtonState(copyButton, t(options.locale, 'copied'), 'success', copyLabel, announcement);
    } catch {
      showButtonState(copyButton, t(options.locale, 'copyFailed'), 'error', copyLabel, t(options.locale, 'clipboardDenied'));
    } finally { copyButton.disabled = false; }
  };
  const onDownload = async () => {
    downloadButton.disabled = true;
    try {
      downloadCaptureResult(await options.loadAsset());
      showButtonState(downloadButton, t(options.locale, 'downloaded'), 'success', downloadLabel, t(options.locale, 'downloadStarted'));
    } catch {
      showButtonState(downloadButton, t(options.locale, 'downloadFailed'), 'error', downloadLabel);
    } finally { downloadButton.disabled = false; }
  };
  copyButton.addEventListener('click', onCopy);
  downloadButton.addEventListener('click', onDownload);

  return {
    cleanup() {
      copyButton.removeEventListener('click', onCopy);
      downloadButton.removeEventListener('click', onDownload);
      resetTimers.forEach((timer) => window.clearTimeout(timer));
    },
    showInitialCopyFailure() {
      showButtonState(copyButton, t(options.locale, 'copyFailed'), 'error', copyLabel, t(options.locale, 'copyFallback'));
    },
  };
}

export async function copyCaptureResult(asset: CaptureResultAsset, locale: UiLocale): Promise<string> {
  const png = asset.format === 'png' ? asset.blob : await convertToPng(asset.blob, locale);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return t(locale, asset.format === 'png' ? 'imageCopied' : 'convertedCopied');
}

export function downloadCaptureResult(asset: CaptureResultAsset): void {
  const url = URL.createObjectURL(asset.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = asset.filename;
  anchor.click();
  // Chrome may pick up a synthetic download asynchronously. Keep the URL alive
  // for a bounded grace period, then always release its backing Blob.
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY);
}

async function convertToPng(blob: Blob, locale: UiLocale): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((png) => png ? resolve(png) : reject(new Error(t(locale, 'pngConversionFailed'))), 'image/png'));
}
