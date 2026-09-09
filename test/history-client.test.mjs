import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';

test('a capture history session restores its existing identity before uploading again', async () => {
  const messages = [];
  let restoreAllowed = true;
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'DOMSHOT_HISTORY_RESTORE') return { ok: restoreAllowed };
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') return { ok: true, uploadToken: 'upload-token' };
        return { ok: true };
      },
    },
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const capture = {
    createdAt: 1,
    label: 'Capture',
    filename: 'capture.png',
    format: 'png',
    width: 1,
    height: 1,
    scale: 1,
    size: 1,
    sourceHost: 'example.com',
    thumbnailDataUrl: 'data:image/png;base64,AA==',
    blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  };
  const session = new module.CaptureHistorySession(capture);

  await session.save();
  const firstId = messages.find(message => message.type === 'DOMSHOT_HISTORY_BEGIN').capture.id;
  await session.remove();
  messages.length = 0;
  await session.save();
  assert.equal(session.id, firstId);
  assert.equal(session.saved, true);
  assert.deepEqual(messages.map(message => message.type), ['DOMSHOT_HISTORY_RESTORE']);

  await session.remove();
  restoreAllowed = false;
  messages.length = 0;
  await session.save();
  assert.equal(session.id, firstId);
  assert.equal(messages[0].type, 'DOMSHOT_HISTORY_RESTORE');
  assert.ok(messages.some(message => message.type === 'DOMSHOT_HISTORY_COMMIT'));
});

test('a lost commit reply is confirmed under the same capture identity', async () => {
  const messages = [];
  const stored = new Map();
  let pendingCapture;
  let loseCommitReply = true;
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') { pendingCapture = message.capture; return { ok: true, uploadToken: 'upload-token' }; }
        if (message.type === 'DOMSHOT_HISTORY_COMMIT') {
          stored.set(message.id, pendingCapture);
          if (loseCommitReply) { loseCommitReply = false; throw new Error('Reply channel closed'); }
        }
        if (message.type === 'DOMSHOT_HISTORY_CONFIRM') {
          const existing = stored.get(message.capture.id);
          return { state: existing && existing.filename === message.capture.filename ? 'stored' : existing ? 'conflict' : 'missing' };
        }
        return { ok: true };
      },
    },
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#lost-reply`);
  const session = new module.CaptureHistorySession({
    createdAt: 1, label: 'Capture', filename: 'capture.png', format: 'png', width: 1, height: 1,
    scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
    blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  });

  await session.save();
  await session.save();
  const beginMessages = messages.filter(message => message.type === 'DOMSHOT_HISTORY_BEGIN');
  assert.equal(beginMessages.length, 1);
  assert.equal(stored.size, 1);
  assert.equal(session.id, beginMessages[0].capture.id);
  assert.equal(session.saved, true);
  assert.ok(messages.some(message => message.type === 'DOMSHOT_HISTORY_CONFIRM'));
});

test('history confirmation refuses to overwrite a conflicting capture identity', async () => {
  const messages = [];
  let pendingCapture;
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') { pendingCapture = message.capture; return { ok: true, uploadToken: 'upload-token' }; }
        if (message.type === 'DOMSHOT_HISTORY_COMMIT') throw new Error('Reply channel closed after another record won the ID');
        if (message.type === 'DOMSHOT_HISTORY_CONFIRM') return { state: 'conflict' };
        return { ok: true };
      },
    },
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')], bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#conflict`);
  const session = new module.CaptureHistorySession({
    createdAt: 1, label: 'Capture', filename: 'capture.png', format: 'png', width: 1, height: 1,
    scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
    blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  });

  await assert.rejects(session.save(), /conflict/i);
  await assert.rejects(session.save(), /conflict/i);
  assert.equal(messages.filter(message => message.type === 'DOMSHOT_HISTORY_BEGIN').length, 1);
  assert.equal(messages.filter(message => message.type === 'DOMSHOT_HISTORY_CONFIRM').length, 2);
  assert.equal(session.saved, false);
  assert.ok(pendingCapture);
});

test('refresh observes an external clear and lets save restore the same identity', async () => {
  const stored = new Set();
  const messages = [];
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') return { ok: true, uploadToken: 'upload-token' };
        if (message.type === 'DOMSHOT_HISTORY_COMMIT') { stored.add(message.id); return { ok: true }; }
        if (message.type === 'DOMSHOT_HISTORY_CONFIRM') return { state: stored.has(message.capture.id) ? 'stored' : 'missing' };
        if (message.type === 'DOMSHOT_HISTORY_RESTORE') return { ok: false };
        return { ok: true };
      },
    },
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')], bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#refresh`);
  const session = new module.CaptureHistorySession({
    createdAt: 1, label: 'Capture', filename: 'capture.png', format: 'png', width: 1, height: 1,
    scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
    blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  });
  await session.save();
  const id = session.id;
  stored.clear();

  assert.equal(await session.refresh(), false);
  assert.equal(session.saved, false);
  await session.save();
  assert.equal(session.id, id);
  assert.equal(session.saved, true);
});

test('history digest falls back to the same SHA-256 identity without Web Crypto subtle', async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let begin;
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID() { return 'fallback-id'; },
        getRandomValues(values) { values.fill(1); return values; },
      },
    });
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          if (message.type === 'DOMSHOT_HISTORY_BEGIN') { begin = message; return { ok: true, uploadToken: 'upload-token' }; }
          return { ok: true };
        },
      },
    };
    const result = await build({
      entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')], bundle: true, format: 'esm', platform: 'browser', write: false,
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#fallback`);
    const session = new module.CaptureHistorySession({
      createdAt: 1, label: 'Capture', filename: 'capture.png', format: 'png', width: 1, height: 1,
      scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
      blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
    });
    await session.save();
    assert.equal(begin.digest, 'sha256:6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
});

test('a rejected begin cannot cancel another upload with the same capture ID', async () => {
  const messages = [];
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'DOMSHOT_HISTORY_BEGIN') throw new Error('Capture history identity conflict');
        if (message.type === 'DOMSHOT_HISTORY_CONFIRM') return { state: 'conflict' };
        return { ok: true };
      },
    },
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, '../src/history-client.ts')], bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#begin-conflict`);
  const session = new module.CaptureHistorySession({
    createdAt: 1, label: 'Capture', filename: 'capture.png', format: 'png', width: 1, height: 1,
    scale: 1, size: 1, sourceHost: 'example.com', thumbnailDataUrl: '',
    blob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  });
  await assert.rejects(session.save(), /conflict/i);
  assert.equal(messages.some(message => message.type === 'DOMSHOT_HISTORY_CANCEL'), false);
});
