const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  
  // Test on standard laptop 1280x720
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  await page.goto('http://localhost:3000/admin/faculty.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Click '+ Create HOD Account'
  await page.click('#create-hod-btn');
  await page.waitForTimeout(400);

  const shotPath = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/create-hod-modal-updated.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('Saved screenshot:', shotPath);

  // Measure card bounding box vs viewport on 1280x720
  const bbox = await page.evaluate(() => {
    const card = document.querySelector('#create-modal .modal-card');
    const r = card.getBoundingClientRect();
    const empid = document.getElementById('hod-empid');
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      windowHeight: window.innerHeight,
      fitsInsideScreen: r.top >= 0 && r.bottom <= window.innerHeight,
      hasEmployeeIdField: !!empid
    };
  });
  console.log('1280x720 Card Metrics:', bbox);
  assert(!bbox.hasEmployeeIdField, 'Employee ID field is removed from DOM');
  assert(bbox.fitsInsideScreen, 'Modal card fits completely inside screen on 1280x720');

  // Test on small 1024x600 screen
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.waitForTimeout(300);
  const bboxSmall = await page.evaluate(() => {
    const card = document.querySelector('#create-modal .modal-card');
    const r = card.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      windowHeight: window.innerHeight,
      fitsInsideScreen: r.top >= 0 && r.bottom <= window.innerHeight
    };
  });
  console.log('1024x600 Card Metrics:', bboxSmall);
  assert(bboxSmall.fitsInsideScreen, 'Modal card fits completely inside screen on 1024x600');

  const smallShotPath = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/create-hod-modal-small-viewport.png');
  await page.screenshot({ path: smallShotPath, fullPage: false });
  console.log('Saved small viewport screenshot:', smallShotPath);

  // Test on mobile 375x667 screen
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  const bboxMobile = await page.evaluate(() => {
    const card = document.querySelector('#create-modal .modal-card');
    const r = card.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      windowHeight: window.innerHeight,
      fitsInsideScreen: r.top >= 0 && r.bottom <= window.innerHeight
    };
  });
  console.log('375x667 Mobile Card Metrics:', bboxMobile);
  assert(bboxMobile.fitsInsideScreen, 'Modal card fits completely inside screen on mobile 375x667');

  const mobileShotPath = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/create-hod-modal-mobile.png');
  await page.screenshot({ path: mobileShotPath, fullPage: false });
  console.log('Saved mobile screenshot:', mobileShotPath);

  console.log('✅ ALL MODAL VIEWPORT AND METRIC CHECKS PASSED!');
  await browser.close();
})();
