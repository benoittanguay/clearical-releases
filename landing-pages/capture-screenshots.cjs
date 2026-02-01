const { chromium } = require('playwright');

async function captureScreenshots() {
  const browser = await chromium.launch();
  const pages = ['freelancers', 'consultants', 'jira-tempo', 'developers'];

  for (const pageName of pages) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    const filePath = `file:///Users/benoittanguay/Documents/Anti/TimePortal/landing-pages/${pageName}.html`;
    await page.goto(filePath, { waitUntil: 'networkidle' });

    // Wait for animations to settle
    await page.waitForTimeout(2000);

    // Full page screenshot
    await page.screenshot({
      path: `/Users/benoittanguay/Documents/Anti/TimePortal/landing-pages/screenshots/${pageName}-full.png`,
      fullPage: true
    });

    // Hero section screenshot
    await page.screenshot({
      path: `/Users/benoittanguay/Documents/Anti/TimePortal/landing-pages/screenshots/${pageName}-hero.png`,
      clip: { x: 0, y: 0, width: 1440, height: 900 }
    });

    console.log(`Captured: ${pageName}`);
    await page.close();
  }

  await browser.close();
  console.log('All screenshots captured!');
}

captureScreenshots().catch(console.error);
