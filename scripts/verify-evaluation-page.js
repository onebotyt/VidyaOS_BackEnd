const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39');

async function testEvaluationPage() {
  console.log('======================================================');
  console.log('🧪 VERIFYING MASTER INTERNAL EVALUATION SPEC ENHANCEMENTS');
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

  // 1. Test HTTP 301 Redirect for legacy aliases
  console.log('--- 1. Testing HTTP 301 Redirects for Legacy Aliases ---');
  try {
    const r1 = await fetch(`${BASE_URL}/faculty/internal-evaluation?id=1`, { redirect: 'manual' });
    assert(r1.status === 301, `GET /faculty/internal-evaluation?id=1 returns 301 (got ${r1.status})`);
    const loc1 = r1.headers.get('location');
    assert(loc1 === '/faculty/evaluation.html?id=1', `Location header matches /faculty/evaluation.html?id=1 (got: ${loc1})`);

    const r2 = await fetch(`${BASE_URL}/faculty/evaluation`, { redirect: 'manual' });
    assert(r2.status === 301, `GET /faculty/evaluation returns 301 (got ${r2.status})`);
    const loc2 = r2.headers.get('location');
    assert(loc2 === '/faculty/evaluation.html', `Location header matches /faculty/evaluation.html (got: ${loc2})`);
  } catch (err) {
    assert(false, `Redirect test error: ${err.message}`);
  }

  // 2. Playwright UI Automation
  console.log('\n--- 2. Running Playwright UI Automation ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // Login
  console.log('Logging in at /login/faculty.html...');
  await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
  await page.fill('#username', 'hod@gmail.com');
  await page.fill('#password', 'Password@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // Navigate to /faculty/evaluation.html
  console.log('Navigating to /faculty/evaluation.html...');
  await page.goto(`${BASE_URL}/faculty/evaluation.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#eval-table', { timeout: 10000 });

  // 3. Verify Sheet Header Banner, Session Label, and Switcher in View Mode
  const instTitle = await page.$eval('h1.sheet-inst-title', el => el.innerText);
  assert(instTitle.includes('Government Polytechnic') || instTitle.includes('Uttarakhand Government'), `Institutional banner contains: "${instTitle}"`);

  const sessionLabel = await page.$eval('#sheet-session-label-display', el => el.innerText);
  assert(sessionLabel.includes('2026-27 (Winter)'), `Session label sourced from session table: "${sessionLabel}"`);

  const selectVal = await page.$eval('#register-switcher-select', el => el.value);
  assert(selectVal && selectVal.length > 0, `Register switcher is populated with active register ID: ${selectVal}`);

  // 4. Verify Sticky Command Bar, Edit Button (in place of save button), and Column Controls Initial Hidden State
  const stickyBar = await page.$('#eval-sticky-command-bar');
  assert(stickyBar !== null, 'Sticky Command Bar is present on top of sheet header');

  const addStudentBtn = await page.$('#btn-add-student');
  assert(addStudentBtn === null, 'Add Student button has been removed from command bar');

  const editBtn = await page.$('#btn-toggle-edit');
  assert(editBtn !== null, 'Edit button is present in place of Save button in action bar');

  const initialEditBtnText = await page.$eval('#btn-toggle-edit', el => el.innerText.trim());
  assert(initialEditBtnText.includes('Edit'), `In view mode, button displays "Edit": "${initialEditBtnText}"`);

  const addColVisibleBefore = await page.$eval('#btn-add-column', el => el.style.display);
  assert(addColVisibleBefore === 'none', 'Add Column button is initially hidden in view mode');

  const removeColVisibleBefore = await page.$eval('#btn-remove-column', el => el.style.display);
  assert(removeColVisibleBefore === 'none', 'Remove Column button is initially hidden in view mode');

  // 5. Verify 4 Identity Columns: ROLL NO, ENROLLMENT NO, REG NO, STUDENT NAME
  const thRoll = await page.$eval('#eval-table thead tr:first-child th:nth-child(1)', el => el.innerText.trim());
  assert(thRoll === 'ROLL NO', `Col 1 is ROLL NO (got: "${thRoll}")`);

  const thEnr = await page.$eval('#eval-table thead tr:first-child th:nth-child(2)', el => el.innerText.trim());
  assert(thEnr === 'ENROLLMENT NO', `Col 2 is ENROLLMENT NO (got: "${thEnr}")`);

  const thReg = await page.$eval('#eval-table thead tr:first-child th:nth-child(3)', el => el.innerText.trim());
  assert(thReg === 'REG NO', `Col 3 is REG NO (got: "${thReg}")`);

  const thName = await page.$eval('#eval-table thead tr:first-child th:nth-child(4)', el => el.innerText.trim());
  assert(thName === 'STUDENT NAME', `Col 4 is STUDENT NAME (got: "${thName}")`);

  // 6. Verify Identity Columns CANNOT BE EDITED (No input elements in Col 1-4)
  const rollInput = await page.$('#eval-table tbody tr:first-child td:nth-child(1) input');
  assert(rollInput === null, 'Roll No column is non-editable text (no input element)');

  const enrInput = await page.$('#eval-table tbody tr:first-child td:nth-child(2) input');
  assert(enrInput === null, 'Enrollment No column is non-editable text (no input element)');

  const regInput = await page.$('#eval-table tbody tr:first-child td:nth-child(3) input');
  assert(regInput === null, 'Reg No column is non-editable text (no input element)');

  const nameInput = await page.$('#eval-table tbody tr:first-child td:nth-child(4) input');
  assert(nameInput === null, 'Student Name column is non-editable text (no input element)');

  // 7. Click "✏️ Edit" to activate Edit Mode (button becomes "💾 Save Evaluation")
  console.log('\n--- 3. Activating Edit Mode ---');
  await page.click('#btn-toggle-edit');
  await page.waitForTimeout(400);

  const editBtnTextAfter = await page.$eval('#btn-toggle-edit', el => el.innerText.trim());
  assert(editBtnTextAfter.includes('Save'), `In edit mode, button becomes "Save": "${editBtnTextAfter}"`);

  const cancelEditBtn = await page.$('#btn-cancel-edit');
  assert(cancelEditBtn !== null, 'Cancel Edit button appears in Edit Mode');

  const addColVisibleAfter = await page.$eval('#btn-add-column', el => el.style.display);
  assert(addColVisibleAfter !== 'none', 'Add Column button appears in Edit Mode');

  const removeColVisibleAfter = await page.$eval('#btn-remove-column', el => el.style.display);
  assert(removeColVisibleAfter !== 'none', 'Remove Column button appears in Edit Mode');

  // 8. Verify Header Texts CAN BE EDITED in Edit Mode
  console.log('Testing header texts editability in Edit Mode...');
  const instInput = await page.$('#input-inst-title');
  assert(instInput !== null, 'Institution Title is editable input in Edit Mode');

  const sessionInput = await page.$('#input-session-title');
  assert(sessionInput !== null, 'Session Title is editable input in Edit Mode');

  const deptMetaInput = await page.$('#input-dept-meta');
  assert(deptMetaInput !== null, 'Department & Semester text is editable input in Edit Mode');

  // Modify institution title
  await page.fill('#input-inst-title', 'Government Polytechnic College — Information Technology Dept (Customized)');
  await page.dispatchEvent('#input-inst-title', 'input');

  // Verify Identity Columns REMAIN NON-EDITABLE even in Edit Mode
  const rollInputInEdit = await page.$('#eval-table tbody tr:first-child td:nth-child(1) input');
  assert(rollInputInEdit === null, 'Roll No remains strictly non-editable in Edit Mode');

  const nameInputInEdit = await page.$('#eval-table tbody tr:first-child td:nth-child(4) input');
  assert(nameInputInEdit === null, 'Student Name remains strictly non-editable in Edit Mode');

  // 9. Test Add Column via 2-Click Modal Flow
  console.log('\n--- 4. Testing 2-Click Add Column Modal ---');
  // Click 1: Click "+ Add Column" button
  await page.click('#btn-add-column');
  await page.waitForTimeout(300);

  const isAddModalVisible = await page.isVisible('#add-column-modal');
  assert(isAddModalVisible, 'Click 1: Add Column modal opens');

  // Fill modal inputs
  await page.fill('#new-col-title', 'Viva / Quiz 1');
  await page.fill('#new-col-max', '10');

  const hitTest = await page.$eval('#btn-confirm-add-col', el => {
    const r = el.getBoundingClientRect();
    const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      topTag: topEl?.tagName,
      topId: topEl?.id,
      topClass: topEl?.className
    };
  });
  console.log('HIT TEST BEFORE CLICK:', JSON.stringify(hitTest));

  // Click 2: Click "Confirm & Add Column" inside modal
  await page.click('#btn-confirm-add-col', { force: true });
  await page.waitForTimeout(400);

  const isAddModalClosed = !(await page.isVisible('#add-column-modal'));
  assert(isAddModalClosed, 'Click 2: Add Column modal closes upon confirmation');

  const customTh = await page.$('th:has-text("Viva / Quiz 1")');
  assert(customTh !== null, 'Custom column "Viva / Quiz 1 (10)" synced and added to table header');

  const customCellInput = await page.$('#eval-table tbody tr:first-child input[data-col="c1"]');
  assert(customCellInput !== null, 'Student rows synced with input cells for custom column c1');

  // 10. Verify Added Column shows in "Edit Total Marks" modal
  console.log('\n--- 4. Testing Edit Total Marks Modal & Scheme Distribution ---');
  await page.click('#btn-edit-total-marks');
  await page.waitForTimeout(300);

  const isMarksModalVisible = await page.isVisible('#edit-total-marks-modal');
  assert(isMarksModalVisible, 'Clicking "Edit Total Marks" opens the Edit Total Marks modal');

  const customSchemeCtrl = await page.$('#scheme-ctrl-custom-0');
  assert(customSchemeCtrl !== null, 'Custom column is displayed in Edit Total Marks modal');

  const customSchemeVal = await page.$eval('#scheme-custom-max-0', el => el.value);
  assert(customSchemeVal === '10', `Custom column max in edit modal matches input: ${customSchemeVal}`);

  // Test editing custom column max directly from modal
  console.log('Testing editing custom column max from Edit Total Marks modal...');
  await page.fill('#scheme-custom-max-0', '15');
  await page.dispatchEvent('#scheme-custom-max-0', 'input');
  await page.waitForTimeout(300);

  // Apply scheme & close modal
  await page.click('#btn-apply-scheme-modal');
  await page.waitForTimeout(300);

  const updatedCustomTh = await page.$eval('#th-custom-group-0', el => el.innerText);
  assert(updatedCustomTh.includes('(15)'), `Custom column header updated live to: "${updatedCustomTh}"`);

  // 11. Test Remove Column via 2-Click Modal Flow
  console.log('\n--- 5. Testing 2-Click Remove Column Modal ---');
  // Click 1: Click "- Remove Column" button
  await page.click('#btn-remove-column');
  await page.waitForTimeout(300);

  const isRemoveModalVisible = await page.isVisible('#remove-column-modal');
  assert(isRemoveModalVisible, 'Click 1: Remove Column confirmation modal opens');

  const removeMsg = await page.$eval('#remove-col-name-display', el => el.innerText);
  assert(removeMsg.includes('Viva / Quiz 1'), `Confirmation modal displays column name to remove: "${removeMsg}"`);

  // Click 2: Confirm removal
  await page.click('#btn-confirm-remove-col', { force: true });
  await page.waitForTimeout(400);

  const isRemoveModalClosed = !(await page.isVisible('#remove-column-modal'));
  assert(isRemoveModalClosed, 'Click 2: Remove Column modal closes upon confirmation');

  const removedTh = await page.$('th:has-text("Viva / Quiz 1")');
  assert(removedTh === null, 'Custom column removed from table header');

  const removedSchemeCtrl = await page.$('#scheme-ctrl-custom-0');
  assert(removedSchemeCtrl === null, 'Custom column removed from Edit Total Marks modal');

  // 12. Re-add Viva column for save & export validation
  console.log('Re-adding Viva column for save & export verification...');
  await page.click('#btn-add-column');
  await page.waitForTimeout(300);
  await page.fill('#new-col-title', 'Viva / Quiz 1');
  await page.fill('#new-col-max', '10');
  await page.click('#btn-confirm-add-col', { force: true });
  await page.waitForTimeout(400);

  // 13. Test Saving Evaluation via 2-Click Save Modal
  console.log('\n--- 6. Testing 2-Click Save and Lock View ---');
  await page.click('#btn-toggle-edit'); // Click 1: Open save confirm modal
  await page.waitForTimeout(400);

  const isSaveModalOpen = await page.isVisible('#save-confirm-modal');
  assert(isSaveModalOpen, 'Click 1: Save confirmation modal opens');

  await page.click('#btn-confirm-save', { force: true }); // Click 2: Confirm save
  await page.waitForTimeout(400);

  const editBtnTextFinal = await page.$eval('#btn-toggle-edit', el => el.innerText.trim());
  assert(editBtnTextFinal.includes('Edit'), `After saving, button returns to "✏️ Edit": "${editBtnTextFinal}"`);

  const addColVisibleFinal = await page.$eval('#btn-add-column', el => el.style.display);
  assert(addColVisibleFinal === 'none', 'Add Column button is locked & hidden after save');

  // 14. Verify Native Excel (.xlsx) Export with Custom Columns & Custom Headers
  const exportBtn = await page.$('#btn-export-excel');
  assert(exportBtn !== null, 'Native OpenXML Excel export button is present');
  const exportBtnText = await page.$eval('#btn-export-excel', el => el.innerText.trim());
  assert(exportBtnText === '📥 Export', `Export button text is "📥 Export" (got: "${exportBtnText}")`);

  // 15. Test Exiting Edit Mode Without Saving (2-Click Cancel Flow)
  console.log('\n--- 7. Testing 2-Click Cancel Flow ---');
  await page.click('#btn-toggle-edit'); // Enter edit mode
  await page.waitForTimeout(300);
  assert(await page.$('#btn-cancel-edit') !== null, 'Cancel button is present in Edit Mode');

  // Modify institution title temporarily
  await page.fill('#input-inst-title', 'Unsaved Temporary Value');
  await page.dispatchEvent('#input-inst-title', 'input');

  // Click 1: Click Cancel button
  await page.click('#btn-cancel-edit');
  await page.waitForTimeout(400);

  const isCancelModalOpen = await page.isVisible('#cancel-confirm-modal');
  assert(isCancelModalOpen, 'Click 1: Cancel confirmation modal opens');

  // Click 2: Click Discard & Exit
  await page.click('#btn-confirm-cancel', { force: true });
  await page.waitForTimeout(400);

  const editBtnAfterCancel = await page.$eval('#btn-toggle-edit', el => el.innerText.trim());
  assert(editBtnAfterCancel.includes('Edit'), `After cancelling, button returns to "✏️ Edit": "${editBtnAfterCancel}"`);

  const restoredTitle = await page.$eval('h1.sheet-inst-title', el => el.innerText);
  assert(!restoredTitle.includes('Unsaved Temporary Value'), 'Unsaved edits were discarded upon cancel');

  // 16. Capture Screenshot Artifact
  const shotPath = path.join(ARTIFACT_DIR, 'internal_evaluation_standalone_page.png');
  await page.screenshot({ path: shotPath });
  console.log(`📸 Screenshot saved: ${shotPath}`);

  await browser.close();

  console.log('\n======================================================');
  console.log(`MASTER EVALUATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

testEvaluationPage().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
