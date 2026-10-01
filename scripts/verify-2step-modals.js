const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  console.log('=================================================================');
  console.log('🧪 VERIFY 2-STEP SAFEGUARD MODALS: Reassign, Reset, and Delete');
  console.log('=================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const artifactDir = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39');

  // 1. Admin Login
  console.log('1. Logging in as Admin...');
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // 2. Open HOD Management Console
  console.log('2. Loading Faculty / HOD Console...');
  await page.goto('http://localhost:3000/admin/faculty.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Verify HOD rows exist
  const hodRowCount = await page.locator('#hod-tbody tr').count();
  console.log(`Found ${hodRowCount} HOD row(s) in table.`);
  assert(hodRowCount > 0, 'At least 1 HOD exists in demo table');

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: Reassign HOD Department (2-Step Stepper)
  // ─────────────────────────────────────────────────────────────
  console.log('\n3. Testing 2-Step Flow: Reassign HOD Department...');
  // Click Reassign on first row
  await page.locator('#hod-tbody tr:first-child button:has-text("Reassign Dept")').click();
  await page.waitForTimeout(400);

  // Verify Modal is Open and on Step 1
  assert(await page.isVisible('#reassign-modal'), 'Reassign modal is visible');
  assert(await page.isVisible('#reassign-step-1'), 'Step 1 is visible');
  assert(!(await page.isVisible('#reassign-step-2')), 'Step 2 is hidden initially');

  const reassignStep1Shot = path.join(artifactDir, 'reassign-modal-step1.png');
  await page.screenshot({ path: reassignStep1Shot });
  console.log('  📸 Screenshot: Reassign Modal Step 1 saved');

  // Test validation on Step 1: No department selected
  await page.click('#reassign-step1-btn');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reassign-step1-err'), 'Validation error shown when dept is empty');
  const errText1 = await page.textContent('#reassign-step1-err');
  assert(errText1.includes('Please select a target department'), 'Shows select dept message');

  // Test selecting current department (IT = 4)
  await page.selectOption('#reassign-dept', '4');
  await page.click('#reassign-step1-btn');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reassign-step1-err'), 'Validation error shown when same dept selected');
  const errTextSame = await page.textContent('#reassign-step1-err');
  assert(errTextSame.includes('already assigned to this department'), 'Shows already assigned message');

  // Select valid new department (e.g. Mechanical Engineering = 5)
  await page.selectOption('#reassign-dept', '5');
  await page.click('#reassign-step1-btn');
  await page.waitForTimeout(300);

  // Verify transition to Step 2
  assert(!(await page.isVisible('#reassign-step-1')), 'Step 1 hidden after advancing');
  assert(await page.isVisible('#reassign-step-2'), 'Step 2 is visible');

  const fromDept = await page.textContent('#reassign-preview-from');
  const toDept = await page.textContent('#reassign-preview-to');
  console.log(`  Transfer Route: [${fromDept}] ➔ [${toDept}]`);
  assert(fromDept.includes('Information Technology'), 'Source department correctly displayed');
  assert(toDept.includes('Mechanical Engineering'), 'Target department correctly displayed');

  const reassignStep2Shot = path.join(artifactDir, 'reassign-modal-step2.png');
  await page.screenshot({ path: reassignStep2Shot });
  console.log('  📸 Screenshot: Reassign Modal Step 2 saved');

  // Test Back Navigation in Reassign Modal
  await page.click('#reassign-step-2 button:has-text("Back to Step 1")');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reassign-step-1'), 'Step 1 is visible after clicking Back');
  assert(!(await page.isVisible('#reassign-step-2')), 'Step 2 is hidden after clicking Back');
  const preservedDept = await page.inputValue('#reassign-dept');
  assert(preservedDept === '5', 'Department selection preserved on Back');

  // Close Reassign Modal
  await page.click('#reassign-modal button:has-text("Cancel")');
  await page.waitForTimeout(300);
  assert(!(await page.isVisible('#reassign-modal')), 'Reassign modal closed');
  console.log('  ✓ Reassign Department 2-Step Flow Verified!');

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Reset Password (2-Step Stepper)
  // ─────────────────────────────────────────────────────────────
  console.log('\n4. Testing 2-Step Flow: Reset Password...');
  await page.locator('#hod-tbody tr:first-child button:has-text("Reset Pwd")').click();
  await page.waitForTimeout(400);

  assert(await page.isVisible('#reset-modal'), 'Reset modal is visible');
  assert(await page.isVisible('#reset-step-1'), 'Step 1 is visible');
  assert(!(await page.isVisible('#reset-step-2')), 'Step 2 is hidden initially');

  const resetStep1Shot = path.join(artifactDir, 'reset-modal-step1.png');
  await page.screenshot({ path: resetStep1Shot });
  console.log('  📸 Screenshot: Reset Modal Step 1 saved');

  // Test password mismatch
  await page.fill('#reset-password', 'NewSecret@123');
  await page.fill('#reset-password-confirm', 'MismatchPass@456');
  await page.click('#reset-step1-btn');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reset-step1-err'), 'Error shown for password mismatch');
  const mismatchErr = await page.textContent('#reset-step1-err');
  assert(mismatchErr.includes('do not match'), 'Shows mismatch message');

  // Test short password (< 6 chars)
  await page.fill('#reset-password', '12345');
  await page.fill('#reset-password-confirm', '12345');
  await page.click('#reset-step1-btn');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reset-step1-err'), 'Error shown for short password');
  const shortErr = await page.textContent('#reset-step1-err');
  assert(shortErr.includes('at least 6 characters'), 'Shows min length message');

  // Set valid matching password
  await page.fill('#reset-password', 'SecureFaculty@2026');
  await page.fill('#reset-password-confirm', 'SecureFaculty@2026');
  await page.click('#reset-step1-btn');
  await page.waitForTimeout(300);

  // Verify transition to Step 2
  assert(!(await page.isVisible('#reset-step-1')), 'Step 1 is hidden');
  assert(await page.isVisible('#reset-step-2'), 'Step 2 is visible');

  // Masked preview check
  const maskedText = await page.textContent('#reset-preview-pass');
  assert(maskedText.includes('••••'), 'Password is masked initially in preview');

  // Test Reveal Toggle
  await page.click('#reset-preview-eye-btn');
  await page.waitForTimeout(200);
  const revealedText = await page.textContent('#reset-preview-pass');
  assert(revealedText === 'SecureFaculty@2026', 'Password revealed after clicking Reveal');

  const resetStep2Shot = path.join(artifactDir, 'reset-modal-step2.png');
  await page.screenshot({ path: resetStep2Shot });
  console.log('  📸 Screenshot: Reset Modal Step 2 saved');

  // Test Back Navigation in Reset Modal
  await page.click('#reset-step-2 button:has-text("Back to Edit")');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#reset-step-1'), 'Step 1 is visible after clicking Back');
  assert(!(await page.isVisible('#reset-step-2')), 'Step 2 is hidden after clicking Back');
  assert(await page.inputValue('#reset-password') === 'SecureFaculty@2026', 'Password preserved on Back');

  // Close Reset Modal
  await page.click('#reset-modal button:has-text("Cancel")');
  await page.waitForTimeout(300);
  assert(!(await page.isVisible('#reset-modal')), 'Reset modal closed');
  console.log('  ✓ Reset Password 2-Step Flow Verified!');

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Delete HOD Account (2-Step Safeguard Stepper)
  // ─────────────────────────────────────────────────────────────
  console.log('\n5. Testing 2-Step Flow: Delete HOD Account...');
  await page.locator('#hod-tbody tr:first-child button:has-text("Delete")').click();
  await page.waitForTimeout(400);

  assert(await page.isVisible('#delete-modal'), 'Delete modal is visible');
  assert(await page.isVisible('#delete-step-1'), 'Step 1 (Impact Assessment) is visible');
  assert(!(await page.isVisible('#delete-step-2')), 'Step 2 is hidden initially');

  const deleteStep1Shot = path.join(artifactDir, 'delete-modal-step1.png');
  await page.screenshot({ path: deleteStep1Shot });
  console.log('  📸 Screenshot: Delete Modal Step 1 saved');

  // Advance to Step 2
  await page.click('#delete-step1-btn');
  await page.waitForTimeout(300);

  assert(!(await page.isVisible('#delete-step-1')), 'Step 1 is hidden');
  assert(await page.isVisible('#delete-step-2'), 'Step 2 is visible');

  // Verify button is disabled initially
  const isBtnDisabledInitially = await page.isDisabled('#delete-btn');
  assert(isBtnDisabledInitially, 'Permanently Remove HOD button is disabled initially');

  const deleteStep2DisabledShot = path.join(artifactDir, 'delete-modal-step2-disabled.png');
  await page.screenshot({ path: deleteStep2DisabledShot });
  console.log('  📸 Screenshot: Delete Modal Step 2 (Disabled) saved');

  // Type incorrect text
  await page.fill('#delete-confirm-input', 'del');
  assert(await page.isDisabled('#delete-btn'), 'Button remains disabled for partial text');

  await page.fill('#delete-confirm-input', 'deletee');
  assert(await page.isDisabled('#delete-btn'), 'Button remains disabled for misspelled text');

  // Type correct text: DELETE
  await page.fill('#delete-confirm-input', 'DELETE');
  await page.waitForTimeout(200);
  const isBtnEnabled = !(await page.isDisabled('#delete-btn'));
  assert(isBtnEnabled, 'Permanently Remove HOD button unlocks when DELETE is entered!');

  const deleteStep2EnabledShot = path.join(artifactDir, 'delete-modal-step2-enabled.png');
  await page.screenshot({ path: deleteStep2EnabledShot });
  console.log('  📸 Screenshot: Delete Modal Step 2 (Unlocked) saved');

  // Test Back Navigation in Delete Modal
  await page.click('#delete-step-2 button:has-text("Back to Step 1")');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#delete-step-1'), 'Step 1 is visible after clicking Back');
  assert(!(await page.isVisible('#delete-step-2')), 'Step 2 is hidden after clicking Back');

  // Close Delete Modal
  await page.click('#delete-modal button:has-text("Cancel")');
  await page.waitForTimeout(300);
  assert(!(await page.isVisible('#delete-modal')), 'Delete modal closed safely without deletion');
  console.log('  ✓ Delete HOD 2-Step Safeguard Flow Verified!');

  await browser.close();
  console.log('\n=================================================================');
  console.log('🎉 ALL 2-STEP MODAL VERIFICATION TESTS PASSED 100%!');
  console.log('=================================================================');
})();
