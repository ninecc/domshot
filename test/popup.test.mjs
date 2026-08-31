import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const popupUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/popup.html')).href;
test('popup opens a dedicated settings panel and returns to the capture panel', async () => {
  await withChromePage({
    url: popupUrl,
    viewport: { width: 360, height: 600 },
    initScript: `
      globalThis.__syncStore = {};
      Object.defineProperty(chrome, 'i18n', { configurable: true, value: { getUILanguage: () => 'fr-FR' } });
      Object.defineProperty(chrome, 'storage', { configurable: true, value: { sync: {
        async get(key) { return typeof key === 'string' ? { [key]: globalThis.__syncStore[key] } : { ...globalThis.__syncStore }; },
        async set(values) { Object.assign(globalThis.__syncStore, values); }
      } } });
    `,
  }, async (page) => {
    const rootWidth = await page.evaluate('getComputedStyle(document.documentElement).width');
    assert.equal(rootWidth, '360px');

    const initial = await page.evaluate(`({
      lang: document.documentElement.lang,
      homeHidden: document.querySelector('#homePanel').hidden,
      settingsHidden: document.querySelector('#settingsPanel').hidden,
      outputSettingsInHome: Boolean(document.querySelector('#homePanel .output-settings')),
      footerInsidePanel: Boolean(document.querySelector('.panel .popup-footer')),
      introTitle: document.querySelector('#intro-title').textContent,
      introEyebrow: Boolean(document.querySelector('.intro p')),
      actionLabels: [...document.querySelectorAll('.capture-action strong')].map((label) => label.textContent),
      clarityLabel: document.querySelector('.scale-segment').parentElement.firstElementChild.textContent,
      pixelHint: document.querySelector('#pixelHint').textContent,
      settingsTitle: document.querySelector('#settings-title').textContent,
      generalTitle: document.querySelector('#general-title').textContent
    })`);
    assert.equal(initial.lang, 'en');
    assert.equal(initial.homeHidden, false);
    assert.equal(initial.settingsHidden, true);
    assert.equal(initial.outputSettingsInHome, true, 'frequently used output settings must remain on the capture panel');
    assert.equal(initial.footerInsidePanel, false, 'footer must be shared by both panels');
    assert.ok(initial.introTitle.length > 0);
    assert.equal(initial.introEyebrow, false, 'homepage should not include a decorative technical eyebrow');
    assert.equal(initial.actionLabels.length, 2);
    assert.ok(initial.actionLabels.every(Boolean));
    assert.ok(initial.clarityLabel.length > 0);
    assert.match(initial.pixelHint, /2×/);

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
      `getComputedStyle(document.querySelector('.primary-action')).backgroundColor !== ${JSON.stringify(primaryIdle.backgroundColor)}`,
      'primary action hover did not change its surface color',
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
      `getComputedStyle(document.querySelector('.settings-button')).color !== ${JSON.stringify(idleButton.color)}`,
      'settings hover did not change the icon color',
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
        implicitLineHeights: ['#general-title', '#advanced-title', '.autosave-status', '.language-segment span', '.toggle-row strong', '.status', '.attribution']
          .map((selector) => ({ selector, lineHeight: getComputedStyle(document.querySelector(selector)).lineHeight })),
        localeLayout: (() => {
          const stable = (value) => Math.round(value * 100) / 100;
          const height = (selector) => stable(document.querySelector(selector).getBoundingClientRect().height);
          return {
            shellHeight: height('.shell'),
            panelHeight: height('#settingsPanel'),
            generalHeight: height('.general-settings'),
            advancedHeight: height('.advanced-settings'),
            footerHeight: height('.popup-footer'),
            statusHeight: height('.status'),
            attributionHeight: height('.attribution'),
            languageWidth: stable(document.querySelector('.language-segment').getBoundingClientRect().width),
            descriptionHeights: [...document.querySelectorAll('.advanced-options small')].map((item) => stable(item.getBoundingClientRect().height)),
            footerTop: stable(document.querySelector('.popup-footer').getBoundingClientRect().top)
          };
        })(),
        settingsSubtitle: Boolean(document.querySelector('.settings-header p')),
        settingsTitleVisible: document.querySelector('#settings-title').getClientRects().length > 0,
        backButtonVisible: document.querySelector('#backButton').getClientRects().length > 0,
        autosaveVisible: document.querySelector('.autosave-status').getClientRects().length > 0,
        languageOptionCount: document.querySelectorAll('input[name="language"]').length,
        afterCaptureOptionCount: document.querySelectorAll('input[name="afterCapture"]').length,
        afterCaptureDefault: document.querySelector('input[name="afterCapture"]:checked').value,
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
        outerShadowsChecked: document.querySelector('#outerShadows').checked,
        compressImagesChecked: document.querySelector('#compressImages').checked,
        focusedElement: document.activeElement.id
      })));
    })`);

    assert.equal(metrics.homeHidden, true);
    assert.equal(metrics.settingsHidden, false);
    assert.equal(metrics.settingsSubtitle, false);
    assert.equal(metrics.settingsTitleVisible, true);
    assert.equal(metrics.backButtonVisible, true);
    assert.equal(metrics.autosaveVisible, true);
    assert.ok(Math.max(...metrics.localeLayout.descriptionHeights) - Math.min(...metrics.localeLayout.descriptionHeights) < 0.5, 'setting descriptions must reserve comparable text region heights');
    assert.equal(metrics.languageOptionCount, 3);
    assert.equal(metrics.afterCaptureOptionCount, 3);
    assert.equal(metrics.afterCaptureDefault, 'preview');
    assert.deepEqual(metrics.implicitLineHeights.filter(({ lineHeight }) => lineHeight === 'normal'), [], 'localized text must not rely on font-dependent normal line height');
    assert.equal(metrics.footerVisible, true, 'shared footer must remain visible on the settings panel');
    assert.equal(metrics.advancedSurface.backgroundImage, 'none', 'settings containers must not use decorative gradients');
    assert.equal(metrics.advancedSurface.backgroundColor, metrics.outputSurface.backgroundColor, 'settings containers should share one surface color');
    assert.notEqual(metrics.activeToggleGradient, 'none', 'active controls should retain the brand gradient');
    assert.equal(metrics.outputSettingsInPanel, false, 'the settings panel should only contain low-frequency options');
    assert.equal(metrics.advancedOptionCount, 4);
    assert.ok(Math.abs(metrics.advancedOptionRects[0].left - metrics.advancedOptionRects[1].left) < 0.5);
    assert.ok(Math.abs(metrics.advancedOptionRects[0].width - metrics.advancedOptionRects[1].width) < 0.5);
    metrics.advancedOptionRects.slice(1).forEach((rect, index) => {
      assert.ok(rect.top >= metrics.advancedOptionRects[index].bottom, 'advanced options must each occupy their own row');
    });
    assert.equal(metrics.embedFontsChecked, true);
    assert.equal(metrics.reconcileChecked, false);
    assert.equal(metrics.outerShadowsChecked, false);
    assert.equal(metrics.compressImagesChecked, true);
    assert.equal(metrics.focusedElement, 'backButton');
    assert.ok(metrics.scrollWidth <= 360, `expanded popup is ${metrics.scrollWidth}px wide`);
    assert.ok(metrics.scrollHeight <= 600, `expanded popup is ${metrics.scrollHeight}px tall and requires a scrollbar`);
    assert.ok(metrics.localeLayout.shellHeight <= 600, `settings content is ${metrics.localeLayout.shellHeight}px tall`);

    const chinese = await page.evaluate(`(() => {
      document.querySelector('input[name="language"][value="zh-CN"]').click();
      return {
        lang: document.documentElement.lang,
        settingsTitle: document.querySelector('#settings-title').textContent,
        generalTitle: document.querySelector('#general-title').textContent,
        advancedTitle: document.querySelector('#advanced-title').textContent,
        footer: document.querySelector('.status-copy').textContent,
        autoLabel: document.querySelector('input[name="language"][value="auto"] + span').textContent,
        layout: (() => {
          const stable = (value) => Math.round(value * 100) / 100;
          const height = (selector) => stable(document.querySelector(selector).getBoundingClientRect().height);
          return {
            shellHeight: height('.shell'),
            panelHeight: height('#settingsPanel'),
            generalHeight: height('.general-settings'),
            advancedHeight: height('.advanced-settings'),
            footerHeight: height('.popup-footer'),
            statusHeight: height('.status'),
            attributionHeight: height('.attribution'),
            languageWidth: stable(document.querySelector('.language-segment').getBoundingClientRect().width),
            descriptionHeights: [...document.querySelectorAll('.advanced-options small')].map((item) => stable(item.getBoundingClientRect().height)),
            footerTop: stable(document.querySelector('.popup-footer').getBoundingClientRect().top)
          };
        })(),
        storedLanguage: globalThis.__syncStore.uiLanguage
      };
    })()`);
    assert.equal(chinese.lang, 'zh-CN');
    assert.equal(chinese.storedLanguage, 'zh-CN');
    assert.ok([chinese.settingsTitle, chinese.generalTitle, chinese.advancedTitle, chinese.footer, chinese.autoLabel].every(Boolean));
    assert.notEqual(chinese.settingsTitle, initial.settingsTitle);
    assert.notEqual(chinese.generalTitle, initial.generalTitle);
    assertLayoutsClose(chinese.layout, metrics.localeLayout);

    const savedPostAction = await page.evaluate(`(() => {
      document.querySelector('input[name="afterCapture"][value="copy"]').click();
      return globalThis.__syncStore.captureSettings?.afterCapture;
    })()`);
    assert.equal(savedPostAction, 'copy');
    const savedAdvancedSettings = await page.evaluate(`(() => {
      document.querySelector('#outerShadows').click();
      document.querySelector('#compressImages').click();
      return {
        outerShadows: globalThis.__syncStore.captureSettings?.outerShadows,
        compress: globalThis.__syncStore.captureSettings?.compress
      };
    })()`);
    assert.deepEqual(savedAdvancedSettings, { outerShadows: true, compress: false });

    const toggleCloseStart = await page.evaluate(`(() => {
      const input = document.querySelector('#embedFonts');
      const track = input.nextElementSibling;
      input.click();
      const style = getComputedStyle(track);
      return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
    })()`);
    assert.notEqual(toggleCloseStart.backgroundColor, 'rgba(0, 0, 0, 0)', 'toggle track must keep a visible neutral surface while the active gradient fades out');

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

function assertLayoutsClose(actual, expected, tolerance = 0.5) {
  for (const key of Object.keys(expected)) {
    const actualValue = actual[key];
    const expectedValue = expected[key];
    if (Array.isArray(expectedValue)) {
      assert.equal(actualValue.length, expectedValue.length, `${key} item count changed across locales`);
      expectedValue.forEach((value, index) => assert.ok(Math.abs(actualValue[index] - value) < tolerance, `${key}[${index}] changed across locales`));
    } else {
      assert.ok(Math.abs(actualValue - expectedValue) < tolerance, `${key} changed from ${expectedValue} to ${actualValue}`);
    }
  }
}
