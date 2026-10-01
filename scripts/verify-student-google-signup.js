const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { query } = require('../src/config/db');

(async () => {
  console.log('======================================================');
  console.log('🧪 PLAYWRIGHT E2E: OFFICIAL GOOGLE ACCOUNT CHOOSER & SIGN-UP');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const testStudentEmail = 'aarav.google.official@gmail.com';
  const testStudentName = 'Aarav Google Official';
  const testEnrollment = '2026GOOG99';
  const testPhone = '9876500099';
  const testGoogleSub = 'google_sub_official_test_99';

  try {
    // 0. Ensure registration gate is open for IT cohort
    await query("INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES ('cohort_reg_dept_4', '1')");

    // Clean up any stale test records before starting
    await query("DELETE FROM students WHERE official_enrollment_no = ?", [testEnrollment]);
    await query("DELETE FROM users WHERE LOWER(email) = ?", [testStudentEmail]);

    // ─── 1. VERIFY GOOGLE OAUTH URL API (prompt=select_account) ───
    console.log('1. Verifying official Google OAuth URL generation API...');
    const regUrlRes = await page.request.get('http://localhost:3000/api/v1/auth/google/url?mode=STUDENT_REGISTER');
    assert.strictEqual(regUrlRes.status(), 200, 'GET /auth/google/url returns 200');
    const regUrlJson = await regUrlRes.json();
    assert(regUrlJson.success, 'OAuth response is successful');
    assert(regUrlJson.configured, 'Google OAuth is configured in .env');
    assert(regUrlJson.data?.url, 'Google OAuth URL is provided');

    const authUrl = regUrlJson.data.url;
    console.log(`   Generated Google Auth URL:\n   ${authUrl.slice(0, 110)}...`);
    assert(authUrl.includes('accounts.google.com/o/oauth2/v2/auth'), 'URL points to official accounts.google.com');
    assert(authUrl.includes('prompt=select_account'), 'URL includes prompt=select_account to show device Gmails');
    assert(authUrl.includes('client_id='), 'URL includes Google client_id');
    assert(authUrl.includes('redirect_uri='), 'URL includes callback redirect_uri');

    // Decode and verify state parameter
    const stateMatch = authUrl.match(/state=([^&]+)/);
    assert(stateMatch, 'URL contains state parameter');
    const stateObj = JSON.parse(Buffer.from(stateMatch[1], 'base64url').toString('utf8'));
    assert.strictEqual(stateObj.mode, 'STUDENT_REGISTER', 'State mode is STUDENT_REGISTER');
    console.log('   ✓ PASS: Official Google Auth URL verified with prompt=select_account and STUDENT_REGISTER state\n');

    // Verify STUDENT_LOGIN url
    const loginUrlRes = await page.request.get('http://localhost:3000/api/v1/auth/google/url?mode=STUDENT_LOGIN');
    const loginUrlJson = await loginUrlRes.json();
    const loginStateMatch = loginUrlJson.data.url.match(/state=([^&]+)/);
    const loginStateObj = JSON.parse(Buffer.from(loginStateMatch[1], 'base64url').toString('utf8'));
    assert.strictEqual(loginStateObj.mode, 'STUDENT_LOGIN', 'Login URL has STUDENT_LOGIN state mode');
    console.log('   ✓ PASS: STUDENT_LOGIN OAuth URL verified\n');

    // ─── 2. VERIFY STUDENT REGISTRATION GOOGLE BUTTON & POSTMESSAGE POPUP FLOW ───
    console.log('2. Navigating to /login/student-register.html...');
    await page.goto('http://localhost:3000/login/student-register.html');
    await page.waitForLoadState('networkidle');

    // Assert Google button exists and is visible
    const googleBtnVisible = await page.isVisible('#google-signup-btn');
    assert(googleBtnVisible, '#google-signup-btn is visible on student registration');
    const googleBtnText = await page.locator('#google-signup-btn').innerText();
    console.log(`   Google button text: "${googleBtnText.trim()}"`);
    assert(googleBtnText.includes('Sign up with Google'), 'Button text includes "Sign up with Google"');

    // Verify Offline / Demo Mode link is present
    const demoLink = page.locator('text=Offline / Demo Mode');
    assert(await demoLink.isVisible(), 'Offline / Demo Mode link is available');

    // Verify opening offline modal works
    await demoLink.click();
    await page.waitForSelector('#google-signin-modal', { state: 'visible' });
    const modalTitle = await page.locator('#google-modal-title').innerText();
    console.log(`   Offline demo modal title: "${modalTitle}"`);
    assert(modalTitle.includes('Register with Google'), 'Modal title is "Register with Google"');
    await page.click('.google-card-close');
    await page.waitForSelector('#google-signin-modal', { state: 'hidden' });
    console.log('   ✓ PASS: Offline / Demo Mode modal tested and dismissed');

    // Simulate official Google OAuth popup callback completion via postMessage event
    console.log('   Simulating official Google Account Chooser selection (postMessage from accounts.google.com callback)...');
    await page.evaluate((data) => {
      window.postMessage({
        type: 'GOOGLE_AUTH_SUCCESS',
        payload: {
          action: 'STUDENT_REGISTER',
          google_email: data.email,
          google_name: data.name,
          google_sub: data.sub
        }
      }, '*');
    }, { email: testStudentEmail, name: testStudentName, sub: testGoogleSub });

    await page.waitForTimeout(600);

    // Verify fields were automatically populated
    const filledName = await page.inputValue('#reg-fullname');
    const filledEmail = await page.inputValue('#reg-email');
    const isEmailReadOnly = await page.getAttribute('#reg-email', 'readonly');

    console.log(`   Auto-filled Full Name: "${filledName}"`);
    console.log(`   Auto-filled Gmail: "${filledEmail}" (readOnly: ${isEmailReadOnly !== null})`);

    assert.strictEqual(filledName, testStudentName, 'Full name was auto-populated from official Google account');
    assert.strictEqual(filledEmail, testStudentEmail, 'Gmail was auto-populated from official Google account');
    assert(isEmailReadOnly !== null, 'Gmail input is locked/readonly after Google auto-fetch');

    // Verify Google Connected Badge
    const badgeVisible = await page.isVisible('#google-connected-badge');
    assert(badgeVisible, '#google-connected-badge is visible');
    const badgeText = await page.locator('#google-connected-badge').innerText();
    console.log(`   Connected badge text: "${badgeText.replace(/\s+/g, ' ')}"`);
    assert(badgeText.includes(testStudentEmail), 'Badge displays connected Google email');
    console.log('   ✓ PASS: Google details auto-fill and security lock verified\n');

    // ─── 3. FILL REMAINING DETAILS & COMPLETE REGISTRATION ───
    console.log('3. Completing remaining registration details (Branch, WhatsApp OTP, Password)...');
    await page.selectOption('#reg-department', '4'); // Information Technology
    await page.waitForTimeout(300);
    await page.selectOption('#reg-semester', '1');
    await page.waitForTimeout(600);

    await page.fill('#reg-enroll', testEnrollment);
    await page.fill('#reg-phone', testPhone);

    // Send WhatsApp OTP
    console.log('   Sending WhatsApp OTP...');
    await page.click('#btn-send-otp');
    await page.waitForSelector('#otp-box', { state: 'visible' });

    assert(await page.isVisible('#wa-qr-card'), 'WhatsApp QR Code card displayed');

    // Auto-fill OTP code
    await page.click('button:has-text("Auto-Fill Code")');
    await page.waitForTimeout(600);
    assert(await page.isVisible('#otp-verified-badge'), 'WhatsApp verified badge displayed');

    // Fill passwords
    await page.fill('#reg-password', 'Password@123');
    await page.fill('#reg-confirm', 'Password@123');

    // Submit registration
    console.log('   Submitting registration form...');
    await page.click('#submit-btn');
    await page.waitForSelector('#success-view', { state: 'visible' });

    const summaryText = await page.locator('#success-summary-box').innerText();
    console.log('   Registration summary:\n' + summaryText);
    assert(summaryText.includes(testStudentName), 'Summary contains student name');
    assert(summaryText.includes(testStudentEmail), 'Summary contains Gmail address');
    assert(summaryText.includes('Connected'), 'Summary confirms Google account is connected');

    // Verify user record in database has status PENDING and correct google_sub
    const dbUser = await query("SELECT id, status, google_sub FROM users WHERE LOWER(email) = ?", [testStudentEmail]);
    assert(dbUser.length > 0, 'User created in database');
    assert.strictEqual(dbUser[0].status, 'PENDING', 'User is PENDING approval');
    assert.strictEqual(dbUser[0].google_sub, testGoogleSub, 'google_sub recorded in database');
    console.log('✓ PASS: Student registration successfully stored with google_sub\n');

    // ─── 4. VERIFY GOOGLE LOGIN ON STUDENT.HTML (PENDING APPROVAL) ───
    console.log('4. Navigating to /login/student.html to test Google Sign-In...');
    await page.goto('http://localhost:3000/login/student.html');
    await page.waitForLoadState('networkidle');

    assert(await page.isVisible('#google-signin-btn'), '#google-signin-btn is visible on student.html');

    // Simulate official Google callback postMessage for pending student
    console.log('   Simulating official Google OAuth callback for pending student...');
    await page.evaluate((email) => {
      window.postMessage({
        type: 'GOOGLE_AUTH_SUCCESS',
        payload: {
          action: 'PENDING_APPROVAL',
          google_email: email,
          message: 'Your registration is pending approval by your Class Teacher.'
        }
      }, '*');
    }, testStudentEmail);

    await page.waitForTimeout(600);

    // Verify #pending-banner is shown
    const isPendingVisible = await page.isVisible('#pending-banner');
    console.log(`   Pending approval banner visible: ${isPendingVisible}`);
    assert(isPendingVisible, '#pending-banner is displayed for pending Google registration');

    // ─── 5. APPROVE STUDENT AND VERIFY SUCCESSFUL 1-CLICK GOOGLE LOGIN ───
    console.log('5. Approving student registration in database...');
    await query("UPDATE users SET status = 'ACTIVE' WHERE LOWER(email) = ?", [testStudentEmail]);

    console.log('   Simulating official Google OAuth login for active student...');
    await page.evaluate((data) => {
      window.postMessage({
        type: 'GOOGLE_AUTH_SUCCESS',
        payload: {
          action: 'LOGIN',
          access_token: 'fake_jwt_token_for_google_login_test',
          user: {
            id: data.id,
            username: data.email,
            email: data.email,
            full_name: data.name,
            roles: ['STUDENT'],
            google_linked: true
          }
        }
      }, '*');
    }, { id: dbUser[0].id, email: testStudentEmail, name: testStudentName });

    // Should redirect to student portal
    await page.waitForURL('**/student/**', { timeout: 5000 });
    const currentUrl = page.url();
    console.log(`   Redirected URL after Google login: ${currentUrl}`);
    assert(currentUrl.includes('/student/'), 'Redirected to student academic portal');

    console.log('✓ PASS: Google official 1-click login verified and authenticated successfully!\n');

    // ─── 6. CLEANUP TEST DATA ───
    console.log('6. Cleaning up test data...');
    const testUsers = await query("SELECT id FROM users WHERE LOWER(email) = ?", [testStudentEmail]);
    if (testUsers.length > 0) {
      await query("DELETE FROM user_roles WHERE user_id = ?", [testUsers[0].id]);
      await query("DELETE FROM students WHERE user_id = ?", [testUsers[0].id]);
      await query("DELETE FROM users WHERE id = ?", [testUsers[0].id]);
    }
    console.log('✓ Teardown complete: Database is pristine.');

    console.log('======================================================');
    console.log('RESULTS: ALL OFFICIAL GOOGLE WINDOW & FLOW TESTS PASSED ✓');
    console.log('======================================================');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      const u = await query("SELECT id FROM users WHERE LOWER(email) = ?", [testStudentEmail]);
      if (u.length > 0) {
        await query("DELETE FROM user_roles WHERE user_id = ?", [u[0].id]);
        await query("DELETE FROM students WHERE user_id = ?", [u[0].id]);
        await query("DELETE FROM users WHERE id = ?", [u[0].id]);
      }
    } catch (_) {}
    await browser.close();
  }
})();
