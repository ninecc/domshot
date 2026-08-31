import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const popupUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/popup.html')).href;
test('popup opens a dedicated settings panel and returns to the capture panel', async () => {
  await withChromePage({ url: popupUrl, viewport: { width: 360, height: 600 } }, async (page) => {
    const rootWidth = await page.evaluate('getComputedStyle(document.documentElement).width');
    assert.equal(rootWidth, '360px');

    const initial = await page.evaluate(`({
      homeHidden: document.querySelector('#homePanel').hidden,
      settingsHidden: document.querySelector('#settingsPanel').hidden,
      outputSettingsInHome: Boolean(document.querySelector('#homePanel .output-settings')),
      footerInsidePanel: Boolean(document.querySelector('.panel .popup-footer')),
      introTitle: document.querySelector('#intro-title').textContent,
      introEyebrow: Boolean(document.querySelector('.intro p')),
      actionLabels: [...document.querySelectorAll('.capture-action strong')].map((label) => label.textContent),
      clarityLabel: document.querySelector('[aria-label="图片清晰度"]').parentElement.firstElementChild.textContent,
      pixelHint: document.querySelector('#pixelHint').textContent
    })`);
    assert.equal(initial.homeHidden, false);
    assert.equal(initial.settingsHidden, true);
    assert.equal(initial.outputSettingsInHome, true, 'frequently used output settings must remain on the capture panel');
    assert.equal(initial.footerInsidePanel, false, 'footer must be shared by both panels');
    assert.equal(initial.introTitle, '精确捕获网页内容');
    assert.equal(initial.introEyebrow, false, 'homepage should not include a decorative technical eyebrow');
    assert.deepEqual(initial.actionLabels, ['截取页面元素', '截取完整页面']);
    assert.equal(initial.clarityLabel, '图片清晰度');
    assert.equal(initial.pixelHint, '当前 2×');

    await page.waitUntil(
      `getComputedStyle(document.querySelector('#homePanel')).transform === 'none'`,
      'home panel entrance animation did not finish',
    );
    const primaryIdle = await page.evaluate(`(() => {
      const button = document.querySelector('.primary-action');
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor, rect: { left: rect.left, top: rect.top } };
    })()`);
    assert.equal(primaryIdle.backgroundImage, 'none', 'primary action must not use a decorative gradient');
    await page.hover('.primary-action');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('.primary-action')).backgroundColor === 'rgb(248, 250, 255)'`,
      'primary action hover did not reach the subtle blue surface color',
    );
    const primaryHovered = await page.evaluate(`(() => {
      const button = document.querySelector('.primary-action');
      const rect = button.getBoundingClientRect();
      return { transform: getComputedStyle(button).transform, rect: { left: rect.left, top: rect.top } };
    })()`);
    assert.equal(primaryHovered.transform, 'none', 'capture actions must not move on hover');
    assert.deepEqual(primaryHovered.rect, primaryIdle.rect, 'capture action position must remain stable on hover');

    const idleButton = await buttonColors(page);
    await page.hover('.settings-button');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('.settings-button')).color === 'rgb(37, 99, 235)'`,
      'settings hover color transition did not reach the brand color',
    );
    const hoveredButton = await buttonColors(page);
    assert.notEqual(hoveredButton.color, idleButton.color, 'settings hover must change the icon color');
    assert.equal(hoveredButton.backgroundColor, 'rgba(0, 0, 0, 0)', 'settings hover must keep a transparent background');

    const metrics = await page.evaluate(`new Promise((resolve) => {
      document.querySelector('#settingsButton').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        homeHidden: document.querySelector('#homePanel').hidden,
        settingsHidden: document.querySelector('#settingsPanel').hidden,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        settingsHeaderChildren: document.querySelector('.settings-header').children.length,
        settingsSubtitle: Boolean(document.querySelector('.settings-header p')),
        autosaveInsideCard: document.querySelector('.autosave-status')?.parentElement?.classList.contains('advanced-heading'),
        footerVisible: getComputedStyle(document.querySelector('.popup-footer')).display !== 'none',
        outputSurface: (() => {
          const style = getComputedStyle(document.querySelector('.output-settings'));
          return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
        })(),
        advancedSurface: (() => {
          const style = getComputedStyle(document.querySelector('.advanced-settings'));
          return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
        })(),
        activeToggleGradient: getComputedStyle(document.querySelector('#embedFonts + i'), '::before').backgroundImage,
        outputSettingsInPanel: Boolean(document.querySelector('#settingsPanel .output-settings')),
        advancedOptionCount: document.querySelectorAll('.advanced-options .toggle-row').length,
        advancedOptionRects: [...document.querySelectorAll('.advanced-options .toggle-row')].map((row) => {
          const rect = row.getBoundingClientRect();
          return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
        }),
        embedFontsChecked: document.querySelector('#embedFonts').checked,
        reconcileChecked: document.querySelector('#reconcile').checked,
        focusedElement: document.activeElement.id
      })));
    })`);

    assert.equal(metrics.homeHidden, true);
    assert.equal(metrics.settingsHidden, false);
    assert.equal(metrics.settingsHeaderChildren, 2, 'settings header should only contain back and title');
    assert.equal(metrics.settingsSubtitle, false);
    assert.equal(metrics.autosaveInsideCard, true, 'autosave status should replace the decorative card label');
    assert.equal(metrics.footerVisible, true, 'shared footer must remain visible on the settings panel');
    assert.equal(metrics.advancedSurface.backgroundImage, 'none', 'settings containers must not use decorative gradients');
    assert.equal(metrics.advancedSurface.backgroundColor, metrics.outputSurface.backgroundColor, 'settings containers should share one surface color');
    assert.notEqual(metrics.activeToggleGradient, 'none', 'active controls should retain the brand gradient');
    assert.equal(metrics.outputSettingsInPanel, false, 'the settings panel should only contain low-frequency options');
    assert.equal(metrics.advancedOptionCount, 2);
    assert.equal(metrics.advancedOptionRects[0].left, metrics.advancedOptionRects[1].left);
    assert.equal(metrics.advancedOptionRects[0].width, metrics.advancedOptionRects[1].width);
    assert.ok(metrics.advancedOptionRects[1].top >= metrics.advancedOptionRects[0].bottom, 'advanced options must each occupy their own row');
    assert.equal(metrics.embedFontsChecked, true);
    assert.equal(metrics.reconcileChecked, false);
    assert.equal(metrics.focusedElement, 'backButton');
    assert.ok(metrics.scrollWidth <= 360, `expanded popup is ${metrics.scrollWidth}px wide`);
    assert.ok(metrics.scrollHeight <= 600, `expanded popup is ${metrics.scrollHeight}px tall and requires a scrollbar`);

    const toggleCloseStart = await page.evaluate(`(() => {
      const input = document.querySelector('#embedFonts');
      const track = input.nextElementSibling;
      input.click();
      const style = getComputedStyle(track);
      return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
    })()`);
    assert.equal(toggleCloseStart.backgroundColor, 'rgb(203, 213, 225)', 'toggle track must keep its neutral surface while the active gradient fades out');

    const returned = await page.evaluate(`new Promise((resolve) => {
      document.querySelector('#backButton').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        homeHidden: document.querySelector('#homePanel').hidden,
        settingsHidden: document.querySelector('#settingsPanel').hidden,
        focusedElement: document.activeElement.id
      })));
    })`);
    assert.equal(returned.homeHidden, false);
    assert.equal(returned.settingsHidden, true);
    assert.equal(returned.focusedElement, 'settingsButton');
  });
});

function buttonColors(page) {
  return page.evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.settings-button'));
    return { color: style.color, backgroundColor: style.backgroundColor };
  })()`);
}
