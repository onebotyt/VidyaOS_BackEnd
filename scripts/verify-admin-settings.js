const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const ARTIFACT_DIR = 'C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39';
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'admin-settings-modernized.png');

async function verifySettingsPage() {
  console.log('=== STARTING AUTOMATED VERIFICATION: ADMIN SETTINGS (INSTITUTIONAL ACCREDITATION & IDENTITY) ===\n');

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
    // 1. Login as Admin
    console.log('[Step 1] Logging in as Admin via /login/faculty.html...');
    await page.goto('http://localhost:3000/login/faculty.html', { waitUntil: 'networkidle' });
    await page.fill('#username', 'admin@gmail.com');
    await page.fill('#password', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 2. Navigate to settings.html
    console.log('[Step 2] Navigating to /admin/settings.html...');
    await page.goto('http://localhost:3000/admin/settings.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 3. Verify Modern Values Loaded
    console.log('[Step 3] Verifying modern institutional metadata in form fields...');
    const instName = await page.locator('#setting-inst-name').inputValue();
    const instCode = await page.locator('#setting-inst-code').inputValue();
    const affilBody = await page.locator('#setting-affiliating-body').inputValue();
    const location = await page.locator('#setting-location').inputValue();

    console.log('   Institution Name:', `"${instName}"`);
    console.log('   Institution Code:', `"${instCode}"`);
    console.log('   Affiliating Body:', `"${affilBody}"`);
    console.log('   Campus Location:', `"${location}"`);

    // Assert that the old mock values are NOT present
    assert.strictEqual(instName.includes('Universal Institute'), false, 'Must NOT contain old Universal Institute of Technology');
    assert.strictEqual(instCode.includes('UIT-101'), false, 'Must NOT contain old UIT-101 code');

    // Assert modern values
    assert.ok(instName.includes('Government Polytechnic'), 'Must contain Government Polytechnic College');
    assert.ok(instCode.includes('GP-UBTER') || instCode.includes('UBTER') || instCode.includes('GP'), 'Must contain state polytechnic code');
    assert.ok(affilBody.includes('UBTER') || affilBody.includes('IRDT'), 'Must contain UBTER or IRDT');

    // 4. Verify Live Preview Card Synchronization
    console.log('[Step 4] Testing live preview responsiveness when adjusting values...');
    const previewInst = await page.locator('#preview-inst-name').textContent();
    assert.ok(previewInst.includes('Government Polytechnic'), 'Live preview reflects institution name');

    // Change institution code and check live preview update
    await page.fill('#setting-inst-code', 'GP-UBTER-TEST');
    await page.waitForTimeout(200);

    const updatedPreviewCode = await page.locator('#preview-inst-code').textContent();
    console.log('   Updated Preview Code:', updatedPreviewCode.trim());
    assert.ok(updatedPreviewCode.includes('GP-UBTER-TEST'), 'Preview code updated');

    // 5. Test Form Submission & Persistence
    console.log('[Step 5] Saving settings and verifying persistence...');
    await page.click('#save-settings-btn');
    await page.waitForTimeout(800);

    // Reload page to verify persistence from SQLite
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const reloadedCode = await page.locator('#setting-inst-code').inputValue();
    console.log('   Persisted code after reload:', reloadedCode);
    assert.strictEqual(reloadedCode, 'GP-UBTER-TEST', 'Code persisted in database');

    // 6. Test Reset to Defaults
    console.log('[Step 6] Testing "Reset to Defaults"...');
    await page.click('button:has-text("Reset to Defaults")');
    await page.waitForTimeout(300);

    const resetCode = await page.locator('#setting-inst-code').inputValue();
    console.log('   Code after reset button:', resetCode);
    assert.strictEqual(resetCode, 'GP-UBTER-101', 'Code reset to GP-UBTER-101');

    // Save official default back
    await page.click('#save-settings-btn');
    await page.waitForTimeout(800);

    // 7. Capture Full-Page Screenshot
    console.log('[Step 7] Capturing screenshot of modernized settings page...');
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`   ✓ Screenshot saved to: ${SCREENSHOT_PATH}`);

    console.log('\n======================================================');
    console.log('🎉 ALL ADMIN SETTINGS VERIFICATION CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

verifySettingsPage();
