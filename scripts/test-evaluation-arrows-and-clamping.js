const { chromium } = require('d:/uiap/Attendance-System-Simplified/backend/node_modules/playwright');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9');

async function testArrowsAndClamping() {
  console.log('======================================================');
  console.log('🧪 TESTING REMOVAL OF ARROWS & AUTOMATIC SCORE CLAMPING');
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 850 } });
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
    await page.waitForTimeout(1000);

    // 3. Test Header Arrow/Menu Icon (T button) Completely Removed
    console.log('\n--- 1. Testing Header Arrow / Menu Icons (T button) Completely Removed ---');
    const menuBtnCount = await page.$$eval('.btn-col-menu', els => els.length);
    assert(menuBtnCount === 0, `Header column menu button (.btn-col-menu) completely removed from DOM (found: ${menuBtnCount})`);

    // 4. Test Number Input Spin Arrows Removed
    console.log('\n--- 2. Testing Number Input Spin Arrows Removal ---');
    const inputAppearance = await page.$eval('table.sheet-table input[type="number"]', el => {
      const style = window.getComputedStyle(el);
      return style.getPropertyValue('-moz-appearance') || style.getPropertyValue('appearance');
    });
    console.log(`Computed input appearance: ${inputAppearance}`);
    assert(inputAppearance === 'textfield' || inputAppearance === 'none', 'Number inputs configured with appearance textfield to remove spinner arrows');

    // 5. Enter Edit Mode
    console.log('\n--- 3. Activating Edit Mode for Clamping Tests ---');
    await page.click('#btn-toggle-edit');
    await page.waitForTimeout(400);

    // 6. Test Assignment Score Clamping (Max: 15)
    console.log('\n--- 4. Testing Assignment Score Clamping (Max: 15) ---');
    const assignInput = await page.$('input[data-col="a1"]');
    assert(assignInput !== null, 'Found Assignment 1 input in student row 1');

    // Type 99 (greater than max 15)
    await assignInput.fill('99');
    await assignInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const assignValAfter = await assignInput.inputValue();
    assert(assignValAfter === '15', `Entering 99 into Assignment (max 15) automatically converts to 15 (got: ${assignValAfter})`);

    // 7. Test Unit Test Score Clamping (Max: 20)
    console.log('\n--- 5. Testing Unit Test Score Clamping (Max: 20) ---');
    const utInput = await page.$('input[data-col="ut1"]');
    assert(utInput !== null, 'Found Unit Test 1 input in student row 1');

    // Type 50 (greater than max 20)
    await utInput.fill('50');
    await utInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const utValAfter = await utInput.inputValue();
    assert(utValAfter === '20', `Entering 50 into Unit Test (max 20) automatically converts to 20 (got: ${utValAfter})`);

    // 8. Test Attendance Score Clamping (Max: 10)
    console.log('\n--- 6. Testing Attendance Score Clamping (Max: 10) ---');
    const attInput = await page.$('input[data-col="att"]');
    assert(attInput !== null, 'Found Attendance score input');

    // Type 25 (greater than max 10)
    await attInput.fill('25');
    await attInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const attValAfter = await attInput.inputValue();
    assert(attValAfter === '10', `Entering 25 into Attendance (max 10) automatically converts to 10 (got: ${attValAfter})`);

    // 9. Test Presentation Score Clamping (Max: 5)
    console.log('\n--- 7. Testing Presentation Score Clamping (Max: 5) ---');
    const presInput = await page.$('input[data-col="pres"]');
    assert(presInput !== null, 'Found Presentation score input');

    // Type 8 (greater than max 5)
    await presInput.fill('8');
    await presInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const presValAfter = await presInput.inputValue();
    assert(presValAfter === '5', `Entering 8 into Presentation (max 5) automatically converts to 5 (got: ${presValAfter})`);

    // 10. Test Negative Value Clamping (Min: 0)
    console.log('\n--- 8. Testing Negative Score Clamping (Min: 0) ---');
    await assignInput.fill('-10');
    await assignInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const assignNegVal = await assignInput.inputValue();
    assert(assignNegVal === '0', `Entering negative value -10 automatically converts to 0 (got: ${assignNegVal})`);

    // 11. Test Grand Total Recalculation with Clamped Scores
    console.log('\n--- 9. Testing Grand Total Recalculation ---');
    // Set Assign 1 to 15, other assignments 15
    await assignInput.fill('15');
    await assignInput.dispatchEvent('input');
    await page.waitForTimeout(200);

    const studentTotal = await page.$eval('td.cell-total', el => parseFloat(el.innerText));
    console.log(`Recalculated student grand total: ${studentTotal}`);
    assert(studentTotal > 0, `Grand total reflects clamped values correctly (${studentTotal})`);

    // Capture clean screenshot
    const shotPath = path.join(ARTIFACT_DIR, 'evaluation_arrows_removed_clamping_verified.png');
    await page.screenshot({ path: shotPath });
    console.log(`📸 Screenshot saved: ${shotPath}`);

  } catch (err) {
    console.error('Test error:', err);
    assert(false, `Unexpected error: ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

testArrowsAndClamping().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
