const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  console.log('1. Navigating to login...');
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });

  console.log('2. Filling credentials...');
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(1500);

  console.log('3. Navigating to academic-structure.html...');
  await page.goto('http://localhost:3000/admin/academic-structure.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Take open screenshot
  await page.screenshot({ path: 'academic-structure-open.png' });
  console.log('4. Saved academic-structure-open.png');

  // Click toggle button to CLOSE sidebar
  console.log('5. Clicking toggle button to CLOSE sidebar...');
  await page.click('#sidebar-toggle-btn');
  await page.waitForTimeout(400);

  const closedData = await page.evaluate(() => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.querySelector('main');
    return {
      bodyClass: document.body.className,
      sidebarClass: sidebar ? sidebar.className : null,
      mainMarginLeft: main ? window.getComputedStyle(main).marginLeft : null,
      mainLeft: main ? main.getBoundingClientRect().left : null,
      mainWidth: main ? main.getBoundingClientRect().width : null
    };
  });
  console.log('Closed data:', closedData);
  await page.screenshot({ path: 'academic-structure-closed.png' });
  console.log('6. Saved academic-structure-closed.png');

  // Click toggle button to REOPEN sidebar
  console.log('7. Clicking toggle button to REOPEN sidebar...');
  await page.click('#sidebar-toggle-btn');
  await page.waitForTimeout(400);

  const reopenedData = await page.evaluate(() => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.querySelector('main');
    return {
      bodyClass: document.body.className,
      sidebarClass: sidebar ? sidebar.className : null,
      mainMarginLeft: main ? window.getComputedStyle(main).marginLeft : null,
      mainLeft: main ? main.getBoundingClientRect().left : null,
      mainWidth: main ? main.getBoundingClientRect().width : null
    };
  });
  console.log('Reopened data:', reopenedData);

  // Click the 'X' button inside the sidebar
  console.log('9. Clicking X button inside sidebar to close...');
  await page.click('.sidebar-close-btn');
  await page.waitForTimeout(400);

  const closedViaXData = await page.evaluate(() => {
    return {
      bodyClass: document.body.className,
      sidebarClass: document.getElementById('app-sidebar')?.className,
      mainMarginLeft: window.getComputedStyle(document.querySelector('main')).marginLeft
    };
  });
  console.log('Closed via X button data:', closedViaXData);

  // 10. Test Mobile Viewport (375x812 - iPhone)
  console.log('10. Testing mobile viewport (375x812)...');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const mobileInitial = await page.evaluate(() => {
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      mainMarginLeft: window.getComputedStyle(document.querySelector('main')).marginLeft
    };
  });
  console.log('Mobile initial (should be closed):', mobileInitial);

  // Open sidebar on mobile
  await page.click('#sidebar-toggle-btn');
  await page.waitForTimeout(300);

  const mobileOpen = await page.evaluate(() => {
    const backdrop = document.getElementById('sidebar-backdrop');
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      backdropActive: backdrop?.classList.contains('active'),
      mainMarginLeft: window.getComputedStyle(document.querySelector('main')).marginLeft
    };
  });
  console.log('Mobile open (overlay + active backdrop, 0px margin):', mobileOpen);

  // Click visible area of backdrop (at x=330, outside the 280px sidebar) to close
  await page.click('#sidebar-backdrop', { position: { x: 330, y: 300 } });
  await page.waitForTimeout(300);

  const mobileClosedBackdrop = await page.evaluate(() => {
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open')
    };
  });
  console.log('Mobile closed after backdrop tap:', mobileClosedBackdrop);

  await browser.close();
})();
