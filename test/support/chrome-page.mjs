import puppeteer from 'puppeteer-core';

export async function withChromePage({ url, viewport = { width: 800, height: 600 }, initScript }, run) {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: viewport,
    ...(process.env.DOMSHOT_CHROME_PATH
      ? { executablePath: process.env.DOMSHOT_CHROME_PATH }
      : { channel: 'chrome' }),
  });

  try {
    const [page] = await browser.pages();
    await page.setViewport(viewport);
    if (initScript) await page.evaluateOnNewDocument(initScript);
    await page.goto(url, { waitUntil: 'load' });
    const cdp = await page.createCDPSession();
    return await run({
      evaluate: (expression) => page.evaluate(expression),
      hover: (selector) => page.hover(selector),
      setPageScale: (pageScaleFactor) => cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor }),
      nextFrames: (count = 2) => page.evaluate((frameCount) => new Promise((resolve) => {
        let remaining = frameCount;
        const next = () => remaining-- > 1 ? requestAnimationFrame(next) : resolve();
        requestAnimationFrame(next);
      }), count),
      waitUntil: async (expression, failureMessage, { attempts = 200, interval = 25 } = {}) => {
        try {
          await page.waitForFunction(expression, { polling: interval, timeout: attempts * interval });
        } catch {
          throw new Error(failureMessage);
        }
      },
    });
  } finally {
    await browser.close();
  }
}
