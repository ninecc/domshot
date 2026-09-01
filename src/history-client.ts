import type { CaptureHistoryDetail, CaptureHistoryItem, ExtensionMessage } from './types';

const CHUNK_BYTES = 3 * 256 * 1024;

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
  const response = await sendHistoryMessage<{ captures?: CaptureHistoryItem[] }>({ type: 'DOMSHOT_HISTORY_LIST' });
  if (!response.captures) throw new Error('Could not load capture history');
  return response.captures;
}

export async function getCaptureHistory(id: string): Promise<CaptureHistoryDetail | null> {
  const response = await sendHistoryMessage<{ capture?: CaptureHistoryDetail | null }>({ type: 'DOMSHOT_HISTORY_GET', id });
  return response.capture ?? null;
}

export async function deleteCaptureHistory(id: string): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_DELETE', id });
}

export async function clearCaptureHistory(): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_CLEAR' });
}

async function uploadCaptureHistory(id: string, capture: NewCaptureHistoryItem): Promise<void> {
  const { blob, ...metadata } = capture;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const item: CaptureHistoryItem = { ...metadata, id };
  try {
    await expectOk({ type: 'DOMSHOT_HISTORY_BEGIN', capture: item, mimeType: blob.type, totalChunks: Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)) });
    for (let offset = 0, index = 0; offset < bytes.length || index === 0; offset += CHUNK_BYTES, index += 1) {
      await expectOk({ type: 'DOMSHOT_HISTORY_CHUNK', id, index, data: bytesToBase64(bytes.subarray(offset, offset + CHUNK_BYTES)) });
    }
    await expectOk({ type: 'DOMSHOT_HISTORY_COMMIT', id });
  } catch (error) {
    void chrome.runtime.sendMessage({ type: 'DOMSHOT_HISTORY_CANCEL', id } satisfies ExtensionMessage).catch(() => {});
    throw error;
  }
}

async function expectOk(message: ExtensionMessage): Promise<void> {
  const response = await sendHistoryMessage<{ ok?: boolean; error?: string }>(message);
  if (!response.ok) throw new Error(response.error || 'Capture history operation failed');
}

async function sendHistoryMessage<T>(message: ExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T | undefined;
  if (!response) throw new Error('Capture history background is unavailable');
  return response;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function historyCaptureId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const random = new Uint32Array(3);
  crypto.getRandomValues(random);
  return `capture-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join('')}`;
}
