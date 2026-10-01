const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { query } = require('../src/config/db');

(async () => {
  console.log('======================================================');
  console.log('🧪 PLAYWRIGHT E2E: SCAN WHATSAPP OTP SYSTEM VERIFICATION');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // Open cohort registration for IT Sem 5 so student can register
    await query("INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES ('cohort_reg_dept_4', '1')");
    await query("INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES ('faculty_reg_dept_4', '1')");

    // ─── 1. TEST STUDENT REGISTRATION WITH WHATSAPP SCAN OTP ───
    console.log('1. Navigating to /login/student-register.html...');
    await page.goto('http://localhost:3000/login/student-register.html');
    await page.waitForLoadState('networkidle');

    // Select branch and semester
    console.log('   Selecting Information Technology and Semester 5...');
    await page.selectOption('#reg-department', '4');
    await page.waitForTimeout(300);
    await page.selectOption('#reg-semester', '5');
    await page.waitForTimeout(600);

    // Verify routing banner shows green open
    const routingTarget = await page.locator('#routing-target-text').innerText();
    console.log(`   Routing status: "${routingTarget}"`);
    assert(routingTarget.includes('Registration Open'), 'Student registration is open for IT Sem 5');

    // Fill student details
    await page.fill('#reg-fullname', 'Aarav Sharma');
    await page.fill('#reg-enroll', '2026ITWA01');
    await page.fill('#reg-email', 'aarav.sharma@gmail.com');
    await page.fill('#reg-phone', '9811122233');
    await page.fill('#reg-password', 'Password@123');
    await page.fill('#reg-confirm', 'Password@123');

    // Click "Send WhatsApp OTP"
    console.log('   Clicking 💬 Send WhatsApp OTP...');
    await page.click('#btn-send-otp');
    await page.waitForSelector('#otp-box', { state: 'visible' });

    // Assert QR Code Card is visible
    const qrCardVisible = await page.isVisible('#wa-qr-card');
    assert(qrCardVisible, '#wa-qr-card is visible in DOM');

    const qrImgSrc = await page.getAttribute('#wa-qr-img', 'src');
    console.log(`   QR code image src: ${qrImgSrc}`);
    assert(qrImgSrc.includes('api.qrserver.com'), 'QR code generated via QR server API');
    assert(qrImgSrc.includes('wa.me'), 'QR code embeds wa.me link');

    const waLinkHref = await page.getAttribute('#wa-direct-link', 'href');
    console.log(`   Direct WhatsApp link href: ${waLinkHref}`);
    assert(waLinkHref.includes('wa.me/919811122233'), 'Direct WhatsApp link targets 919811122233');

    // Verify Demo Code & Auto-Fill button
    const feedbackText = await page.locator('#otp-feedback-msg').innerText();
    console.log(`   Feedback message: ${feedbackText}`);
    assert(feedbackText.includes('Demo Code:'), 'Feedback includes demo OTP');

    // Capture screenshot of the Scan WhatsApp OTP Card
    const screenshotDir = path.join(__dirname, '../../../C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9');
    await page.screenshot({ path: path.join(__dirname, 'student-whatsapp-otp-qr.png') });
    console.log('   ✓ Screenshot saved: student-whatsapp-otp-qr.png');

    // Click 1-click Auto-Fill Code button
    console.log('   Clicking ⚡ Auto-Fill Code button...');
    await page.click('button:has-text("Auto-Fill Code")');
    await page.waitForTimeout(600);

    // Verify WhatsApp Verified Badge
    const badgeVisible = await page.isVisible('#otp-verified-badge');
    assert(badgeVisible, '#otp-verified-badge is visible');
    const badgeText = await page.locator('#otp-verified-badge').innerText();
    console.log(`   Badge text: "${badgeText}"`);
    assert(badgeText.toUpperCase().includes('WHATSAPP VERIFIED VIA OTP'), 'Verified badge is displayed');

    // Verify phone is locked
    const isPhoneReadOnly = await page.getAttribute('#reg-phone', 'readonly');
    assert(isPhoneReadOnly !== null, '#reg-phone is locked after OTP verification');

    // Submit Registration
    console.log('   Submitting student registration request...');
    await page.click('#submit-btn');
    await page.waitForSelector('#success-view', { state: 'visible' });

    const successSummary = await page.locator('#success-summary-box').innerText();
    console.log('   Success summary:\n' + successSummary);
    assert(successSummary.includes('Aarav Sharma'), 'Success displays student name');
    assert(successSummary.includes('9811122233'), 'Success displays WhatsApp mobile');

    console.log('✓ PASS: Student Registration with Scan WhatsApp OTP completed flawlessly!\n');

    // ─── 2. TEST FACULTY REGISTRATION WITH WHATSAPP SCAN OTP ───
    console.log('2. Navigating to /login/faculty-register.html...');
    await page.goto('http://localhost:3000/login/faculty-register.html');
    await page.waitForLoadState('networkidle');

    // Select IT department
    await page.selectOption('#department_id', '4');
    await page.waitForTimeout(500);

    // Fill details
    await page.fill('#full_name', 'Prof. Vikas Joshi');
    await page.fill('#email', 'vikas.joshi@gmail.com');
    await page.fill('#phone', '9812345678');
    await page.fill('#password', 'Password@123');

    // Click Send WhatsApp OTP
    console.log('   Clicking 💬 Send WhatsApp OTP for faculty...');
    await page.click('#btn-send-otp');
    await page.waitForSelector('#otp-box', { state: 'visible' });

    // Assert QR Code & Auto-Fill
    assert(await page.isVisible('#wa-qr-card'), '#wa-qr-card visible on faculty registration');
    assert(await page.isVisible('#wa-qr-img'), '#wa-qr-img visible on faculty registration');

    await page.click('button:has-text("Auto-Fill Code")');
    await page.waitForTimeout(600);

    assert(await page.isVisible('#otp-verified-badge'), 'Faculty #otp-verified-badge visible');
    console.log('   Submitting faculty registration request...');
    await page.click('#btn-submit');
    await page.waitForSelector('#success-view', { state: 'visible' });

    const facSuccessName = await page.locator('#res-name').innerText();
    const facSuccessPhone = await page.locator('#res-phone').innerText();
    console.log(`   Faculty success: "${facSuccessName}", Phone: "${facSuccessPhone}"`);
    assert(facSuccessName.includes('Prof. Vikas Joshi'), 'Success shows faculty name');
    assert(facSuccessPhone.includes('9812345678'), 'Success shows faculty WhatsApp phone');

    console.log('✓ PASS: Faculty Registration with Scan WhatsApp OTP completed flawlessly!\n');

    // Cleanup test records
    await query("DELETE FROM students WHERE official_enrollment_no = '2026ITWA01'");
    await query("DELETE FROM users WHERE email IN ('aarav.sharma@gmail.com', 'vikas.joshi@gmail.com')");
    await query("DELETE FROM faculty_registration_requests WHERE email = 'vikas.joshi@gmail.com'");
    console.log('✓ Teardown complete: All temporary test records removed.');

    console.log('======================================================');
    console.log('RESULTS: ALL SCAN WHATSAPP OTP E2E TESTS PASSED ✓');
    console.log('======================================================');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
