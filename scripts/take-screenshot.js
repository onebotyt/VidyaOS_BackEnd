const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  await page.goto('http://localhost:3000/admin/academic-structure.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const outPath = path.resolve(__dirname, 'admin-academic-structure-updated.png');
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('Screenshot saved to:', outPath);

  await browser.close();
})();
