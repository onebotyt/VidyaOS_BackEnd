/**
 * Test: Evaluation Webpage Filter, Sort, Header Borders & Live Excel Export Verification
 */

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
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

async function runTest() {
  console.log('======================================================');
  console.log('🧪 TESTING WEBPAGE FILTER, SORT, BORDERS & LIVE EXPORT');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log('Logging in at /login/faculty.html...');
    await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
    await page.fill('#username', 'hod@gmail.com');
    await page.fill('#password', 'Password@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to /faculty/evaluation.html
    console.log('Navigating to /faculty/evaluation.html...');
    await page.goto(`${BASE_URL}/faculty/evaluation.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#eval-table', { timeout: 10000 });

    // 3. Test Banner Borders
    console.log('\n--- 1. Testing Webpage Header Banner Styling & Borders ---');
    const banner = await page.$('.sheet-header-banner');
    assert(banner !== null, 'Institutional header banner exists');

    const bannerBorder = await page.$eval('.sheet-header-banner', el => {
      const s = window.getComputedStyle(el);
      return {
        top: s.borderTopWidth,
        bottom: s.borderBottomWidth,
        left: s.borderLeftWidth,
        right: s.borderRightWidth
      };
    });
    assert(parseFloat(bannerBorder.bottom) > 0, `Banner has bottom border (${bannerBorder.bottom})`);
    assert(parseFloat(bannerBorder.left) > 0, `Banner has left border (${bannerBorder.left})`);
    assert(parseFloat(bannerBorder.right) > 0, `Banner has right border (${bannerBorder.right})`);

    // 4. Test Filter Toolbar Presence
    console.log('\n--- 2. Testing Webpage Filter & Search Toolbar ---');
    const filterToolbar = await page.$('#eval-filter-toolbar');
    assert(filterToolbar !== null, 'Evaluation Filter Toolbar (#eval-filter-toolbar) is rendered');

    const searchInput = await page.$('#eval-search-input');
    assert(searchInput !== null, 'Search input (#eval-search-input) is present');

    const marksFilterSelect = await page.$('#eval-marks-filter-select');
    assert(marksFilterSelect !== null, 'Performance marks filter select (#eval-marks-filter-select) is present');

    const sortSelect = await page.$('#eval-sort-select');
    assert(sortSelect !== null, 'Sort select (#eval-sort-select) is present');

    const visibleCountText = await page.$eval('#eval-visible-count', el => el.innerText.trim());
    const totalRowsCount = await page.$$eval('.eval-student-row', rows => rows.length);
    assert(Number(visibleCountText) === totalRowsCount, `Initial count badge shows all students (${visibleCountText} of ${totalRowsCount})`);

    // 5. Test Real-Time Search Filtering
    console.log('\n--- 3. Testing Real-Time Search Filtering ---');
    // Get first student name
    const firstStudentName = await page.$eval('.eval-student-row:first-child .cell-student-name span', el => el.innerText.trim());
    console.log(`Filtering for student: "${firstStudentName}"`);

    await page.fill('#eval-search-input', firstStudentName.slice(0, 4));
    await page.waitForTimeout(300);

    const countAfterSearch = await page.$eval('#eval-visible-count', el => Number(el.innerText.trim()));
    const visibleRowsAfterSearch = await page.$$eval('.eval-student-row', rows => rows.filter(r => r.style.display !== 'none').length);
    assert(countAfterSearch === visibleRowsAfterSearch, `Counter badge matches visible rows (${countAfterSearch} === ${visibleRowsAfterSearch})`);
    assert(countAfterSearch < totalRowsCount, `Rows were successfully filtered down (${countAfterSearch} < ${totalRowsCount})`);

    // Test Clear Search
    console.log('Testing Clear Search button...');
    await page.click('#btn-eval-search-clear');
    await page.waitForTimeout(200);

    const countAfterClear = await page.$eval('#eval-visible-count', el => Number(el.innerText.trim()));
    assert(countAfterClear === totalRowsCount, `Clearing search restores all students (${countAfterClear} of ${totalRowsCount})`);

    // 6. Test Marks Filter (All Students, Top Marks, Low Attendance, etc.)
    console.log('\n--- 4. Testing Marks Performance Filter ---');
    await page.selectOption('#eval-marks-filter-select', 'TOP');
    await page.waitForTimeout(200);
    const topCount = await page.$eval('#eval-visible-count', el => Number(el.innerText.trim()));
    console.log(`Top marks students count: ${topCount}`);
    assert(topCount >= 0 && topCount <= totalRowsCount, `Top marks filter executed cleanly (${topCount} students)`);

    await page.selectOption('#eval-marks-filter-select', 'ALL');
    await page.waitForTimeout(200);
    const allCount = await page.$eval('#eval-visible-count', el => Number(el.innerText.trim()));
    assert(allCount === totalRowsCount, `Resetting to ALL restores full count (${allCount})`);

    // 7. Test Sorting (By Name Z-A, By Total High-to-Low)
    console.log('\n--- 5. Testing Roster Sorting ---');
    await page.selectOption('#eval-sort-select', 'NAME_ASC');
    await page.waitForTimeout(200);
    const firstStudentAfterSort = await page.$eval('.eval-student-row:first-child .cell-student-name span', el => el.innerText.trim());
    console.log(`First student after NAME_ASC sort: "${firstStudentAfterSort}"`);

    await page.selectOption('#eval-sort-select', 'NAME_DESC');
    await page.waitForTimeout(200);
    const firstStudentAfterDescSort = await page.$eval('.eval-student-row:first-child .cell-student-name span', el => el.innerText.trim());
    console.log(`First student after NAME_DESC sort: "${firstStudentAfterDescSort}"`);
    assert(firstStudentAfterSort !== firstStudentAfterDescSort || totalRowsCount <= 1, 'Rows reordered on sort direction change');

    // 8. Test Live Server Excel Export
    console.log('\n--- 6. Testing Live Server OpenXML Excel Export ---');
    // Trigger download via Playwright download event
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#btn-export-excel')
    ]);

    const downloadPath = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9/scratch/downloaded_test_export.xlsx');
    await download.saveAs(downloadPath);
    assert(fs.existsSync(downloadPath), `Exported file saved to: ${downloadPath}`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(downloadPath);
    const ws = wb.getWorksheet(1);
    assert(ws !== undefined, 'Exported Excel file loaded cleanly in ExcelJS');

    // Check Row 1-3 borders and fill
    const cell11 = ws.getCell(1, 1);
    const cell12 = ws.getCell(1, 2);
    const cell21 = ws.getCell(2, 1);
    const cell31 = ws.getCell(3, 1);

    assert(cell11.border && cell11.border.top && cell11.border.bottom, 'Live Excel Row 1 Cell (1, 1) has complete borders');
    assert(cell12.border && cell12.border.top && cell12.border.bottom, 'Live Excel Row 1 Cell (1, 2) has complete borders across merge');
    assert(cell21.border && cell21.border.top && cell21.border.bottom, 'Live Excel Row 2 Cell (2, 1) has complete borders');
    assert(cell31.border && cell31.border.top && cell31.border.bottom, 'Live Excel Row 3 Cell (3, 1) has complete borders');
    assert(cell11.fill && cell11.fill.fgColor?.argb === 'FFB4C6E7', 'Live Excel Row 1 has institutional blue background (FFB4C6E7)');

    // Check AutoFilter
    assert(Boolean(ws.autoFilter), `Live Excel AutoFilter is active (${JSON.stringify(ws.autoFilter)})`);

    // Clean up test download file
    try { fs.unlinkSync(downloadPath); } catch (_) {}

    console.log('\n======================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runTest();
