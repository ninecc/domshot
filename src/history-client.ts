import type { CaptureHistoryDetail, CaptureHistoryItem, ExtensionMessage } from './types';
import { CAPTURE_HISTORY_POLICY } from './types';
import { sendExtensionMessage } from './messaging';

export type NewCaptureHistoryItem = Omit<CaptureHistoryItem, 'id'> & { blob: Blob };

export class CaptureHistorySession {
  private captureId: string | null = null;
  private captureForId: NewCaptureHistoryItem | null = null;
  private captureDigest: string | null = null;
  private isSaved = false;
  private needsRestore = false;

  constructor(private readonly capture: NewCaptureHistoryItem) {}

  get id(): string | null { return this.captureId; }
  get saved(): boolean { return this.isSaved; }

  async refresh(): Promise<boolean> {
    if (!this.captureId || !this.captureForId) {
      this.isSaved = false;
      return false;
    }
    this.captureDigest ??= await digestBlob(this.captureForId.blob);
    const state = await confirmCaptureHistory(this.captureId, this.captureForId, this.captureDigest);
    if (state === 'conflict') throw new Error('Capture history identity conflict');
    this.isSaved = state === 'stored';
    this.needsRestore = !this.isSaved;
    return this.isSaved;
  }

  async save(): Promise<void> {
    if (this.isSaved && await this.refresh()) return;
    if (this.captureId && this.captureForId) {
      if (this.needsRestore && await tryRestoreCaptureHistory(this.captureId)) {
        this.isSaved = true;
        this.needsRestore = false;
        return;
      }
      if (!this.needsRestore) {
        this.captureDigest ??= await digestBlob(this.captureForId.blob);
        const state = await confirmCaptureHistory(this.captureId, this.captureForId, this.captureDigest);
        if (state === 'stored') { this.isSaved = true; return; }
        if (state === 'conflict') throw new Error('Capture history identity conflict');
      }
    }
    const id = this.captureId ?? historyCaptureId();
    const capture = this.captureId ? { ...this.capture, createdAt: Date.now() } : this.capture;
    this.captureId = id;
    this.captureForId = capture;
    this.captureDigest ??= await digestBlob(capture.blob);
    this.needsRestore = false;
    try {
      await uploadCaptureHistory(id, capture, this.captureDigest);
      this.isSaved = true;
    } catch (error) {
      let state: Awaited<ReturnType<typeof confirmCaptureHistory>>;
      try { state = await confirmCaptureHistory(id, capture, this.captureDigest); } catch { throw error; }
      if (state === 'stored') { this.isSaved = true; return; }
      if (state === 'conflict') throw new Error('Capture history identity conflict');
      throw error;
    }
  }

  async remove(): Promise<void> {
    if (!this.captureId || !this.isSaved) return;
    await deleteCaptureHistory(this.captureId);
    this.isSaved = false;
    this.needsRestore = true;
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

async function tryRestoreCaptureHistory(id: string): Promise<boolean> {
  const response = await sendExtensionMessage({ type: 'DOMSHOT_HISTORY_RESTORE', id });
  return response.ok;
}

async function confirmCaptureHistory(id: string, capture: NewCaptureHistoryItem, digest: string): Promise<'stored' | 'missing' | 'conflict'> {
  const { blob: _blob, ...metadata } = capture;
  const response = await sendExtensionMessage({ type: 'DOMSHOT_HISTORY_CONFIRM', capture: { ...metadata, id }, mimeType: capture.blob.type, digest });
  return response.state;
}

export async function clearCaptureHistory(): Promise<void> {
  await expectOk({ type: 'DOMSHOT_HISTORY_CLEAR' });
}

async function uploadCaptureHistory(id: string, capture: NewCaptureHistoryItem, digest: string): Promise<void> {
  const { blob, ...metadata } = capture;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const item: CaptureHistoryItem = { ...metadata, id };
  let uploadToken: string | null = null;
  try {
    const begin = await sendExtensionMessage({ type: 'DOMSHOT_HISTORY_BEGIN', capture: item, mimeType: blob.type, digest, totalChunks: Math.max(1, Math.ceil(bytes.length / CAPTURE_HISTORY_POLICY.chunkBytes)) });
    if (!begin.ok) throw new Error('Capture history operation failed');
    if (begin.alreadyStored) return;
    if (!begin.uploadToken) throw new Error('Capture history upload token is unavailable');
    uploadToken = begin.uploadToken;
    for (let offset = 0, index = 0; offset < bytes.length || index === 0; offset += CAPTURE_HISTORY_POLICY.chunkBytes, index += 1) {
      await expectOk({ type: 'DOMSHOT_HISTORY_CHUNK', id, uploadToken, index, data: bytesToBase64(bytes.subarray(offset, offset + CAPTURE_HISTORY_POLICY.chunkBytes)) });
    }
    await expectOk({ type: 'DOMSHOT_HISTORY_COMMIT', id, uploadToken });
  } catch (error) {
    if (uploadToken) void sendExtensionMessage({ type: 'DOMSHOT_HISTORY_CANCEL', id, uploadToken }).catch(() => {});
    throw error;
  }
}

async function digestBlob(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer));
    return `sha256:${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `sha256:${sha256Fallback(bytes)}`;
}

function sha256Fallback(bytes: Uint8Array) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const paddedByte = (index: number) => {
    if (index < bytes.length) return bytes[index];
    if (index === bytes.length) return 0x80;
    if (index >= paddedLength - 8) {
      const shift = (paddedLength - 1 - index) * 8;
      return shift >= 32 ? (bitLengthHigh >>> (shift - 32)) & 0xff : (bitLengthLow >>> shift) & 0xff;
    }
    return 0;
  };
  const rotateRight = (value: number, count: number) => (value >>> count) | (value << (32 - count));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (paddedByte(start) << 24) | (paddedByte(start + 1) << 16) | (paddedByte(start + 2) << 8) | paddedByte(start + 3);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
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
