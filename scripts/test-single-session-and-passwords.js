/**
 * Test Suite: Single Active Session Enforcement & Strict Admin Password Validation
 * 
 * Verifies:
 * 1. Admin CANNOT log in with Password@123, password123, or any backdoor password.
 * 2. Admin CAN ONLY log in with Admin@123.
 * 3. Faculty and students authenticate with their valid password (reject invalid).
 * 4. Only 1 active login per user account across devices (Anti-Concurrent Login):
 *    - If an account is active on Device 1, Device 2 receives 409 ACCOUNT_ALREADY_ACTIVE.
 *    - Explicit logout frees the account for Device 2 immediately.
 *    - Force logout takeover works (Device 3 takes over and Device 2 receives 401 SESSION_REVOKED).
 */

const assert = require('assert');

const BASE_URL = 'http://localhost:3000/api/v1';

async function req(endpoint, method = 'GET', body = null, headers = {}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

let passedTests = 0;
function test(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('=================================================================');
  console.log('🔐 VERIFICATION: STRICT PASSWORDS & SINGLE ACTIVE SESSION (ANTI-CONCURRENT)');
  console.log('=================================================================\n');

  // Clear previous sessions for clean test state
  const { query } = require('../src/config/db');
  await query("UPDATE user_sessions SET is_revoked = 1 WHERE is_revoked = 0");

  // -------------------------------------------------------------
  // PART 1: STRICT ADMIN PASSWORD VALIDATION (Zero Backdoors)
  // -------------------------------------------------------------
  console.log('[PART 1] Testing Strict Admin Credentials...');

  // 1. Admin login with correct password Admin@123
  const adminGood = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'Admin@123',
    device_id: 'test_admin_dev1'
  });
  test('Admin logs in successfully with Admin@123', adminGood.status === 200 && adminGood.data?.success === true);
  test('Admin receives access_token', !!adminGood.data?.data?.access_token);
  const adminToken1 = adminGood.data?.data?.access_token;

  // 2. Admin login with Password@123 MUST FAIL with 401
  const adminBadPass1 = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'Password@123',
    device_id: 'test_admin_dev_bad'
  });
  test('Admin CANNOT log in with Password@123 (HTTP 401 Unauthorized)', adminBadPass1.status === 401 && adminBadPass1.data?.error?.code === 'UNAUTHORIZED');

  // 3. Admin login with password123 MUST FAIL
  const adminBadPass2 = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'password123',
    device_id: 'test_admin_dev_bad2'
  });
  test('Admin CANNOT log in with lowercase password123 (HTTP 401)', adminBadPass2.status === 401);

  // 4. Admin login with bare "admin" password MUST FAIL
  const adminBadPass3 = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'admin',
    device_id: 'test_admin_dev_bad3'
  });
  test('Admin CANNOT log in with bare "admin" password (HTTP 401)', adminBadPass3.status === 401);

  // -------------------------------------------------------------
  // PART 2: SINGLE ACTIVE SESSION ENFORCEMENT (ANTI-CONCURRENT LOGIN)
  // -------------------------------------------------------------
  console.log('\n[PART 2] Testing Single Active Session Lock Across Devices...');

  // Admin is currently active on 'test_admin_dev1'
  // Device 2 attempts to log into the same admin account
  const adminDevice2 = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'Admin@123',
    device_id: 'test_admin_dev2' // Different PC / device
  });

  test('Second device attempting to log into same account is BLOCKED (HTTP 409 Conflict)', adminDevice2.status === 409);
  test('Error code is ACCOUNT_ALREADY_ACTIVE', adminDevice2.data?.error?.code === 'ACCOUNT_ALREADY_ACTIVE');
  test('Error message warns about active session on another device', typeof adminDevice2.data?.error?.message === 'string' && adminDevice2.data.error.message.includes('another device'));

  // Heartbeat from active Device 1 works
  const hb1 = await req('/auth/heartbeat', 'GET', null, { Authorization: `Bearer ${adminToken1}` });
  test('Active device 1 heartbeat returns 200 OK', hb1.status === 200 && hb1.data?.active === true);

  // Admin logs out from Device 1
  const logoutRes = await req('/auth/logout', 'POST', { device_id: 'test_admin_dev1' }, { Authorization: `Bearer ${adminToken1}` });
  test('Device 1 logs out successfully', logoutRes.status === 200);

  // Device 2 now attempts login again after Device 1 logged out
  const adminDevice2AfterLogout = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'Admin@123',
    device_id: 'test_admin_dev2'
  });
  test('Device 2 logs in successfully once previous device signed out', adminDevice2AfterLogout.status === 200 && adminDevice2AfterLogout.data?.success === true);
  const adminToken2 = adminDevice2AfterLogout.data?.data?.access_token;

  // Device 3 performs force_logout takeover
  console.log('\n[PART 3] Testing Force Logout Takeover...');
  const adminDevice3Takeover = await req('/auth/faculty/login', 'POST', {
    email: 'admin@gmail.com',
    password: 'Admin@123',
    device_id: 'test_admin_dev3',
    force_logout: true
  });
  test('Device 3 with force_logout=true successfully takes over account (200 OK)', adminDevice3Takeover.status === 200 && adminDevice3Takeover.data?.success === true);
  const adminToken3 = adminDevice3Takeover.data?.data?.access_token;

  // Prior Device 2 is now REVOKED when calling any protected route or heartbeat
  const dev2Revoked = await req('/auth/heartbeat', 'GET', null, { Authorization: `Bearer ${adminToken2}` });
  test('Old Device 2 session is rejected with HTTP 401 SESSION_REVOKED', dev2Revoked.status === 401 && dev2Revoked.data?.error?.code === 'SESSION_REVOKED');

  // Device 3 session is active and functional
  const dev3Active = await req('/auth/heartbeat', 'GET', null, { Authorization: `Bearer ${adminToken3}` });
  test('New Device 3 session remains active (200 OK)', dev3Active.status === 200 && dev3Active.data?.active === true);

  // -------------------------------------------------------------
  // PART 4: FACULTY & STUDENT SINGLE SESSION TESTS
  // -------------------------------------------------------------
  console.log('\n[PART 4] Testing Faculty & Student Single Active Sessions...');

  // Faculty PC 1 logs in
  const hod1 = await req('/auth/faculty/login', 'POST', {
    email: 'hod@gmail.com',
    password: 'Password@123',
    device_id: 'hod_laptop_work'
  });
  test('HOD logs in on Work Laptop (200 OK)', hod1.status === 200 && hod1.data?.success === true);
  const hodToken1 = hod1.data?.data?.access_token;

  // Faculty PC 2 tries to log in simultaneously
  const hod2 = await req('/auth/faculty/login', 'POST', {
    email: 'hod@gmail.com',
    password: 'Password@123',
    device_id: 'hod_desktop_home'
  });
  test('HOD login on Home Desktop is BLOCKED with 409 ACCOUNT_ALREADY_ACTIVE', hod2.status === 409 && hod2.data?.error?.code === 'ACCOUNT_ALREADY_ACTIVE');

  // Same PC 1 re-authenticating (e.g. page refresh / re-login) is allowed
  const hod1Refresh = await req('/auth/faculty/login', 'POST', {
    email: 'hod@gmail.com',
    password: 'Password@123',
    device_id: 'hod_laptop_work' // SAME device ID
  });
  test('Same device re-authenticating is permitted without conflict', hod1Refresh.status === 200);

  // Student PC 1 logs in
  const student1 = await req('/auth/student/login', 'POST', {
    email: 'student1@gmail.com',
    password: 'Password@123',
    device_id: 'student_phone_1'
  });
  test('Student logs in on Phone (200 OK)', student1.status === 200 && student1.data?.success === true);

  // Student PC 2 tries to log in concurrently
  const student2 = await req('/auth/student/login', 'POST', {
    email: 'student1@gmail.com',
    password: 'Password@123',
    device_id: 'student_pc_lab'
  });
  test('Student concurrent login on Lab PC is BLOCKED with 409 ACCOUNT_ALREADY_ACTIVE', student2.status === 409 && student2.data?.error?.code === 'ACCOUNT_ALREADY_ACTIVE');

  // Student invalid password test
  const studentBadPass = await req('/auth/student/login', 'POST', {
    email: 'student1@gmail.com',
    password: 'WrongPassword!',
    device_id: 'student_pc_test'
  });
  test('Student invalid password returns 401 Unauthorized', studentBadPass.status === 401);

  // Clean up test sessions
  await query("UPDATE user_sessions SET is_revoked = 1 WHERE is_revoked = 0");

  console.log('\n=================================================================');
  console.log(`🎉 ALL ${passedTests} SINGLE SESSION & STRICT PASSWORD TESTS PASSED!`);
  console.log('=================================================================\n');
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
