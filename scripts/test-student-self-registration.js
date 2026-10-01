/**
 * E2E Test: Student Self-Registration Flow
 * Tests: cohorts endpoint → register → pending list → adjudicate
 * Run: node backend/scripts/test-student-self-registration.js
 */
const http = require('http');
const https = require('https');

const BASE = 'http://localhost:3000/api/v1';

// ── HTTP helpers ───────────────────────────────────────────
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/v1${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Test runner ────────────────────────────────────────────
let passed = 0, failed = 0;
const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m';

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗ FAIL${RESET} ${label}${detail ? `\n    → ${detail}` : ''}`);
    failed++;
  }
}

async function run() {
  console.log(`\n${BOLD}══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Student Self-Registration E2E Test Suite${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════${RESET}\n`);

  // ── 1. Login as a Class Teacher ──────────────────────────
  console.log(`${YELLOW}► Step 1: Teacher login${RESET}`);
  const loginRes = await request('POST', '/auth/faculty/login', { email: 'classteacher@gmail.com', password: 'Password@123' });
  ok('Teacher login succeeds', loginRes.status === 200 && loginRes.body.success, JSON.stringify(loginRes.body.error));
  const teacherToken = loginRes.body?.data?.access_token || loginRes.body?.data?.token;
  ok('Token received', !!teacherToken);

  // ── 2. GET /auth/student/registration/cohorts (public) ───
  console.log(`\n${YELLOW}► Step 2: Public cohort listing${RESET}`);
  const cohortsRes = await request('GET', '/auth/student/registration/cohorts');
  ok('Cohorts endpoint responds 200', cohortsRes.status === 200, JSON.stringify(cohortsRes.body?.error));
  ok('Response has success flag', cohortsRes.body?.success === true);
  const cohorts = cohortsRes.body?.data || [];
  console.log(`    Cohorts returned: ${cohorts.length} (open registration)`);
  
  // ── 3. Teacher enables registration for a cohort ─────────
  console.log(`\n${YELLOW}► Step 3: Teacher opens registration for a cohort${RESET}`);
  
  // First get teacher's cohorts
  const tCohortsRes = await request('GET', '/faculty/cohorts', null, teacherToken);
  ok('Faculty cohorts endpoint works', tCohortsRes.status === 200, JSON.stringify(tCohortsRes.body?.error));
  const tCohorts = tCohortsRes.body?.data || [];
  
  let testCohort = null;
  if (tCohorts.length > 0) {
    testCohort = tCohorts[0];
    console.log(`    Using cohort: ${testCohort.department_name} Y${testCohort.year} S${testCohort.semester}`);
    
    const toggleRes = await request('POST', '/faculty/cohorts/registration-toggle', {
      department_id: testCohort.department_id,
      branch_id: testCohort.branch_id,
      year: testCohort.year,
      semester: testCohort.semester,
      open: true
    }, teacherToken);
    ok('Registration toggle works', toggleRes.status === 200, JSON.stringify(toggleRes.body?.error));
    
    // Check status
    const statusRes = await request('GET', `/faculty/cohorts/registration-status?department_id=${testCohort.department_id}&branch_id=${testCohort.branch_id}&year=${testCohort.year}&semester=${testCohort.semester}`, null, teacherToken);
    ok('Registration status endpoint works', statusRes.status === 200, JSON.stringify(statusRes.body?.error));
    ok('Registration is now open', statusRes.body?.data?.is_open === true, JSON.stringify(statusRes.body?.data));
  } else {
    console.log(`    ${YELLOW}⚠ No cohorts for this teacher — skipping toggle test${RESET}`);
  }

  // ── 4. Re-check public cohorts (should now include the opened one) ──
  console.log(`\n${YELLOW}► Step 4: Public cohorts after toggle${RESET}`);
  const cohortsRes2 = await request('GET', '/auth/student/registration/cohorts');
  const openCohorts = cohortsRes2.body?.data || [];
  ok('Open cohorts list is non-empty', openCohorts.length > 0 || cohorts.length === 0,
    `Cohort count: ${openCohorts.length}`);
  
  // Use the first open cohort for registration
  const regCohort = openCohorts[0] || (testCohort ? { 
    department_id: testCohort.department_id,
    branch_id: testCohort.branch_id,
    year: testCohort.year,
    semester: testCohort.semester
  } : null);

  // ── 5. Self-Register a new student ──────────────────────
  // Helper to get verified registration OTP token
  async function getRegistrationOtp(identifier) {
    const sendRes = await request('POST', '/auth/otp/send', { identifier, purpose: 'REGISTRATION' });
    const debugOtp = sendRes.body?.data?.debug_otp;
    if (!debugOtp) throw new Error(`Could not get debug_otp for ${identifier}: ${JSON.stringify(sendRes.body)}`);
    const verifyRes = await request('POST', '/auth/otp/verify', { identifier, otp_code: debugOtp, purpose: 'REGISTRATION' });
    return verifyRes.body?.data?.verification_token;
  }

  console.log(`\n${YELLOW}► Step 5: Student self-registration with Mandatory OTP${RESET}`);
  const ts = Date.now();
  let newStudentId = null;
  let studentId2 = null;
  
  if (regCohort) {
    const regBody = {
      full_name: `Test Student ${ts}`,
      official_enrollment_no: `TST${ts}`,
      email: `teststudent${ts}@gmail.com`,
      password: 'TestPass123!',
      department_id: regCohort.department_id,
      branch_id: regCohort.branch_id,
      year: regCohort.year,
      semester: regCohort.semester
    };

    // 5a. Assert missing OTP is blocked
    const noOtpRes = await request('POST', '/auth/student/register', regBody);
    ok('Registration without OTP blocked with 400 OTP_REQUIRED', noOtpRes.status === 400 && noOtpRes.body?.error?.code === 'OTP_REQUIRED', JSON.stringify(noOtpRes.body));

    // Obtain verified OTP token
    regBody.otp_verification_token = await getRegistrationOtp(regBody.email);
    ok('OTP token generated and verified', !!regBody.otp_verification_token, 'Token obtained');

    const regRes = await request('POST', '/auth/student/register', regBody);
    ok('Self-registration returns 201', regRes.status === 201, JSON.stringify(regRes.body?.error));
    ok('Registration success flag', regRes.body?.success === true, JSON.stringify(regRes.body));
    ok('Message mentions pending approval', 
       (regRes.body?.data?.message || '').toLowerCase().includes('pending') || 
       (regRes.body?.message || '').toLowerCase().includes('pending'),
       `Got: ${JSON.stringify(regRes.body)}`
    );
    newStudentId = regRes.body?.data?.student_id;
    console.log(`    Registered student ID: ${newStudentId}`);

    // ── 5b. Try logging in with PENDING status ────────────
    console.log(`\n${YELLOW}► Step 5b: Student login attempt while PENDING${RESET}`);
    const pendingLoginRes = await request('POST', '/auth/student/login', {
      email: regBody.email,
      password: regBody.password
    });
    ok('Pending login returns 403', pendingLoginRes.status === 403, `Got ${pendingLoginRes.status}`);
    ok('Error code is PENDING_APPROVAL', pendingLoginRes.body?.error?.code === 'PENDING_APPROVAL',
       `Got: ${JSON.stringify(pendingLoginRes.body?.error)}`);
  } else {
    console.log(`    ${YELLOW}⚠ No open cohort available — skipping registration${RESET}`);
  }

  // ── 6. Teacher sees pending registrations ────────────────
  console.log(`\n${YELLOW}► Step 6: Pending registrations list${RESET}`);
  const pendingRes = await request('GET', '/students/registrations/pending', null, teacherToken);
  ok('Pending list returns 200', pendingRes.status === 200, JSON.stringify(pendingRes.body?.error));
  ok('Pending list is array', Array.isArray(pendingRes.body?.data), JSON.stringify(pendingRes.body?.data));
  console.log(`    Pending students: ${pendingRes.body?.data?.length || 0}`);

  // ── 7. Pending count endpoint ────────────────────────────
  console.log(`\n${YELLOW}► Step 7: Pending count badge endpoint${RESET}`);
  const countRes = await request('GET', '/students/registrations/count', null, teacherToken);
  ok('Count endpoint returns 200', countRes.status === 200, JSON.stringify(countRes.body?.error));
  ok('Count is a number', typeof countRes.body?.data?.count === 'number', JSON.stringify(countRes.body));
  console.log(`    Badge count: ${countRes.body?.data?.count}`);

  // ── 8. Approve the student ───────────────────────────────
  console.log(`\n${YELLOW}► Step 8: Teacher approves the registration${RESET}`);
  if (newStudentId) {
    const approveRes = await request('POST', `/students/registrations/${newStudentId}/adjudicate`, {
      action: 'APPROVE',
      class_roll_no: 99
    }, teacherToken);
    ok('Approval returns 200', approveRes.status === 200, JSON.stringify(approveRes.body?.error));
    ok('Approval success flag', approveRes.body?.success === true, JSON.stringify(approveRes.body));

    // ── 8b. Approved student can now log in ────────────────
    console.log(`\n${YELLOW}► Step 8b: Approved student login${RESET}`);
    const approvedLoginRes = await request('POST', '/auth/student/login', {
      email: `teststudent${ts}@gmail.com`,
      password: 'TestPass123!'
    });
    ok('Approved student login returns 200', approvedLoginRes.status === 200, 
       `Got ${approvedLoginRes.status}: ${JSON.stringify(approvedLoginRes.body?.error)}`);
    ok('Token returned after approval', !!(approvedLoginRes.body?.data?.access_token || approvedLoginRes.body?.data?.token), JSON.stringify(approvedLoginRes.body));
  } else {
    console.log(`    ${YELLOW}⚠ No student ID — skipping approval test${RESET}`);
  }

  // ── 9. Reject test: Register a second student, then reject ──
  console.log(`\n${YELLOW}► Step 9: Rejection flow${RESET}`);
  if (regCohort) {
    const ts2 = Date.now() + 1;
    const regBody2 = {
      full_name: `Reject Test ${ts2}`,
      official_enrollment_no: `REJ${ts2}`,
      email: `rejecttest${ts2}@gmail.com`,
      password: 'TestPass123!',
      department_id: regCohort.department_id,
      branch_id: regCohort.branch_id,
      year: regCohort.year,
      semester: regCohort.semester
    };
    regBody2.otp_verification_token = await getRegistrationOtp(regBody2.email);
    const regRes2 = await request('POST', '/auth/student/register', regBody2);
    studentId2 = regRes2.body?.data?.student_id;
    if (studentId2) {
      const rejectRes = await request('POST', `/students/registrations/${studentId2}/adjudicate`, {
        action: 'REJECT',
        rejection_reason: 'Test rejection — enrollment number not in college records.'
      }, teacherToken);
      ok('Rejection returns 200', rejectRes.status === 200, JSON.stringify(rejectRes.body?.error));
      ok('Rejection success flag', rejectRes.body?.success === true, JSON.stringify(rejectRes.body));

      // Rejected student cannot log in
      const rejLoginRes = await request('POST', '/auth/student/login', {
        email: regBody2.email,
        password: regBody2.password
      });
      ok('Rejected student cannot log in', rejLoginRes.status === 401 || rejLoginRes.status === 403,
         `Got ${rejLoginRes.status}: ${JSON.stringify(rejLoginRes.body?.error)}`);
    }
  }

  // ── 10. Teacher closes registration ──────────────────────
  console.log(`\n${YELLOW}► Step 10: Close registration${RESET}`);
  if (testCohort) {
    const closeRes = await request('POST', '/faculty/cohorts/registration-toggle', {
      department_id: testCohort.department_id,
      branch_id: testCohort.branch_id,
      year: testCohort.year,
      semester: testCohort.semester,
      open: false
    }, teacherToken);
    ok('Registration close works', closeRes.status === 200, JSON.stringify(closeRes.body?.error));

    // New registration attempt after close should fail or return empty cohorts
    const cohortsAfterClose = await request('GET', '/auth/student/registration/cohorts');
    const openAfterClose = cohortsAfterClose.body?.data || [];
    const stillOpen = openAfterClose.some(c => 
      c.department_id === testCohort.department_id && c.year === testCohort.year && c.semester === testCohort.semester
    );
    ok('Cohort not listed after close', !stillOpen, `Still listed: ${JSON.stringify(openAfterClose)}`);
  }

  // ── 11. Cleanup test fixtures ────────────────────────────
  try {
    const { query: dbQuery } = require('../src/config/db');
    const idsToClean = [newStudentId, studentId2].filter(Boolean);
    if (idsToClean.length > 0) {
      const placeholders = idsToClean.map(() => '?').join(',');
      const users = await dbQuery(`SELECT user_id FROM students WHERE id IN (${placeholders})`, idsToClean);
      const userIds = users.map(u => u.user_id).filter(Boolean);
      await dbQuery(`DELETE FROM enrollments WHERE student_id IN (${placeholders})`, idsToClean);
      await dbQuery(`DELETE FROM student_department_enrollments WHERE student_id IN (${placeholders})`, idsToClean);
      await dbQuery(`DELETE FROM teaching_group_members WHERE student_id IN (${placeholders})`, idsToClean);
      await dbQuery(`DELETE FROM students WHERE id IN (${placeholders})`, idsToClean);
      if (userIds.length > 0) {
        const uPlaceholders = userIds.map(() => '?').join(',');
        await dbQuery(`DELETE FROM user_roles WHERE user_id IN (${uPlaceholders})`, userIds);
        await dbQuery(`DELETE FROM users WHERE id IN (${uPlaceholders})`, userIds);
      }
      console.log(`\n✓ Cleaned up ${idsToClean.length} self-registration test students.`);
    }
  } catch (cleanErr) {
    console.warn('Note on cleanup:', cleanErr.message);
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${BOLD}══════════════════════════════════════════════${RESET}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}  All ${total} tests passed ✓${RESET}`);
  } else {
    console.log(`${GREEN}  ${passed} passed${RESET}  ${RED}${failed} failed${RESET}  (${total} total)`);
  }
  console.log(`${BOLD}══════════════════════════════════════════════${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
