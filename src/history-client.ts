import type { CaptureHistoryDetail, CaptureHistoryItem, ExtensionMessage } from './types';
import { CAPTURE_HISTORY_POLICY } from './types';
import { sendExtensionMessage } from './messaging';

export type NewCaptureHistoryItem = Omit<CaptureHistoryItem, 'id'> & { blob: Blob };

export class CaptureHistorySession {
  private captureId: string | null = null;

  constructor(private readonly capture: NewCaptureHistoryItem) {}

  get id(): string | null { return this.captureId; }
  get saved(): boolean { return this.captureId !== null; }

  async save(): Promise<void> {
    if (this.captureId) return;
    const id = historyCaptureId();
    await uploadCaptureHistory(id, this.capture);
    this.captureId = id;
  }

  async remove(): Promise<void> {
    if (!this.captureId) return;
    const id = this.captureId;
    await deleteCaptureHistory(id);
    this.captureId = null;
  }
}

export async function listCaptureHistory(): Promise<CaptureHistoryItem[]> {
  const response = await sendExtensionMessage({ type: 'DOMSHOT_HISTORY_LIST' });
  return response.captures;
}

export async function getCaptureHistory(id: string): Promise<CaptureHistoryDetail | null> {
  const response = await sendExtensionMessage({ type: 'DOMSHOT_HISTORY_GET', id });
  if (!response.capture) return null;
  const { mimeType, byteLength, ...metadata } = response.capture;
  if (byteLength !== metadata.size || byteLength > CAPTURE_HISTORY_POLICY.maxCaptureBytes) throw new Error('Capture history data is invalid');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < byteLength; offset += CAPTURE_HISTORY_POLICY.chunkBytes) {
    const chunk = await sendExtensionMessage({
      type: 'DOMSHOT_HISTORY_READ',
      id,
      offset,
      length: Math.min(CAPTURE_HISTORY_POLICY.chunkBytes, byteLength - offset),
    });
    chunks.push(base64ToBytes(chunk.data));
  }
  return { ...metadata, blob: new Blob(chunks as BlobPart[], { type: mimeType }) };
}

export async function deleteCaptureHistory(id: string): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_DELETE', id });
}

export async function restoreCaptureHistory(id: string): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_RESTORE', id });
}

export async function clearCaptureHistory(): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_CLEAR' });
}

async function uploadCaptureHistory(id: string, capture: NewCaptureHistoryItem): Promise<void> {
  const { blob, ...metadata } = capture;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const item: CaptureHistoryItem = { ...metadata, id };
  try {
    await expectOk({ type: 'DOMSHOT_HISTORY_BEGIN', capture: item, mimeType: blob.type, totalChunks: Math.max(1, Math.ceil(bytes.length / CAPTURE_HISTORY_POLICY.chunkBytes)) });
    for (let offset = 0, index = 0; offset < bytes.length || index === 0; offset += CAPTURE_HISTORY_POLICY.chunkBytes, index += 1) {
      await expectOk({ type: 'DOMSHOT_HISTORY_CHUNK', id, index, data: bytesToBase64(bytes.subarray(offset, offset + CAPTURE_HISTORY_POLICY.chunkBytes)) });
    }
    await expectOk({ type: 'DOMSHOT_HISTORY_COMMIT', id });
  } catch (error) {
    void sendExtensionMessage({ type: 'DOMSHOT_HISTORY_CANCEL', id }).catch(() => {});
    throw error;
  }
}

async function expectOk(message: ExtensionMessage): Promise<void> {
  const response = await sendExtensionMessage(message as Extract<ExtensionMessage, { type: 'DOMSHOT_HISTORY_BEGIN' | 'DOMSHOT_HISTORY_CHUNK' | 'DOMSHOT_HISTORY_COMMIT' | 'DOMSHOT_HISTORY_CANCEL' | 'DOMSHOT_HISTORY_DELETE' | 'DOMSHOT_HISTORY_RESTORE' | 'DOMSHOT_HISTORY_CLEAR' }>);
  if (!response.ok) throw new Error('Capture history operation failed');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function historyCaptureId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const random = new Uint32Array(3);
  crypto.getRandomValues(random);
  return `capture-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join('')}`;
}
