/**
 * Automated Verification Suite for Milestone 47:
 * Department Students Architecture & Ubiquitous Faculty Enrollment Approval
 * (Eliminating Class Teacher Dependency per redesign.md Sections 13, 14, 65 & Invariant 5)
 */

const http = require('http');
const { query } = require('../src/config/db');

const BASE_URL = 'http://localhost:3000';

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Department Students & Ubiquitous Enrollment Approval Test Suite');
  console.log('  (redesign.md Sections 13, 14, 65 & Invariant 5)');
  console.log('══════════════════════════════════════════════════════════════════\n');

  try {
    // ─────────────────────────────────────────────────────────
    // Step 1: Regular Department Teacher Login (NOT Class Teacher)
    // ─────────────────────────────────────────────────────────
    console.log('► Step 1: Regular Department Teacher Login (Prof. Amit Verma - IT Dept)');
    const regTeacherLogin = await request('/api/v1/auth/faculty/login', { method: 'POST' }, {
      email: 'teacher@gmail.com',
      password: 'Password@123'
    });
    assert(regTeacherLogin.statusCode === 200, 'Teacher login returns 200');
    assert(regTeacherLogin.json?.data?.access_token, 'JWT access token received');
    const teacherToken = regTeacherLogin.json?.data?.access_token;
    const teacherUser = regTeacherLogin.json?.data?.user;

    assert(teacherUser.department_id === 4, 'Teacher department_id is 4 (Information Technology)');
    assert(teacherUser.is_class_teacher === false, 'Teacher is strictly NOT a Class Teacher (is_class_teacher === false)');
    assert(teacherUser.is_hod === false, 'Teacher is strictly NOT an HOD (is_hod === false)');

    // ─────────────────────────────────────────────────────────
    // Step 2: Cohort Listing for Regular Department Faculty
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 2: Cohort Listing for Regular Department Faculty');
    const cohortsRes = await request('/api/v1/faculty/cohorts', {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(cohortsRes.statusCode === 200, 'GET /faculty/cohorts returns 200');
    assert(Array.isArray(cohortsRes.json?.data), 'Response data is an array of cohorts');
    const itCohort = cohortsRes.json?.data?.find(c => c.department_id === 4);
    assert(Boolean(itCohort), `Regular teacher receives IT department cohort (Found: ${itCohort?.department_name || itCohort?.branch_name} Y${itCohort?.year} S${itCohort?.semester})`);

    // ─────────────────────────────────────────────────────────
    // Step 3: Self-Registration Toggle by Regular Department Faculty
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 3: Self-Registration Toggle by Regular Department Faculty');
    const toggleRes = await request('/api/v1/faculty/cohorts/registration-toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    }, {
      department_id: itCohort.department_id,
      year: itCohort.year,
      semester: itCohort.semester,
      open: true
    });
    assert(toggleRes.statusCode === 200, 'Regular department teacher can toggle registration OPEN');
    assert(toggleRes.json?.data?.is_open === true, 'Cohort registration status confirmed OPEN');

    const statusRes = await request(
      `/api/v1/faculty/cohorts/registration-status?department_id=${itCohort.department_id}&year=${itCohort.year}&semester=${itCohort.semester}`,
      { headers: { Authorization: `Bearer ${teacherToken}` } }
    );
    assert(statusRes.statusCode === 200, 'GET /cohorts/registration-status returns 200');
    assert(statusRes.json?.data?.is_open === true, 'Status endpoint confirms is_open is true');

    // ─────────────────────────────────────────────────────────
    // Step 4: Prospective Student Self-Registration
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 4: Prospective Student Self-Registration');
    async function getOtpToken(identifier) {
      const sendRes = await request('/api/v1/auth/otp/send', { method: 'POST' }, { identifier, purpose: 'REGISTRATION' });
      const otp = sendRes.json?.data?.debug_otp;
      const verifyRes = await request('/api/v1/auth/otp/verify', { method: 'POST' }, { identifier, otp_code: otp, purpose: 'REGISTRATION' });
      return verifyRes.json?.data?.verification_token;
    }

    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const testEnroll = `2026ITUBI${randSuffix}`;
    const testEmail = `ubiq.student${randSuffix}@gmail.com`;
    const testOtpToken = await getOtpToken(testEmail);

    const regStudentRes = await request('/api/v1/auth/student/register', { method: 'POST' }, {
      full_name: `Ubiquitous Student ${randSuffix}`,
      official_enrollment_no: testEnroll,
      registration_no: `UBTER${randSuffix}`,
      email: testEmail,
      password: 'Password@123',
      otp_verification_token: testOtpToken,
      department_id: itCohort.department_id,
      year: itCohort.year,
      semester: itCohort.semester
    });
    assert(regStudentRes.statusCode === 201, 'Student self-registration returns 201 Created');
    assert(regStudentRes.json?.data?.student_id, 'New student record created');
    const newStudentId = regStudentRes.json?.data?.student_id;

    // ─────────────────────────────────────────────────────────
    // Step 5: Regular Department Faculty Access to Pending Queue
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 5: Regular Department Faculty Access to Pending Queue');
    const pendingRes = await request('/api/v1/students/registrations/pending', {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(pendingRes.statusCode === 200, 'GET /students/registrations/pending returns 200 for regular teacher');
    assert(Array.isArray(pendingRes.json?.data), 'Pending registrations is an array');
    const foundPending = pendingRes.json?.data?.find(s => s.student_id === newStudentId || s.official_enrollment_no === testEnroll);
    assert(Boolean(foundPending), `Registered student ${testEnroll} appears in regular teacher pending list`);

    const countRes = await request('/api/v1/students/registrations/count', {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(countRes.statusCode === 200, 'GET /students/registrations/count returns 200 for regular teacher');
    assert(typeof countRes.json?.data?.count === 'number' && countRes.json?.data?.count >= 1, `Pending count badge is valid (${countRes.json?.data?.count})`);

    // ─────────────────────────────────────────────────────────
    // Step 6: Approval Adjudication by Regular Department Faculty
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 6: Approval Adjudication by Regular Department Faculty');
    const assignedRoll = 77;
    const approveRes = await request(`/api/v1/students/registrations/${newStudentId}/adjudicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    }, {
      action: 'APPROVE',
      class_roll_no: assignedRoll
    });
    assert(approveRes.statusCode === 200, 'Regular department faculty APPROVES student registration (200 OK)');
    assert(approveRes.json?.success === true, 'Approval returns success: true');

    // Verify student is now active and can log in
    const approvedStudentLogin = await request('/api/v1/auth/student/login', { method: 'POST' }, {
      email: testEmail,
      password: 'Password@123'
    });
    assert(approvedStudentLogin.statusCode === 200, 'Approved student logs in successfully with email');
    assert(approvedStudentLogin.json?.data?.access_token, 'Approved student receives JWT token');

    // Verify student_department_enrollments record was created
    const timeAwareEnr = await query(
      `SELECT * FROM student_department_enrollments WHERE student_id = ? AND status = 'ACTIVE'`,
      [newStudentId]
    );
    assert(timeAwareEnr.length > 0, 'Time-aware department enrollment created in student_department_enrollments');
    assert(Number(timeAwareEnr[0]?.class_roll_no) === Number(assignedRoll), `Class roll number assigned correctly (${assignedRoll})`);

    // ─────────────────────────────────────────────────────────
    // Step 7: Rejection Adjudication by Regular Department Faculty
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 7: Rejection Adjudication by Regular Department Faculty');
    const rejSuffix = Math.floor(1000 + Math.random() * 9000);
    const rejEnroll = `2026ITREJ${rejSuffix}`;
    const rejEmail = `rej.student${rejSuffix}@gmail.com`;
    const rejOtpToken = await getOtpToken(rejEmail);
    const rejStudentRes = await request('/api/v1/auth/student/register', { method: 'POST' }, {
      full_name: `Reject Test Student ${rejSuffix}`,
      official_enrollment_no: rejEnroll,
      email: rejEmail,
      password: 'Password@123',
      otp_verification_token: rejOtpToken,
      department_id: itCohort.department_id,
      year: itCohort.year,
      semester: itCohort.semester
    });
    const rejStudentId = rejStudentRes.json?.data?.student_id;

    const rejectRes = await request(`/api/v1/students/registrations/${rejStudentId}/adjudicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    }, {
      action: 'REJECT',
      rejection_reason: 'Invalid enrollment certificate provided'
    });
    assert(rejectRes.statusCode === 200, 'Regular department faculty REJECTS student registration (200 OK)');

    const rejectedLogin = await request('/api/v1/auth/student/login', { method: 'POST' }, {
      email: rejEmail,
      password: 'Password@123'
    });
    assert(rejectedLogin.statusCode === 403, 'Rejected student is blocked from logging in (403 Forbidden)');

    // ─────────────────────────────────────────────────────────
    // Step 8: Cross-Department Protection (RBAC)
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 8: Cross-Department Protection (RBAC)');
    const otherDeptTeachers = await query(
      `SELECT t.id, t.user_id, u.email FROM teachers t JOIN users u ON t.user_id = u.id WHERE t.department_id != 4 LIMIT 1`
    );
    if (otherDeptTeachers.length > 0) {
      const { generateAccessToken } = require('../src/utils/tokenHelper');
      const otherUser = (await query(`SELECT * FROM users WHERE id = ?`, [otherDeptTeachers[0].user_id]))[0];
      const otherRoles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [otherUser.id]);
      otherUser.roles = otherRoles.map(r => r.role);
      otherUser.teacher_id = otherDeptTeachers[0].id;
      const otherToken = generateAccessToken(otherUser);

      const testCrossSuffix = Math.floor(1000 + Math.random() * 9000);
      const crossEnroll = `2026ITCRS${testCrossSuffix}`;
      const crossEmail = `cross.student${testCrossSuffix}@gmail.com`;
      const crossOtpToken = await getOtpToken(crossEmail);
      const crossStudentRes = await request('/api/v1/auth/student/register', { method: 'POST' }, {
        full_name: `Cross Dept Student ${testCrossSuffix}`,
        official_enrollment_no: crossEnroll,
        email: crossEmail,
        password: 'Password@123',
        otp_verification_token: crossOtpToken,
        department_id: 4,
        year: 3,
        semester: 5
      });
      const crossStudentId = crossStudentRes.json?.data?.student_id;

      const crossAdjudicate = await request(`/api/v1/students/registrations/${crossStudentId}/adjudicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}` }
      }, {
        action: 'APPROVE',
        class_roll_no: 99
      });
      assert(crossAdjudicate.statusCode === 403, 'Cross-department teacher BLOCKED from adjudicating IT student (403 Forbidden)');
    } else {
      console.log('  ℹ️ Note: No non-IT teacher found in DB, skipping cross-dept check');
    }

    // ─────────────────────────────────────────────────────────
    // Step 9: Close Registration Cleanly
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 9: Close Registration Cleanly');
    const closeRes = await request('/api/v1/faculty/cohorts/registration-toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    }, {
      department_id: itCohort.department_id,
      year: itCohort.year,
      semester: itCohort.semester,
      open: false
    });
    assert(closeRes.statusCode === 200, 'Registration toggle closed successfully');
    assert(closeRes.json?.data?.is_open === false, 'Confirmed is_open is false');

    // ─────────────────────────────────────────────────────────
    // Step 10: Frontend DOM & Tokenization Verification
    // ─────────────────────────────────────────────────────────
    console.log('\n► Step 10: Frontend DOM & Tokenization Verification');
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, '../../frontend/faculty/students.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert(htmlContent.includes('Department Students &amp; Enrollment'), 'Page title mentions Department Students & Enrollment');
    assert(htmlContent.includes('Department Cohort:'), 'Cohort label updated to Department Cohort:');
    assert(htmlContent.includes('Department Faculty Access'), 'Badge shows Department Faculty Access');
    assert(htmlContent.includes('requireDepartmentFaculty: true'), 'guardRoute enforces requireDepartmentFaculty');

    // Zero hex colors check
    const hexMatches = htmlContent.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    assert(hexMatches.length === 0, `Zero hardcoded hex colors in students.html (found: ${hexMatches.length})`);

    // Shared auth.js check
    const authJsPath = path.join(__dirname, '../../frontend/shared/js/auth.js');
    const authContent = fs.readFileSync(authJsPath, 'utf8');
    assert(authContent.includes('requireDepartmentFaculty'), 'shared/js/auth.js supports requireDepartmentFaculty');
    // ─────────────────────────────────────────────────────────
    // Step 11: Cleanup test fixtures
    // ─────────────────────────────────────────────────────────
    try {
      const { query: dbQuery } = require('../src/config/db');
      const idsToClean = [newStudentId, rejStudentId, typeof crossStudentId !== 'undefined' ? crossStudentId : null].filter(Boolean);
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
        console.log(`  ✓ Cleaned up ${idsToClean.length} test students`);
      }
    } catch (cleanErr) {
      console.warn('Note on cleanup:', cleanErr.message);
    }

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} Passed, ${failed} Failed`);
    console.log('══════════════════════════════════════════════════════════════════');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled error during test execution:', err);
    process.exit(1);
  }
}

run();
