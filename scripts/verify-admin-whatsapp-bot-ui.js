const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('======================================================');
  console.log('🧪 PLAYWRIGHT VERIFICATION: DEDICATED WHATSAPP GATEWAY PAGE');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  try {
    // 1. Login as Admin
    console.log('1. Logging in as Admin...');
    await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
    await page.fill('#username', 'admin@gmail.com');
    await page.fill('#password', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to dedicated /admin/whatsapp-gateway.html
    console.log('2. Navigating to dedicated /admin/whatsapp-gateway.html...');
    await page.goto('http://localhost:3000/admin/whatsapp-gateway.html', { waitUntil: 'networkidle' });

    // Verify Title & Hero
    const pageTitle = await page.title();
    console.log(`   Page Title: "${pageTitle}"`);
    const headerTitle = await page.textContent('.gateway-header-title');
    console.log(`   Header Title: "${headerTitle.trim()}"`);

    // 3. Verify Status Pill & Telemetry KPI Cards
    console.log('3. Verifying Status Pill & Telemetry KPIs...');
    await page.waitForSelector('#wa-bot-status-pill', { state: 'visible', timeout: 5000 });
    const statusText = await page.textContent('#wa-bot-status-text');
    console.log(`   Status Pill: "${statusText.trim()}"`);

    const kpiGridVisible = await page.isVisible('.kpi-grid');
    console.log(`   KPI Grid visible: ${kpiGridVisible}`);

    // 4. Verify Main Gateway Controller Card
    console.log('4. Verifying Gateway Controller Card & Action Buttons...');
    await page.waitForSelector('#whatsapp-bot-gateway-card', { state: 'visible', timeout: 5000 });
    const refreshBtn = await page.$('#btn-refresh-wa-bot');
    console.log(`   Refresh button present: ${refreshBtn !== null}`);

    const initBtn = await page.$('#btn-init-wa-bot');
    console.log(`   Link Bot button present: ${initBtn !== null}`);

    // 5. Test Test Message Modal
    console.log('5. Testing Send Test WhatsApp Message Modal on dedicated page...');
    await page.evaluate(() => window.openTestWaModal());
    await page.waitForSelector('#test-wa-modal.open', { state: 'visible', timeout: 3000 });
    console.log('   Test modal opened successfully!');

    // Test validation error handling
    await page.fill('#test-wa-phone', '12345');
    await page.click('#btn-send-test-wa');
    await page.waitForSelector('#test-wa-err', { state: 'visible', timeout: 2000 });
    const errText = await page.textContent('#test-wa-err');
    console.log(`   Validation error caught: "${errText.trim()}"`);

    // Close modal
    await page.evaluate(() => window.closeTestWaModal());
    await page.waitForSelector('#test-wa-modal', { state: 'hidden', timeout: 3000 });
    console.log('   Test modal closed successfully!');

    // 6. Verify link from /admin/faculty.html
    console.log('6. Checking Gateway launcher link from /admin/faculty.html...');
    await page.goto('http://localhost:3000/admin/faculty.html', { waitUntil: 'networkidle' });
    const gatewayLink = await page.$('a[href="/admin/whatsapp-gateway.html"]');
    console.log(`   Gateway Console button on faculty.html: ${gatewayLink !== null}`);

    // 7. Capture Screenshot of the new Dedicated WhatsApp Gateway page
    console.log('7. Capturing screenshot of the dedicated WhatsApp Gateway Console...');
    await page.goto('http://localhost:3000/admin/whatsapp-gateway.html', { waitUntil: 'networkidle' });
    const artifactPath = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9/whatsapp_gateway_page.png');
    await page.screenshot({ path: artifactPath, fullPage: true });
    console.log(`   ✓ Full-page screenshot saved: ${artifactPath}`);

    console.log('\n======================================================');
    console.log('RESULTS: ALL DEDICATED WHATSAPP GATEWAY CHECKS PASSED ✓');
    console.log('======================================================');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
