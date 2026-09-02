import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const permissionBundle = await readFile(resolve(import.meta.dirname, '../dist/permission.js'), 'utf8');
const permissionPageUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/permission.html')).href;
const fixtureUrl = 'data:text/html,<main><span id="originCount"></span><ul id="originList"></ul><p id="permissionStatus"></p><button id="cancelPermission"></button><button id="grantPermission"></button></main>';

test('permission page lets a user recover after declining access', async () => {
  await withChromePage({ url: `${fixtureUrl}?token=retry-1&mode=inline&lang=en&theme=dark` }, async (page) => {
    await page.evaluate(`
      globalThis.__permissionRequests = 0;
      globalThis.__permissionCompleted = false;
      globalThis.close = () => { globalThis.__permissionWindowClosed = true; };
      chrome.runtime = {
        async sendMessage(message) {
          if (message.type === 'DOMSHOT_GET_IMAGE_PERMISSION') return {
            ok: true,
            origins: ['https://images.example', 'https://cdn.example:8443'],
            patterns: ['https://images.example/*', 'https://cdn.example/*']
          };
          if (message.type === 'DOMSHOT_COMPLETE_IMAGE_PERMISSION') {
            globalThis.__permissionCompleted = true;
            return { retried: true };
          }
          return { ok: true };
        }
      };
      chrome.permissions = {
        async request() { return ++globalThis.__permissionRequests > 1; }
      };
    `);
    await page.evaluate(permissionBundle);
    await page.waitUntil(`document.querySelectorAll('#originList li').length === 2`, 'Permission origins did not render');
    assert.equal(await page.evaluate(`document.documentElement.dataset.mode`), 'inline');
    assert.equal(await page.evaluate(`document.documentElement.lang`), 'en');
    assert.equal(await page.evaluate(`document.documentElement.dataset.theme`), 'dark');
    assert.ok((await page.evaluate(`document.querySelector('#cancelPermission').textContent`)).length > 0);
    assert.ok((await page.evaluate(`document.querySelector('#originCount').textContent`)).length > 0);
    const initialGrantLabel = await page.evaluate(`document.querySelector('#grantPermission').textContent`);

    await page.evaluate(`document.querySelector('#grantPermission').click()`);
    await page.waitUntil(`document.querySelector('#permissionStatus').textContent.length > 0`, 'Declined state did not render');
    assert.notEqual(await page.evaluate(`document.querySelector('#grantPermission').textContent`), initialGrantLabel);
    assert.equal(await page.evaluate(`document.querySelector('#grantPermission').disabled`), false);

    await page.evaluate(`document.querySelector('#grantPermission').click()`);
    await page.waitUntil(`globalThis.__permissionCompleted === true`, 'Granted permission did not retry capture');
    assert.ok((await page.evaluate(`document.querySelector('#permissionStatus').textContent`)).length > 0);
    assert.equal(await page.evaluate(`globalThis.__permissionRequests`), 2);
  });
});

test('permission page applies its requested dark theme', async () => {
  await withChromePage({ url: `${permissionPageUrl}?theme=dark&lang=en` }, async (page) => {
    await page.waitUntil(`document.documentElement.dataset.theme === 'dark'`, 'Dark permission theme was not applied');
    const colors = await page.evaluate(`(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(document.querySelector('.origin-panel')).backgroundColor,
      cancel: getComputedStyle(document.querySelector('.cancel')).backgroundColor
    }))()`);
    const channels = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(Object.values(colors).every((value) => channels(value).every((channel) => channel < 60)), `unexpected dark surfaces: ${JSON.stringify(colors)}`);
  });
});

test('Chinese permission copy discloses that granted access persists', async () => {
  await withChromePage({ url: `${permissionPageUrl}?lang=zh-CN` }, async (page) => {
    await page.waitUntil(`document.documentElement.lang === 'zh-CN'`, 'Chinese permission copy was not applied');
    const intro = await page.evaluate(`document.querySelector('[data-i18n="permissionIntro"]').textContent`);
    assert.match(intro, /Chrome/);
    assert.match(intro, /移除/);
  });
});
