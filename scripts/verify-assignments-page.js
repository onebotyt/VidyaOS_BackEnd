const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39');

async function testAssignmentsPage() {
  console.log('======================================================');
  console.log('🧪 VERIFYING DEDICATED COURSEWORK & ASSIGNMENTS PAGE');
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

  // Login
  console.log('Logging in at /login/faculty.html...');
  await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
  await page.fill('#username', 'hod@gmail.com');
  await page.fill('#password', 'Password@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // Navigate to /faculty/assignments.html
  console.log('Navigating to /faculty/assignments.html...');
  await page.goto(`${BASE_URL}/faculty/assignments.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#assignment-switcher-select');
  await page.waitForTimeout(1200);

  // Verify page header & switcher
  const title = await page.$eval('h1', el => el.innerText);
  assert(title.includes('Coursework & Assignments'), `Page header contains: "${title}"`);

  // Verify metadata strip
  const metaSubject = await page.$eval('#meta-subject-name', el => el.innerText);
  assert(metaSubject && metaSubject !== '—', `Active subject metadata displayed: "${metaSubject}"`);

  // Verify assignment cards
  await page.waitForSelector('.assignment-card');
  const cardCount = await page.$$eval('.assignment-card', els => els.length);
  assert(cardCount > 0, `Found ${cardCount} assignment card(s) loaded`);

  // Verify Expand Submissions button
  const toggleBtn = await page.$('button[id^="assign-toggle-btn-"]');
  assert(toggleBtn !== null, 'Found "View Submissions" expand button on assignment card');

  console.log('Clicking "View Submissions"...');
  await toggleBtn.click();
  await page.waitForSelector('.data-table', { timeout: 5000 });
  assert(true, 'Submissions roster table opened in expand panel');

  // Verify UBTER Reg No column header
  const ubterHeader = await page.$('th:has-text("UBTER Reg No")');
  assert(ubterHeader !== null, 'Submissions table contains "UBTER Reg No" column header');

  // Verify clean roll column
  const rollCell = await page.$eval('td[style*="font-family: var(--font-family-mono)"]', el => el.innerText);
  assert(!rollCell.startsWith('#'), `Student Roll No is clean integer without #: "${rollCell}"`);

  // Verify + Create Assignment modal
  console.log('Clicking "+ Create Assignment"...');
  await page.click('button:has-text("+ Create Assignment")');
  await page.waitForSelector('#create-assignment-modal.open', { timeout: 4000 });
  assert(true, 'Create Assignment modal opened successfully');

  // Dismiss modal
  await page.click('#create-assignment-modal button:has-text("Cancel")');
  await page.waitForTimeout(400);

  // Capture Screenshot of Assignments Page
  const shotPath = path.join(ARTIFACT_DIR, 'assignments_standalone_page.png');
  await page.screenshot({ path: shotPath });
  console.log(`📸 Screenshot saved: ${shotPath}`);

  await browser.close();

  console.log('\n======================================================');
  console.log(`ASSIGNMENT PAGE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

testAssignmentsPage().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
