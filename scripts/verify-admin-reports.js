const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39';
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'admin-reports-enhanced-all-depts.png');

async function verifyReportsPage() {
  console.log('=== STARTING AUTOMATED VERIFICATION: ADMIN DEPARTMENT REPORTS ===\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('   [Browser Console Error]:', msg.text());
    }
  });

  try {
    // 1. Login as Admin
    console.log('[Step 1] Logging in as Admin via /login/faculty.html...');
    await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
    await page.fill('#username', 'admin@gmail.com');
    await page.fill('#password', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to reports.html
    console.log('[Step 2] Navigating to /admin/reports.html...');
    await page.goto('http://localhost:3000/admin/reports.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Allow data fetch and rendering to stabilize

    // 3. Verify Default Selection: All Departments
    console.log('[Step 3] Verifying default filter is All Departments (value="")...');
    const selectedDeptVal = await page.locator('#report-dept').inputValue();
    console.log('   Selected Department dropdown value:', `"${selectedDeptVal}"`);
    if (selectedDeptVal !== '') {
      throw new Error(`Expected #report-dept value to be "" (All Departments), got: "${selectedDeptVal}"`);
    }

    const activeChip = page.locator('#dept-chips-container .dept-chip.active');
    const activeChipText = await activeChip.textContent();
    console.log('   Active Department Chip:', activeChipText.trim());
    if (!activeChipText.includes('All Departments')) {
      throw new Error(`Expected active chip to be All Departments, got: ${activeChipText}`);
    }

    // 4. Verify Institutional KPIs
    console.log('[Step 4] Verifying Institutional KPI Metrics on default load...');
    const scansText = await page.locator('#kpi-scans').textContent();
    const studentsText = await page.locator('#kpi-students').textContent();
    const terminalsText = await page.locator('#kpi-terminals').textContent();
    const todayText = await page.locator('#kpi-today').textContent();

    console.log('   KPI Total Scans:', scansText.trim());
    console.log('   KPI Unique Students:', studentsText.trim());
    console.log('   KPI Active Terminals:', terminalsText.trim());
    console.log('   KPI Today Scans:', todayText.trim());

    if (scansText.trim() === '0') throw new Error('KPI Total Scans should not be 0 by default');
    if (studentsText.trim() === '0') throw new Error('KPI Unique Students should not be 0 by default');
    if (terminalsText.trim() === '0') throw new Error('KPI Active Terminals should not be 0 by default');

    // 5. Verify Trend Chart & Cohort Distribution
    console.log('[Step 5] Verifying Daily Trend Chart and Cohort Distribution...');
    const barCount = await page.locator('#daily-trend-chart .bar-col').count();
    console.log(`   Daily Trend Chart Bars rendered: ${barCount}`);
    if (barCount === 0) throw new Error('Expected daily trend bars to be rendered');

    const cohortCount = await page.locator('#cohort-dist-container .dist-row').count();
    console.log(`   Cohort distribution rows rendered: ${cohortCount}`);
    if (cohortCount === 0) throw new Error('Expected cohort distribution rows');

    // 6. Verify Summary Table
    console.log('[Step 6] Verifying Department Attendance Summary Table...');
    const summaryRows = await page.locator('#table-wrap table tbody tr').count();
    console.log(`   Summary Table Rows rendered: ${summaryRows}`);
    if (summaryRows === 0) throw new Error('Expected summary table to display cohorts');

    const tableText = await page.locator('#table-wrap').textContent();
    if (!tableText.includes('Information Technology')) {
      throw new Error('Expected Information Technology in summary table');
    }
    if (!tableText.includes('ESP32_IT_LAB_01')) {
      throw new Error('Expected ESP32_IT_LAB_01 terminal badge in summary table');
    }
    if (!tableText.includes('HEALTHY')) {
      throw new Error('Expected HEALTHY status badge in summary table');
    }
    console.log('   ✓ Summary table contains Information Technology, ESP32_IT_LAB_01, and HEALTHY status.');

    // 7. Capture Screenshot of Enhanced Page
    console.log('[Step 7] Capturing screenshot of enhanced reports page...');
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`   ✓ Screenshot saved to: ${SCREENSHOT_PATH}`);

    // 8. Test Quick Department Filter Chips
    console.log('[Step 8] Testing Quick Department Filter Chips...');
    const itChip = page.locator('#dept-chips-container .dept-chip:has-text("IT")').first();
    await itChip.click();
    await page.waitForTimeout(500);

    const itDeptVal = await page.locator('#report-dept').inputValue();
    console.log(`   After clicking IT chip, #report-dept value = ${itDeptVal}`);
    if (itDeptVal !== '4') throw new Error(`Expected IT dept value 4, got: ${itDeptVal}`);

    // 9. Reset filters
    console.log('[Step 9] Testing Reset Filters button...');
    await page.click('button:has-text("Reset Filters")');
    await page.waitForTimeout(500);

    const resetDeptVal = await page.locator('#report-dept').inputValue();
    console.log(`   After Reset, #report-dept value = "${resetDeptVal}"`);
    if (resetDeptVal !== '') throw new Error(`Expected reset value "", got: "${resetDeptVal}"`);

    // 10. Test Search Input with Clear Button
    console.log('[Step 10] Testing Search Input and Clear (✕) button...');
    const searchInput = page.locator('#report-search');
    await searchInput.fill('ESP32_IT_LAB_01');
    await page.waitForTimeout(300);

    const clearBtn = page.locator('#clear-search-btn');
    const isClearVisible = await clearBtn.isVisible();
    console.log(`   Clear button visible after typing search: ${isClearVisible}`);
    if (!isClearVisible) throw new Error('Expected clear button to be visible when search has input');

    await clearBtn.click();
    await page.waitForTimeout(300);

    const clearedSearchVal = await searchInput.inputValue();
    console.log(`   Search input value after clicking clear: "${clearedSearchVal}"`);
    if (clearedSearchVal !== '') throw new Error('Expected search input to be cleared');

    console.log('\n======================================================');
    console.log(' ALL ADMIN REPORTS ENHANCEMENT VERIFICATIONS PASSED! 🎉');
    console.log('======================================================\n');

  } finally {
    await browser.close();
  }
}

verifyReportsPage().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
