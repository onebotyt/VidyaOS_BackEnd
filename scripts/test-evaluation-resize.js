const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:3000';

async function runEvaluationResizeTest() {
  console.log('======================================================');
  console.log('🧪 TESTING EXCEL CONTROLS, COLUMN RESIZING & ZOOM');
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

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

    // 3. Verify Sheet View Controls in Footer Status Bar (Font & Reset Widths)
    console.log('\n--- 1. Testing Sheet View Controls in Footer Status Bar ---');
    const viewControls = await page.$('#excel-view-controls');
    assert(viewControls !== null, 'Sheet View Controls container exists in footer status bar');

    const fontScaleInit = await page.$eval('#sheet-font-scale-display', el => el.innerText.trim());
    assert(fontScaleInit === '100%', `Initial font scale display is 100% (got: ${fontScaleInit})`);

    const resetWidthsBtn = await page.$('#btn-reset-widths');
    assert(resetWidthsBtn !== null, 'Reset Widths button exists');

    // 4. Verify Consolidated Status Bar Zoom Slider Controls & Automatic Auto-Fit
    console.log('\n--- 2. Testing Consolidated Status Bar Zoom Controls & Automatic Auto-Fit ---');
    const zoomSlider = await page.$('#zoom-slider');
    assert(zoomSlider !== null, 'Interactive Zoom Slider exists in status bar');

    const sliderVal = await page.$eval('#zoom-slider', el => el.value);
    const zoomStatusDisp = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(parseInt(sliderVal, 10) >= 50 && parseInt(sliderVal, 10) <= 125, `Automatic auto-fit calculated optimal initial slider zoom: ${sliderVal}%`);
    assert(zoomStatusDisp.endsWith('%'), `Status bar zoom display formatted properly: ${zoomStatusDisp}`);

    // Reset zoom to 100% baseline for increment/decrement testing
    await page.click('#zoom-status-display');
    await page.waitForTimeout(200);

    // 5. Test Zoom In / Zoom Out Functionality
    console.log('\n--- 3. Testing Zoom In / Zoom Out ---');
    // Zoom in via button
    await page.click('button[title="Zoom In (Ctrl +)"]');
    await page.waitForTimeout(200);
    const zoomedInVal = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(zoomedInVal === '110%', `Clicking Zoom In sets zoom to 110% (got: ${zoomedInVal})`);

    const tableZoom = await page.$eval('#eval-table', el => el.style.zoom);
    assert(tableZoom === '1.1', `Table CSS zoom property updated to 1.1 (got: ${tableZoom})`);

    // Zoom out twice
    await page.click('button[title="Zoom Out (Ctrl -)"]');
    await page.waitForTimeout(200);
    await page.click('button[title="Zoom Out (Ctrl -)"]');
    await page.waitForTimeout(200);
    const zoomedOutVal = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(zoomedOutVal === '90%', `Clicking Zoom Out sets zoom to 90% (got: ${zoomedOutVal})`);

    // Reset zoom to 100%
    await page.click('#zoom-status-display');
    await page.waitForTimeout(200);
    const resetZoomVal = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(resetZoomVal === '100%', `Clicking display resets zoom to 100% (got: ${resetZoomVal})`);

    // Fit to Window test
    await page.click('button[title="Fit sheet to screen width"]');
    await page.waitForTimeout(300);
    const fitZoomVal = await page.$eval('#zoom-status-display', el => el.innerText.trim());
    assert(fitZoomVal.length > 0 && fitZoomVal.endsWith('%'), `Fit to window calculated optimal zoom: ${fitZoomVal}`);

    // Reset back to 100%
    await page.click('#zoom-status-display');
    await page.waitForTimeout(200);

    // 6. Test Font Scale Controls
    console.log('\n--- 4. Testing Font Scaling Controls ---');
    await page.click('button[title="Increase font size"]');
    await page.waitForTimeout(200);
    const fontScaleDisp = await page.$eval('#sheet-font-scale-display', el => el.innerText.trim());
    assert(fontScaleDisp === '110%', `Clicking A+ sets font scale to 110% (got: ${fontScaleDisp})`);

    const vpFontScale = await page.$eval('.excel-sheet-viewport', el => getComputedStyle(el).getPropertyValue('--sheet-font-scale').trim());
    assert(vpFontScale === '1.1', `Viewport --sheet-font-scale CSS variable is 1.1 (got: ${vpFontScale})`);

    // Reset font scale
    await page.click('#sheet-font-scale-display');
    await page.waitForTimeout(200);
    const resetFontScale = await page.$eval('#sheet-font-scale-display', el => el.innerText.trim());
    assert(resetFontScale === '100%', `Clicking font display resets to 100% (got: ${resetFontScale})`);

    // 7. Verify Column Colgroup and Elimination of Resizer Handles
    console.log('\n--- 5. Testing Elimination of Resizer Handles & Column Menu Buttons ---');
    const colgroupCols = await page.$$('#eval-colgroup col');
    assert(colgroupCols.length >= 17, `Colgroup contains all leaf columns (found: ${colgroupCols.length})`);

    const resizers = await page.$$('.col-resizer');
    assert(resizers.length === 0, `Col-resizer handles completely eliminated from DOM (found: ${resizers.length})`);

    const menuBtns = await page.$$('.btn-col-menu');
    assert(menuBtns.length === 0, `Column menu buttons (.btn-col-menu) completely eliminated (found: ${menuBtns.length})`);

    const popover = await page.$('#col-popover-menu');
    assert(popover === null, 'Column popover menu completely eliminated from DOM');

    // 8. Test Double-Click on TH for Auto-Fit
    console.log('\n--- 6. Testing Double-Click on TH for Auto-Fit ---');
    const rollTh = await page.$('th[data-col-idx="0"]');
    assert(rollTh !== null, 'Found Roll No column header');
    await rollTh.dblclick();
    await page.waitForTimeout(300);
    const autoFitWidth = await page.$eval('#eval-col-0', el => parseFloat(el.style.width));
    console.log(`Auto-fitted Roll No width: ${autoFitWidth}px`);
    assert(autoFitWidth >= 40, `Auto-fitted width is valid: ${autoFitWidth}px`);

    // 9. Test Reset Widths
    console.log('\n--- 7. Testing Reset Widths Button ---');
    await page.click('#btn-reset-widths');
    await page.waitForTimeout(300);
    const resetRollWidth = await page.$eval('#eval-col-0', el => parseFloat(el.style.width));
    assert(resetRollWidth === 70, `Reset Widths restored Roll No column default width to 70px (got: ${resetRollWidth}px)`);

    // 10. Test Editable Column Headers in Edit Mode
    console.log('\n--- 8. Testing Editable Column Headers in Edit Mode ---');
    await page.click('#btn-toggle-edit'); // Enter Edit Mode
    await page.waitForTimeout(300);

    const thInputs = await page.$$('#eval-table thead .sheet-th-input');
    assert(thInputs.length >= 8, `Table headers display editable inputs in Edit Mode (found: ${thInputs.length})`);

    const subInputs = await page.$$('#eval-table thead .sheet-th-sub-input');
    assert(subInputs.length >= 5, `Secondary subheaders display editable sub-inputs in Edit Mode (found: ${subInputs.length})`);

    // 11. Test 2-Click Save Modal
    console.log('\n--- 9. Testing 2-Click Save Modal ---');
    await page.click('#btn-toggle-edit'); // Click 1: Click Save
    await page.waitForTimeout(300);

    const isSaveModalOpen = await page.isVisible('#save-confirm-modal');
    assert(isSaveModalOpen, 'Click 1 on Save button opens #save-confirm-modal');

    await page.click('#btn-confirm-save', { force: true }); // Click 2: Confirm save
    await page.waitForTimeout(400);

    const isSaveModalClosed = !(await page.isVisible('#save-confirm-modal'));
    assert(isSaveModalClosed, 'Click 2 on Confirm Save closes modal and locks view');

    const editBtnText = await page.$eval('#btn-toggle-edit', el => el.innerText.trim());
    assert(editBtnText.includes('Edit'), `Spreadsheet returned to View Mode ("${editBtnText}")`);

    // 12. Test 2-Click Cancel Modal
    console.log('\n--- 10. Testing 2-Click Cancel Modal ---');
    await page.click('#btn-toggle-edit'); // Enter Edit Mode
    await page.waitForTimeout(300);

    await page.click('#btn-cancel-edit'); // Click 1: Click Cancel
    await page.waitForTimeout(300);

    const isCancelModalOpen = await page.isVisible('#cancel-confirm-modal');
    assert(isCancelModalOpen, 'Click 1 on Cancel button opens #cancel-confirm-modal');

    await page.click('#btn-confirm-cancel', { force: true }); // Click 2: Confirm discard
    await page.waitForTimeout(400);

    const isCancelModalClosed = !(await page.isVisible('#cancel-confirm-modal'));
    assert(isCancelModalClosed, 'Click 2 on Discard & Exit closes modal and reverts edits');

    // Screenshot of final spreadsheet
    await page.screenshot({ path: 'evaluation_excel_controls_verified.png' });
    console.log('📸 Screenshot saved to evaluation_excel_controls_verified.png');

  } catch (err) {
    assert(false, `Unexpected error during test execution: ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');
  if (failed > 0) process.exit(1);
}

runEvaluationResizeTest();
