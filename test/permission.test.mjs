import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withChromePage } from './support/chrome-page.mjs';

const permissionBundle = await readFile(resolve(import.meta.dirname, '../dist/permission.js'), 'utf8');
const fixtureUrl = 'data:text/html,<main><span id="originCount"></span><ul id="originList"></ul><p id="permissionStatus"></p><button id="cancelPermission"></button><button id="grantPermission"></button></main>';

test('permission page lets a user recover after declining access', async () => {
  await withChromePage({ url: `${fixtureUrl}?token=retry-1&mode=inline` }, async (page) => {
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
    assert.equal(await page.evaluate(`document.querySelector('#cancelPermission').textContent`), '返回截图');
    assert.equal(await page.evaluate(`document.querySelector('#originCount').textContent`), '2 个');

    await page.evaluate(`document.querySelector('#grantPermission').click()`);
    await page.waitUntil(`document.querySelector('#permissionStatus').textContent.includes('未授权')`, 'Declined state did not render');
    assert.equal(await page.evaluate(`document.querySelector('#grantPermission').textContent`), '再次授权');
    assert.equal(await page.evaluate(`document.querySelector('#grantPermission').disabled`), false);

    await page.evaluate(`document.querySelector('#grantPermission').click()`);
    await page.waitUntil(`globalThis.__permissionCompleted === true`, 'Granted permission did not retry capture');
    assert.match(await page.evaluate(`document.querySelector('#permissionStatus').textContent`), /正在原页面重新截图/);
    assert.equal(await page.evaluate(`globalThis.__permissionRequests`), 2);
  });
});
