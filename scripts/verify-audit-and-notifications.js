/**
 * Playwright E2E Visual Verification for Milestone 45:
 * Institutional Audit Logging System & In-App Notification Hub
 */

const { chromium } = require('playwright');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39';
const SCREENSHOT_AUDIT_LOGS = path.join(ARTIFACT_DIR, 'audit_logs_explorer.png');
const SCREENSHOT_NOTIFS = path.join(ARTIFACT_DIR, 'notifications_popover.png');
const SCREENSHOT_PAYLOAD_MODAL = path.join(ARTIFACT_DIR, 'audit_payload_modal.png');

(async () => {
  console.log('🚀 Starting E2E Visual Verification for Milestone 45...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('   [Browser Console Error]:', msg.text());
  });

  // 1. Login as Admin
  console.log('1. Logging in as Admin via /login/faculty.html...');
  await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin@gmail.com');
  await page.fill('#password', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // 2. Navigate to Audit Logs page
  console.log('2. Navigating to /admin/audit-logs.html...');
  await page.goto('http://localhost:3000/admin/audit-logs.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const rows = await page.$$('#audit-table-body tr');
  console.log(`✓ Audit table rendered with ${rows.length} rows.`);

  // Save audit logs table screenshot
  await page.screenshot({ path: SCREENSHOT_AUDIT_LOGS, fullPage: false });
  console.log(`✓ Saved screenshot: ${SCREENSHOT_AUDIT_LOGS}`);

  // 3. Test Notification Bell
  console.log('3. Testing In-App Notification Bell in navbar...');
  const bellBtn = await page.waitForSelector('#notification-bell-btn');
  const badge = await page.$('#notification-badge');
  if (badge) {
    const badgeText = await badge.innerText();
    console.log(`✓ Notification badge found with count: ${badgeText}`);
  }

  // Click bell to toggle popover
  await bellBtn.click();
  await page.waitForTimeout(500);
  await page.waitForSelector('#notification-dropdown-menu.open', { state: 'visible' });
  console.log('✓ Notification popover opened.');

  await page.screenshot({ path: SCREENSHOT_NOTIFS, fullPage: false });
  console.log(`✓ Saved screenshot: ${SCREENSHOT_NOTIFS}`);

  // Dismiss popover by clicking outside
  await page.click('#filter-search');
  await page.waitForTimeout(300);

  // 4. Test View Details Payload Modal
  console.log('4. Testing Audit Payload Details Modal...');
  const firstJsonChip = await page.$('.json-chip');
  if (firstJsonChip) {
    await firstJsonChip.click();
    await page.waitForTimeout(500);
    await page.waitForSelector('#details-modal.open', { state: 'visible' });
    console.log('✓ Audit details modal opened.');
    await page.screenshot({ path: SCREENSHOT_PAYLOAD_MODAL, fullPage: false });
    console.log(`✓ Saved screenshot: ${SCREENSHOT_PAYLOAD_MODAL}`);
  }

  await browser.close();
  console.log('🎉 E2E Visual Verification completed successfully!');
})().catch(err => {
  console.error('Fatal error during E2E verification:', err);
  process.exit(1);
});
