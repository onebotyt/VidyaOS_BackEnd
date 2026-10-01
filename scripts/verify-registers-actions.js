const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const ARTIFACT_DIR = 'C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39';
const SCREENSHOT_STEP1 = path.join(ARTIFACT_DIR, 'delete-modal-step1.png');
const SCREENSHOT_STEP2 = path.join(ARTIFACT_DIR, 'delete-modal-step2.png');

async function verifyRegistersActions() {
  console.log('=== STARTING AUTOMATED VERIFICATION: REGISTERS ACTIONS & 2-STEP DELETE ===\n');

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
    // 1. Login as Faculty
    console.log('[Step 1] Logging in as Faculty (hod@gmail.com)...');
    await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
    await page.fill('#username', 'hod@gmail.com');
    await page.fill('#password', 'Password@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to /faculty/registers.html?tab=assignments
    console.log('[Step 2] Navigating to /faculty/registers.html?tab=assignments...');
    await page.goto('http://localhost:3000/faculty/registers.html?tab=assignments', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 3. Verify Assignment Cards Have Edit & Delete Buttons
    console.log('[Step 3] Checking Assignment card action buttons...');
    const assignEditBtn = page.locator('#register-assignments-list .item-card button:has-text("Edit")').first();
    const assignDelBtn = page.locator('#register-assignments-list .item-card button:has-text("Delete")').first();

    assert.ok(await assignEditBtn.count() > 0, 'Edit button must exist on assignment card');
    assert.ok(await assignDelBtn.count() > 0, 'Delete button must exist on assignment card');
    console.log('   ✓ Found Edit button and Delete button on assignment card');

    // 4. Click Edit and Verify Submissions Drawer Opens
    console.log('[Step 4] Clicking Edit button to expand submissions roster...');
    await assignEditBtn.click();
    await page.waitForTimeout(600);

    const subTable = page.locator('.data-subtable').first();
    assert.ok(await subTable.count() > 0, 'Submissions data table must render after clicking Edit');

    // Verify Roll No header does NOT have #
    const rollHeader = await page.locator('.data-subtable th').first().textContent();
    console.log('   Submissions table Roll header:', rollHeader.trim());
    assert.strictEqual(rollHeader.trim(), 'Roll No', 'Roll column header must be "Roll No" without #');

    // Verify student roll numbers in rows do NOT have #
    const firstRollCell = await page.locator('.data-subtable tbody tr td').first().textContent();
    console.log('   First student roll number:', firstRollCell.trim());
    assert.ok(!firstRollCell.includes('#'), 'Roll cell must NOT have # prefix');

    // 5. Test 2-Step Delete Modal for Assignment
    console.log('[Step 5] Clicking Delete button on assignment...');
    await assignDelBtn.click();
    await page.waitForTimeout(400);

    // Check Step 1 is visible
    const deleteModal = page.locator('#delete-item-modal');
    assert.ok(await deleteModal.evaluate(el => el.classList.contains('open')), 'Delete modal must have open class');

    const step1 = page.locator('#del-step-1');
    const step2 = page.locator('#del-step-2');
    assert.ok(await step1.isVisible(), 'Step 1 of delete modal must be visible');
    assert.ok(!await step2.isVisible(), 'Step 2 of delete modal must be hidden in Step 1');

    const impactText = await page.locator('#del-modal-impact').textContent();
    console.log('   Step 1 Impact Text:', impactText.trim());
    assert.ok(impactText.includes('assignment'), 'Impact text must mention assignment');

    await page.screenshot({ path: SCREENSHOT_STEP1 });
    console.log(`   ✓ Saved Step 1 screenshot: ${SCREENSHOT_STEP1}`);

    // Click Proceed -> to Step 2
    console.log('[Step 6] Clicking Proceed -> to advance to Step 2...');
    await page.click('#del-step-1 button:has-text("Proceed")');
    await page.waitForTimeout(300);

    assert.ok(!await step1.isVisible(), 'Step 1 must now be hidden');
    assert.ok(await step2.isVisible(), 'Step 2 must now be visible');

    const confirmBtn = page.locator('#del-confirm-btn');
    assert.ok(await confirmBtn.isVisible(), 'Confirm Delete button must be visible in Step 2');

    await page.screenshot({ path: SCREENSHOT_STEP2 });
    console.log(`   ✓ Saved Step 2 screenshot: ${SCREENSHOT_STEP2}`);

    // Click Back to Step 1
    console.log('[Step 7] Clicking Back to return to Step 1...');
    await page.click('#del-step-2 button:has-text("Back")');
    await page.waitForTimeout(300);

    assert.ok(await step1.isVisible(), 'Step 1 must be visible again after Back');
    assert.ok(!await step2.isVisible(), 'Step 2 must be hidden after Back');

    // Close modal via Cancel
    await page.click('#del-step-1 button:has-text("Cancel")');
    await page.waitForTimeout(300);
    assert.ok(!await deleteModal.evaluate(el => el.classList.contains('open')), 'Modal should be closed');

    // 8. Switch to Class Tests (Marks) Tab
    console.log('[Step 8] Switching to Class Tests tab (?tab=marks)...');
    await page.goto('http://localhost:3000/faculty/registers.html?tab=marks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const examEditBtn = page.locator('#register-exams-list .item-card button:has-text("Edit")').first();
    const examDelBtn = page.locator('#register-exams-list .item-card button:has-text("Delete")').first();

    assert.ok(await examEditBtn.count() > 0, 'Edit button must exist on exam card');
    assert.ok(await examDelBtn.count() > 0, 'Delete button must exist on exam card');
    console.log('   ✓ Found Edit button and Delete button on exam card');

    // Click Edit on Exam Card
    console.log('[Step 9] Clicking Edit on Exam card to expand marksheet...');
    await examEditBtn.click();
    await page.waitForTimeout(600);

    const examSubTable = page.locator('#register-exams-list .data-subtable, #register-exams-list .excel-table').first();
    assert.ok(await examSubTable.count() > 0, 'Exam marksheet data table must render');

    const rollTh = examSubTable.locator('th:has-text("ROLL NO."), th:has-text("Roll No")').first();
    const examRollHeader = await rollTh.textContent();
    console.log('   Exam marksheet Roll header:', examRollHeader.trim());
    assert.ok(examRollHeader.toLowerCase().includes('roll'), 'Exam roll header must include "Roll"');

    const examFirstRoll = await examSubTable.locator('tbody tr td.cell-roll, tbody tr td:nth-child(2)').first().textContent();
    console.log('   Exam first student roll:', examFirstRoll.trim());
    assert.ok(!examFirstRoll.includes('#'), 'Exam student roll must NOT have #');

    console.log('\n======================================================');
    console.log('🎉 ALL REGISTERS ACTIONS & 2-STEP DELETE CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

verifyRegistersActions();
