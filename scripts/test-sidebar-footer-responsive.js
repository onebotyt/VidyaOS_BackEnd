const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  console.log('=================================================================');
  console.log('🧪 COMPREHENSIVE RESPONSIVE SIDEBAR & FOOTER TEST SUITE');
  console.log('=================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // ─────────────────────────────────────────────────────────────
  // 1. DESKTOP PC VIEWPORT TEST (Admin Console)
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Testing Desktop PC Viewport (1280x720) ---');
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto('http://localhost:3000/admin/academic-structure.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const desktopOpen = await page.evaluate(() => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.querySelector('main');
    const footer = document.querySelector('.app-footer');
    const mobileNav = document.querySelector('.mobile-bottom-nav');
    const rolePill = document.querySelector('.sidebar-role-pill');
    const avatar = document.querySelector('.sidebar-avatar');
    const userName = document.querySelector('.sidebar-user-name');
    const userEmail = document.querySelector('.sidebar-user-email');
    const closeBtn = document.querySelector('.sidebar-close-btn');

    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : null,
      mainMarginLeft: main ? window.getComputedStyle(main).marginLeft : null,
      mainLeft: main ? main.getBoundingClientRect().left : null,
      footerVisible: footer ? window.getComputedStyle(footer).display !== 'none' : false,
      mobileNavVisible: mobileNav ? window.getComputedStyle(mobileNav).display !== 'none' : false,
      rolePillText: rolePill ? rolePill.textContent.trim() : null,
      avatarText: avatar ? avatar.querySelector('span')?.textContent.trim() : null,
      userNameText: userName ? userName.textContent.trim() : null,
      userEmailText: userEmail ? userEmail.textContent.trim() : null,
      hasCloseBtn: !!closeBtn
    };
  });

  console.log('Desktop Open Status:', desktopOpen);
  assert(desktopOpen.sidebarOpen === true, 'Sidebar starts open on desktop');
  assert(desktopOpen.sidebarWidth === 260, 'Sidebar width is exactly 260px on desktop');
  assert(desktopOpen.mainMarginLeft === '260px', 'Main content margin-left is 260px');
  assert(desktopOpen.mainLeft === 260, 'Main content starts at x=260px (zero overlap)');
  assert(desktopOpen.footerVisible === false, 'Page footer (.app-footer) is hidden on PC desktop');
  assert(desktopOpen.mobileNavVisible === false, 'Mobile bottom nav is hidden on desktop');
  assert(desktopOpen.avatarText === 'SA', 'Executive avatar renders initials "SA"');
  assert(desktopOpen.rolePillText === 'SYSTEM_ADMIN', 'Profile card displays role badge');
  assert(desktopOpen.hasCloseBtn === true, 'Close button exists in profile card');
  console.log('✓ PASS: Desktop PC sidebar open & footer hidden verified.');

  await page.screenshot({ path: path.join(__dirname, 'desktop-sidebar-open.png') });

  // Test Desktop Toggle Close
  console.log('\n--- 2. Testing Desktop Toggle Close ---');
  await page.click('#sidebar-toggle-btn');
  await page.waitForTimeout(400);

  const desktopClosed = await page.evaluate(() => {
    const main = document.querySelector('main');
    const footer = document.querySelector('.app-footer');
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      mainMarginLeft: window.getComputedStyle(main).marginLeft,
      mainMarginRight: window.getComputedStyle(main).marginRight,
      mainLeft: main.getBoundingClientRect().left,
      mainWidth: main.getBoundingClientRect().width,
      footerVisible: footer ? window.getComputedStyle(footer).display !== 'none' : false
    };
  });

  console.log('Desktop Closed Status:', desktopClosed);
  assert(desktopClosed.sidebarOpen === false, 'Sidebar is closed');
  // On 1280px viewport with 1200px max-width container, margins are equal: (1280-1200)/2 = 40px
  assert(desktopClosed.mainMarginLeft === desktopClosed.mainMarginRight, 'Main content margins are symmetric and centered');
  assert(desktopClosed.mainLeft === 40, 'Main content starts at x=40px (symmetrically centered in 1280px viewport)');
  assert(desktopClosed.mainWidth === 1200, 'Main content retains full container width');
  assert(desktopClosed.footerVisible === false, 'Footer remains hidden on PC when closed');
  console.log('✓ PASS: Desktop collapse centering mechanics verified.');

  await page.screenshot({ path: path.join(__dirname, 'desktop-sidebar-closed.png') });

  // Test Inner Close Button
  console.log('\n--- 3. Testing Desktop Inner Close Button (✕) ---');
  await page.click('#sidebar-toggle-btn'); // Re-open
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.body.classList.contains('sidebar-open')) === true);

  await page.click('.sidebar-close-btn'); // Close via inner button
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.body.classList.contains('sidebar-open')) === false);
  console.log('✓ PASS: Inner close button (✕) closes sidebar cleanly.');

  // ─────────────────────────────────────────────────────────────
  // 4. MOBILE PHONE VIEWPORT TEST (375x812 - iPhone 13)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Mobile Viewport (375x812 - iPhone 13) ---');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const mobileStatus = await page.evaluate(() => {
    const sidebar = document.getElementById('app-sidebar');
    const mobileNav = document.querySelector('.mobile-bottom-nav');
    const footer = document.querySelector('.app-footer');
    const navItems = Array.from(document.querySelectorAll('.mobile-nav-item')).map(el => ({
      label: el.querySelector('.mobile-nav-label')?.textContent.trim(),
      active: el.classList.contains('active')
    }));

    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      mobileNavVisible: mobileNav ? window.getComputedStyle(mobileNav).display !== 'none' : false,
      mobileNavTabs: navItems,
      bodyPaddingBottom: window.getComputedStyle(document.body).paddingBottom,
      footerExists: !!footer
    };
  });

  console.log('Mobile Status:', mobileStatus);
  assert(mobileStatus.sidebarOpen === false, 'Mobile drawer starts closed');
  assert(mobileStatus.mobileNavVisible === true, 'Mobile bottom nav (.mobile-bottom-nav) is visible');
  assert(mobileStatus.mobileNavTabs.length === 4, 'Mobile bottom nav has 4 ergonomic tabs');
  assert(mobileStatus.mobileNavTabs[1].label === 'Structure', 'Structure tab present in bottom nav');
  assert(mobileStatus.mobileNavTabs[1].active === true, 'Structure tab active on academic-structure.html');
  assert(mobileStatus.mobileNavTabs[3].label === 'Menu', 'Menu tab trigger present in bottom nav');
  console.log('✓ PASS: Mobile bottom navigation verified.');

  await page.screenshot({ path: path.join(__dirname, 'mobile-viewport-normal.png') });

  // Tap "Menu" tab to open mobile drawer
  console.log('\n--- 5. Testing Mobile Drawer Open via Bottom Nav "Menu" ---');
  const menuBtn = await page.$('.mobile-nav-item:last-child');
  await menuBtn.click();
  await page.waitForTimeout(400);

  const mobileDrawerOpen = await page.evaluate(() => {
    const backdrop = document.getElementById('sidebar-backdrop');
    const sidebar = document.getElementById('app-sidebar');
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      sidebarWidth: sidebar.getBoundingClientRect().width,
      backdropActive: backdrop.classList.contains('active'),
      backdropPointerEvents: window.getComputedStyle(backdrop).pointerEvents
    };
  });

  console.log('Mobile Drawer Open Status:', mobileDrawerOpen);
  assert(mobileDrawerOpen.sidebarOpen === true, 'Mobile drawer is open');
  assert(mobileDrawerOpen.backdropActive === true, 'Mobile backdrop is active');
  assert(mobileDrawerOpen.backdropPointerEvents === 'auto', 'Backdrop accepts touch events');
  console.log('✓ PASS: Mobile drawer opened with active backdrop.');

  await page.screenshot({ path: path.join(__dirname, 'mobile-drawer-open.png') });

  // Tap visible backdrop (at x=340 outside the drawer)
  console.log('\n--- 6. Testing Mobile Backdrop Dismiss ---');
  await page.click('#sidebar-backdrop', { position: { x: 340, y: 300 } });
  await page.waitForTimeout(400);

  const mobileDrawerClosed = await page.evaluate(() => {
    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      backdropActive: document.getElementById('sidebar-backdrop').classList.contains('active')
    };
  });

  console.log('Mobile Drawer Closed Status:', mobileDrawerClosed);
  assert(mobileDrawerClosed.sidebarOpen === false, 'Mobile drawer closed via backdrop tap');
  assert(mobileDrawerClosed.backdropActive === false, 'Backdrop deactivated');
  console.log('✓ PASS: Mobile backdrop dismiss verified.');

  // ─────────────────────────────────────────────────────────────
  // 7. FACULTY & REGISTERS WORKSPACE INTEGRATION TEST
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Testing Faculty Registers Workspace ---');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'teacher@gmail.com');
  await page.fill('#password', 'Password@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto('http://localhost:3000/faculty/registers.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const facultyData = await page.evaluate(() => {
    const sidebar = document.getElementById('app-sidebar');
    const footer = document.querySelector('.app-footer');
    const rolePill = document.querySelector('.sidebar-role-pill');
    const activeItem = document.querySelector('.sidebar-item.active');

    return {
      sidebarOpen: document.body.classList.contains('sidebar-open'),
      rolePillText: rolePill ? rolePill.textContent.trim() : null,
      activeNavText: activeItem ? activeItem.textContent.trim() : null,
      footerVisible: footer ? window.getComputedStyle(footer).display !== 'none' : false
    };
  });

  console.log('Faculty Registers Status:', facultyData);
  assert(facultyData.footerVisible === false, 'Institutional footer is hidden on desktop on registers.html');
  assert(facultyData.activeNavText.includes('Registers'), 'Registers active in faculty sidebar');
  console.log('✓ PASS: Faculty registers workspace integration verified.');

  // Capture scrolled page footer screenshot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'desktop-page-footer.png') });
  console.log('✓ Saved desktop-page-footer.png');

  await browser.close();

  console.log('\n=================================================================');
  console.log('🏁 ALL RESPONSIVE SIDEBAR & FOOTER TESTS PASSED SUCCESSFULLY!');
  console.log('=================================================================');
})();
