const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Login as admin
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // 1. Capture HOD Management Delete Modal
  await page.goto('http://localhost:3000/admin/faculty.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // Open delete modal for first HOD
  await page.evaluate(() => {
    if (typeof openDeleteModal === 'function') {
      openDeleteModal(1, 'Dr. Rajesh Sharma (HOD)');
    }
  });
  await page.waitForTimeout(400);
  const hodShotPath = path.resolve(__dirname, 'hod-delete-protected-modal.png');
  await page.screenshot({ path: hodShotPath, fullPage: false });
  console.log('Saved HOD delete modal screenshot:', hodShotPath);

  // 2. Capture Academic Structure Delete/Archive Modal (Stage 1: Pre-archive required)
  await page.goto('http://localhost:3000/admin/academic-structure.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    if (typeof openDeleteModal === 'function') {
      openDeleteModal(99, 'Artificial Intelligence', 'AI');
    }
  });
  await page.waitForTimeout(400);
  const deptShotPath = path.resolve(__dirname, 'dept-archive-first-modal.png');
  await page.screenshot({ path: deptShotPath, fullPage: false });
  console.log('Saved Dept archive-first modal screenshot:', deptShotPath);

  // 3. Capture Academic Structure Permanent Delete Modal (Stage 2: Archived -> Typed Confirmation required)
  await page.evaluate(() => {
    if (typeof allDepartments !== 'undefined') {
      allDepartments.push({ id: 999, name: 'Cyber Security', code: 'CYBER', is_archived: 1 });
      openDeleteModal(999, 'Cyber Security', 'CYBER');
    }
  });
  await page.waitForTimeout(400);
  const typedShotPath = path.resolve(__dirname, 'dept-delete-typed-confirm-modal.png');
  await page.screenshot({ path: typedShotPath, fullPage: false });
  console.log('Saved Dept typed confirmation modal screenshot:', typedShotPath);

  await browser.close();
})();
