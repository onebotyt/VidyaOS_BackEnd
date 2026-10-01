const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9');

async function testStickyLayout() {
  console.log('======================================================');
  console.log('🧪 VERIFYING STICKY HEADER, PINNED FOOTER & SCROLLABLE RECORDS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${msg}`);
      failed++;
    }
  }

  const browser = await chromium.launch({ headless: true });
  const viewportHeight = 850;
  const context = await browser.newContext({ viewport: { width: 1440, height: viewportHeight } });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log('Logging in at /login/faculty.html...');
    await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
    await page.fill('#username', 'hod@gmail.com');
    await page.fill('#password', 'Password@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to /faculty/evaluation.html?id=47
    console.log('Navigating to /faculty/evaluation.html?id=47...');
    await page.goto(`${BASE_URL}/faculty/evaluation.html?id=47`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#eval-table', { timeout: 10000 });
    await page.waitForTimeout(500);

    // 3. Check Initial Geometry
    const initialCmdBar = await page.$eval('#eval-sticky-command-bar', el => el.getBoundingClientRect());
    const initialBanner = await page.$eval('.sheet-header-banner', el => el.getBoundingClientRect());
    const initialVp = await page.$eval('.excel-sheet-viewport', el => el.getBoundingClientRect());
    const initialTh = await page.$eval('#eval-table thead tr:first-child th:first-child', el => el.getBoundingClientRect());
    const initialFooter = await page.$eval('.sheet-statusbar', el => el.getBoundingClientRect());
    const initialWindowScroll = await page.evaluate(() => window.scrollY);

    console.log(`Initial Command Bar Top: ${initialCmdBar.top}px`);
    console.log(`Initial Banner Top: ${initialBanner.top}px, Height: ${initialBanner.height}px`);
    console.log(`Initial Viewport Top: ${initialVp.top}px, Height: ${initialVp.height}px`);
    console.log(`Initial Th Top: ${initialTh.top}px`);
    console.log(`Initial Footer Bottom: ${initialFooter.bottom}px (Viewport Height: ${viewportHeight}px)`);

    assert(initialWindowScroll === 0, `Window vertical scroll is 0 (got: ${initialWindowScroll})`);
    // 3b. Reset zoom to 100% baseline for scrolling and zoom testing
    await page.click('#zoom-status-display');
    await page.waitForTimeout(200);

    // 4. Scroll Records Down by 400px inside .excel-sheet-viewport
    console.log('\n--- Scrolling records down 400px inside .excel-sheet-viewport ---');
    await page.$eval('.excel-sheet-viewport', el => el.scrollTop = 400);
    await page.waitForTimeout(300);

    const scrolledVpScrollTop = await page.$eval('.excel-sheet-viewport', el => el.scrollTop);
    const scrolledWindowScroll = await page.evaluate(() => window.scrollY);
    const scrolledCmdBar = await page.$eval('#eval-sticky-command-bar', el => el.getBoundingClientRect());
    const scrolledBanner = await page.$eval('.sheet-header-banner', el => el.getBoundingClientRect());
    const scrolledTh = await page.$eval('#eval-table thead tr:first-child th:first-child', el => el.getBoundingClientRect());
    const scrolledFooter = await page.$eval('.sheet-statusbar', el => el.getBoundingClientRect());

    assert(scrolledVpScrollTop >= 350, `Viewport successfully scrolled records down (scrollTop: ${scrolledVpScrollTop}px)`);
    assert(scrolledWindowScroll === 0, `Window scroll remains strictly 0 (no outer page scroll)`);
    assert(Math.abs(initialCmdBar.top - scrolledCmdBar.top) <= 1, `Command Bar stays firmly stuck to top (diff: ${Math.abs(initialCmdBar.top - scrolledCmdBar.top)}px)`);
    assert(Math.abs(initialBanner.top - scrolledBanner.top) <= 1, `Department/Session banner stays firmly stuck to top (diff: ${Math.abs(initialBanner.top - scrolledBanner.top)}px)`);
    assert(Math.abs(initialTh.top - scrolledTh.top) <= 1, `Table column header stays sticky at top of viewport (diff: ${Math.abs(initialTh.top - scrolledTh.top)}px)`);
    assert(Math.abs(initialFooter.bottom - scrolledFooter.bottom) <= 1, `Footer status bar stays firmly stuck to bottom (diff: ${Math.abs(initialFooter.bottom - scrolledFooter.bottom)}px)`);

    // 5. Test Zoom Slider remains fully interactive while records are scrolled
    console.log('\n--- Testing footer zoom tool while records are scrolled ---');
    await page.click('button[title="Zoom In (Ctrl +)"]');
    await page.waitForTimeout(200);

    const zoomAfterClick = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(zoomAfterClick === '110%', `Footer zoom tool accessible and updated zoom to 110% (got: ${zoomAfterClick})`);

    // 6. Capture screenshot
    const shotPath = path.join(ARTIFACT_DIR, 'evaluation_sticky_layout_verified.png');
    await page.screenshot({ path: shotPath });
    console.log(`\n📸 Verified screenshot saved to: ${shotPath}`);

  } catch (err) {
    console.error('Test error:', err);
    assert(false, `Unexpected error: ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`STICKY LAYOUT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');
  if (failed > 0) process.exit(1);
}

testStickyLayout();
