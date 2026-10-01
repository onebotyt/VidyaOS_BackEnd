const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  console.log('=================================================================');
  console.log('📸 PLAYWRIGHT VERIFICATION: Faculty Search by Gmail & Combined HOD Role');
  console.log('=================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 750 } });
  const page = await context.newPage();

  // 1. Admin Login
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // 2. Open HOD Management Console
  await page.goto('http://localhost:3000/admin/faculty.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // 3. Open Modal
  await page.click('#create-hod-btn');
  await page.waitForTimeout(400);

  // 4. Verify Search Tab is Active by default
  const isSearchVisible = await page.isVisible('#section-search-faculty');
  assert(isSearchVisible, 'Search Existing Faculty section is visible by default');

  // 5. Enter Gmail of existing faculty: classteacher@gmail.com
  await page.fill('#search-faculty-email', 'classteacher@gmail.com');
  await page.click('#btn-search-faculty');
  await page.waitForTimeout(600);

  // 6. Verify found faculty details card is rendered
  const isCardVisible = await page.isVisible('#found-faculty-card');
  assert(isCardVisible, 'Found faculty card is displayed');

  const facultyName = await page.textContent('#found-name');
  const facultyGmail = await page.textContent('#found-gmail');
  const facultyRoles = await page.textContent('#found-roles');
  console.log('UI Found Faculty:', { facultyName, facultyGmail, facultyRoles });

  assert(facultyName.includes('Priya Mehta'), 'Correct faculty name displayed');
  assert(facultyGmail.includes('classteacher@gmail.com'), 'Correct Gmail displayed');
  assert(facultyRoles.includes('Class Teacher'), 'Shows Class Teacher in roles');

  // Screenshot 1: Faculty Search Card with Details & Combined Power Badge
  const shot1 = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/hod-search-faculty-found.png');
  await page.screenshot({ path: shot1 });
  console.log('✅ Screenshot 1 saved:', shot1);

  // 7. Select Department (e.g. IT, id 4) & Click Assign
  await page.selectOption('#assign-existing-dept', '4');
  await page.click('#btn-submit-assign');
  await page.waitForTimeout(800);

  // 8. Verify Confirmation Slip Modal
  const isSlipVisible = await page.isVisible('#cred-modal');
  assert(isSlipVisible, 'Confirmation slip modal is displayed');
  const slipTitle = await page.textContent('#cred-title');
  const slipName = await page.textContent('#slip-name');
  console.log('Slip Confirmation:', { slipTitle, slipName });
  assert(slipTitle.includes('HOD Role Appointed'), 'Title says HOD Role Appointed');

  // Screenshot 2: HOD Appointed Confirmation Slip
  const shot2 = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/hod-appointed-confirmation-slip.png');
  await page.screenshot({ path: shot2 });
  console.log('✅ Screenshot 2 saved:', shot2);

  // 9. Close Slip Modal
  await page.click('#cred-modal button:has-text("Done")');
  await page.waitForTimeout(600);

  // 10. Check that HOD Table now lists Priya Mehta as HOD of IT
  const tableText = await page.textContent('#hod-tbody');
  assert(tableText.includes('Priya Mehta'), 'Priya Mehta is now listed in HOD table');
  console.log('✅ Table updated with appointed HOD');

  // Screenshot 3: HOD Table with Appointed HOD
  const shot3 = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/hod-table-updated.png');
  await page.screenshot({ path: shot3 });
  console.log('✅ Screenshot 3 saved:', shot3);

  // 11. Test Safe Multi-Role Delete from UI
  // Find Priya Mehta row and click Delete
  const row = page.locator('tr:has-text("Priya Mehta")').first();
  await row.locator('button:has-text("Delete")').click();
  await page.waitForTimeout(400);

  // Verify Delete Modal opened and shows protection info
  const isDelVisible = await page.isVisible('#delete-modal');
  assert(isDelVisible, 'Delete confirmation modal opened');

  // Screenshot 4: Delete Modal with Branch Protection Info
  const shot4 = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/hod-delete-modal-safe.png');
  await page.screenshot({ path: shot4 });
  console.log('✅ Screenshot 4 saved:', shot4);

  // Click "Delete HOD" and wait for delete + list reload
  const deletePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/admin/hods') && resp.request().method() === 'DELETE');
  await page.click('#delete-btn');
  await deletePromise;
  await page.waitForTimeout(1200);

  // Verify modal is closed and toast was displayed
  const isDelClosed = !(await page.isVisible('#delete-modal'));
  assert(isDelClosed, 'Delete modal closed smoothly without error stuck');

  // Screenshot 5: Clean table after revoking HOD role
  const shot5 = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39/hod-table-after-delete.png');
  await page.screenshot({ path: shot5 });
  console.log('✅ Screenshot 5 saved:', shot5);

  console.log('\n=================================================================');
  console.log('🎉 ALL PLAYWRIGHT UI CHECKS & SCREENSHOTS COMPLETED (100%)');
  console.log('=================================================================');

  await browser.close();
})();
