import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../dist');

test('extension packages English and Chinese locales with English as the fallback', async () => {
  const [manifest, english, chinese] = await Promise.all([
    readJson(resolve(dist, 'manifest.json')),
    readJson(resolve(dist, '_locales/en/messages.json')),
    readJson(resolve(dist, '_locales/zh_CN/messages.json')),
  ]);

  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.ok(english.extensionDescription.message.length > 0);
  assert.ok(chinese.extensionDescription.message.length > 0);
  assert.notEqual(english.extensionDescription.message, chinese.extensionDescription.message);
  assert.doesNotMatch(english.extensionDescription.message, /[\u4e00-\u9fff]/);
  assert.match(chinese.extensionDescription.message, /[\u4e00-\u9fff]/);
});

test('both READMEs disclose optional image-source permissions', async () => {
  const [english, chinese] = await Promise.all([
    readFile(resolve(import.meta.dirname, '../README.md'), 'utf8'),
    readFile(resolve(import.meta.dirname, '../README_CN.md'), 'utf8'),
  ]);
  assert.match(english, /optional.+image.+permission/is);
  assert.match(english, /remain.+Chrome/is);
  assert.match(chinese, /可选.+图片.+权限/s);
  assert.match(chinese, /保留.+Chrome/s);
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
