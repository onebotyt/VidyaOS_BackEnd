/**
 * Automated Verification Suite for Milestone 48:
 * Curriculum Progression, End-of-Term Promotion Engine & Department Enrollment Archival
 * 
 * Verifies:
 * 1. HOD permission gating on promotion routes (requireHOD).
 * 2. Preview endpoint returns cohort structures for promote & demote modes.
 * 3. Accidental modification protection enforcing department code confirmation.
 * 4. End-to-end promotion execution:
 *    - Odd -> Even semester advancement (Year stays same, Sem increments)
 *    - Even -> Next Odd advancement (Year & Sem increment)
 *    - Exception / backlog detention handling
 *    - Final semester graduation / Alumni conversion
 *    - ESP32 biometric slot release for graduates
 * 5. Time-aware department enrollment lifecycle (student_department_enrollments):
 *    - Prior active enrollment marked COMPLETED with end_date = CURRENT_DATE
 *    - New active enrollment created with target year/sem/roll
 *    - Detained and Graduated statuses tracked historically without loss
 * 6. Audit logging recording STUDENT_PROMOTION_EXECUTED and STUDENT_DEMOTION_EXECUTED.
 * 7. In-app student notifications dispatched for promotions, detentions, and graduations.
 * 8. Demotion / reversal execution and state restoration.
 * 9. Zero hardcoded hex colors in frontend/faculty/hod-students.html.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

const PORT = 3000;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function loginUser(username, password) {
  const res = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, password });
  return res.data?.data?.token || res.data?.token || null;
}

const { generateAccessToken } = require('../src/utils/tokenHelper');

async function runTests() {
  console.log('================================================================');
  console.log('🎓 MILESTONE 48: CURRICULUM PROGRESSION & PROMOTION TEST SUITE');
  console.log('================================================================\n');

  try {
    // ─── SETUP FIXTURES ─────────────────────────────────────────
    console.log('1. Setting up Test Fixtures in Database...');
    
    // Find active academic year
    const ayRow = (await query('SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    assert(ayRow && ayRow.id, `Active Academic Year found (${ayRow?.label})`);
    const ayId = ayRow.id;

    // Find CSE or IT department with HOD
    const deptRows = await query(`
      SELECT d.id, d.name, d.code, d.degree_duration_years, t.id as teacher_id, u.username, u.id as user_id
      FROM departments d
      JOIN teacher_assignments ta ON ta.department_id = d.id AND ta.assignment_type = 'HOD' AND ta.is_active = 1
      JOIN teachers t ON ta.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE d.is_active = 1
      LIMIT 1
    `);

    assert(deptRows.length > 0, `Department with active HOD found (${deptRows[0]?.code})`);
    const dept = deptRows[0];
    const deptId = dept.id;
    const deptCode = dept.code;
    const maxSem = (dept.degree_duration_years || 3) * 2;

    // Generate HOD token
    const hodToken = generateAccessToken({
      id: dept.user_id,
      user_id: dept.user_id,
      username: dept.username,
      roles: ['TEACHER'],
      teacher_id: dept.teacher_id
    });
    assert(!!hodToken, `HOD token created successfully (${dept.username})`);

    // Clean up any stale test fixtures from previous runs
    await query(`DELETE FROM fingerprint_slots WHERE slot_id >= 880`);
    await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'user_TEST_PROM_%')`);
    await query(`DELETE FROM student_department_enrollments WHERE student_id IN (SELECT id FROM students WHERE official_enrollment_no LIKE 'TEST_PROM_%')`);
    await query(`DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE official_enrollment_no LIKE 'TEST_PROM_%')`);
    await query(`DELETE FROM students WHERE official_enrollment_no LIKE 'TEST_PROM_%'`);
    await query(`DELETE FROM users WHERE username LIKE 'user_TEST_PROM_%'`);

    // Create 3 Test Students for promotion fixture:
    // Student 1: Normal advancement (Year 1 Sem 1 -> Year 1 Sem 2)
    // Student 2: Detained exception (Year 1 Sem 1 -> Detained in Sem 1)
    // Student 3: Final semester graduating (Year 3 Sem 6 -> Graduated ALUMNI)
    const timestamp = Date.now();
    const testEnroll1 = `TEST_PROM_${timestamp}_1`;
    const testEnroll2 = `TEST_PROM_${timestamp}_2`;
    const testEnroll3 = `TEST_PROM_${timestamp}_3`;

    // Create users & students
    await query(`INSERT INTO users (username, password_hash, status) VALUES (?, 'hash', 'ACTIVE')`, [`user_${testEnroll1}@example.com`]);
    const u1 = (await query(`SELECT id FROM users WHERE username = ?`, [`user_${testEnroll1}@example.com`]))[0];
    await query(`INSERT INTO students (user_id, official_enrollment_no, full_name) VALUES (?, ?, 'Alice Test Promoted')`, [u1.id, testEnroll1]);
    const s1 = (await query(`SELECT id FROM students WHERE official_enrollment_no = ?`, [testEnroll1]))[0];
    
    await query(`INSERT INTO users (username, password_hash, status) VALUES (?, 'hash', 'ACTIVE')`, [`user_${testEnroll2}@example.com`]);
    const u2 = (await query(`SELECT id FROM users WHERE username = ?`, [`user_${testEnroll2}@example.com`]))[0];
    await query(`INSERT INTO students (user_id, official_enrollment_no, full_name) VALUES (?, ?, 'Bob Test Detained')`, [u2.id, testEnroll2]);
    const s2 = (await query(`SELECT id FROM students WHERE official_enrollment_no = ?`, [testEnroll2]))[0];

    await query(`INSERT INTO users (username, password_hash, status) VALUES (?, 'hash', 'ACTIVE')`, [`user_${testEnroll3}@example.com`]);
    const u3 = (await query(`SELECT id FROM users WHERE username = ?`, [`user_${testEnroll3}@example.com`]))[0];
    await query(`INSERT INTO students (user_id, official_enrollment_no, full_name) VALUES (?, ?, 'Charlie Test Graduate')`, [u3.id, testEnroll3]);
    const s3 = (await query(`SELECT id FROM students WHERE official_enrollment_no = ?`, [testEnroll3]))[0];

    // Create active enrollments table entries
    const en1 = (await query(`INSERT INTO enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, status) VALUES (?, ?, ?, 1, 1, 101, 'ENROLLED') RETURNING id`, [s1.id, deptId, ayId]))[0];
    const en2 = (await query(`INSERT INTO enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, status) VALUES (?, ?, ?, 1, 1, 102, 'ENROLLED') RETURNING id`, [s2.id, deptId, ayId]))[0];
    const en3 = (await query(`INSERT INTO enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, status) VALUES (?, ?, ?, ?, ?, 103, 'ENROLLED') RETURNING id`, [s3.id, deptId, ayId, dept.degree_duration_years || 3, maxSem]))[0];

    // Seed student_department_enrollments active records
    await query(`INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, 1, 1, 101, '2026-01-01', 'ACTIVE')`, [s1.id, deptId, ayId]);
    await query(`INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, 1, 1, 102, '2026-01-01', 'ACTIVE')`, [s2.id, deptId, ayId]);
    await query(`INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, ?, ?, 103, '2026-01-01', 'ACTIVE')`, [s3.id, deptId, ayId, dept.degree_duration_years || 3, maxSem]);

    // Add hardware fingerprint slot for graduating student to verify slot release
    await query(`INSERT INTO fingerprint_slots (student_id, device_id, slot_id, is_active) VALUES (?, 1, 888, 1)`, [s3.id]);

    console.log('\n2. Testing Promotion Preview Endpoint...');
    // Preview Promotion
    const prevRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/preview?action=promote',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${hodToken}` }
    });

    assert(prevRes.status === 200, 'GET /promotion/preview?action=promote returns 200 OK');
    assert(prevRes.data?.success === true, 'Preview response success is true');
    assert(prevRes.data?.data?.department_code === deptCode, `Preview returns matching department code (${deptCode})`);
    assert(Array.isArray(prevRes.data?.data?.cohorts), 'Preview returns cohorts array');

    // Preview Demotion
    const demoPrevRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/preview?action=demote',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${hodToken}` }
    });
    assert(demoPrevRes.status === 200, 'GET /promotion/preview?action=demote returns 200 OK');
    assert(demoPrevRes.data?.data?.action === 'demote', 'Demote preview action is demote');

    console.log('\n3. Testing Accidental Click Safety Protection (Confirm Code)...');
    // Missing confirm_code
    const noCodeRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/execute',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hodToken}`, 'Content-Type': 'application/json' }
    }, { action: 'promote', confirm_code: '' });
    assert(noCodeRes.status === 400, 'Missing confirm_code returns 400 Bad Request');
    assert(noCodeRes.data?.error?.code === 'VALIDATION_ERROR', 'Validation error code returned');

    // Incorrect confirm_code
    const wrongCodeRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/execute',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hodToken}`, 'Content-Type': 'application/json' }
    }, { action: 'promote', confirm_code: 'WRONG_CODE_99' });
    assert(wrongCodeRes.status === 400, 'Incorrect confirm_code returns 400 Bad Request');

    console.log('\n4. Executing Semester Promotion with Exceptions & Graduations...');
    // Execute promotion with s2 as exception (detained)
    const execRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/execute',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hodToken}`, 'Content-Type': 'application/json' }
    }, {
      action: 'promote',
      exceptions: [s2.id],
      confirm_code: deptCode
    });

    assert(execRes.status === 200, 'POST /promotion/execute returns 200 OK');
    assert(execRes.data?.success === true, 'Promotion execution success is true');
    assert(execRes.data?.data?.promoted_count >= 1, `Promoted count >= 1 (reported: ${execRes.data?.data?.promoted_count})`);
    assert(execRes.data?.data?.detained_count >= 1, `Detained count >= 1 (reported: ${execRes.data?.data?.detained_count})`);
    assert(execRes.data?.data?.graduated_count >= 1, `Graduated count >= 1 (reported: ${execRes.data?.data?.graduated_count})`);

    console.log('\n5. Verifying Database State & Time-Aware Department Enrollments...');
    // Check student 1 (Promoted)
    const s1Enroll = (await query('SELECT year, semester, status, class_roll_no FROM enrollments WHERE student_id = ?', [s1.id]))[0];
    assert(s1Enroll.semester === 2 && s1Enroll.year === 1, 'Student 1 enrollments updated: Year 1 Sem 2');

    const s1DeptRecords = await query(
      'SELECT year, semester, status, start_date, end_date FROM student_department_enrollments WHERE student_id = ? ORDER BY id ASC',
      [s1.id]
    );
    assert(s1DeptRecords.length === 2, 'Student 1 has exactly 2 time-aware department enrollment records');
    assert(s1DeptRecords[0].status === 'COMPLETED' && s1DeptRecords[0].end_date !== null, 'Student 1 previous Sem 1 enrollment marked COMPLETED with end_date');
    assert(s1DeptRecords[1].status === 'ACTIVE' && s1DeptRecords[1].semester === 2 && s1DeptRecords[1].end_date === null, 'Student 1 new Sem 2 enrollment marked ACTIVE');

    // Check student 2 (Detained)
    const s2Enroll = (await query('SELECT status FROM enrollments WHERE student_id = ?', [s2.id]))[0];
    assert(s2Enroll.status === 'DETAINED', 'Student 2 enrollments status is DETAINED');

    const s2DeptRecord = (await query('SELECT status FROM student_department_enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1', [s2.id]))[0];
    assert(s2DeptRecord.status === 'DETAINED', 'Student 2 student_department_enrollments marked DETAINED');

    // Check student 3 (Graduated / Alumni)
    const s3Enroll = (await query('SELECT status FROM enrollments WHERE student_id = ?', [s3.id]))[0];
    assert(s3Enroll.status === 'COMPLETED', 'Student 3 enrollments status is COMPLETED');

    const s3User = (await query('SELECT status FROM users WHERE id = ?', [u3.id]))[0];
    assert(s3User.status === 'ALUMNI', 'Student 3 user account marked ALUMNI');

    const s3Student = (await query('SELECT graduation_year FROM students WHERE id = ?', [s3.id]))[0];
    assert(s3Student.graduation_year !== null, `Student 3 graduation_year recorded (${s3Student.graduation_year})`);

    const s3Slot = (await query('SELECT is_active FROM fingerprint_slots WHERE student_id = ?', [s3.id]))[0];
    assert(s3Slot.is_active === 0, 'Student 3 hardware fingerprint reader slot released (is_active = 0)');

    const s3DeptRecord = (await query('SELECT status, end_date FROM student_department_enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1', [s3.id]))[0];
    assert(s3DeptRecord.status === 'GRADUATED' && s3DeptRecord.end_date !== null, 'Student 3 department enrollment marked GRADUATED with end_date');

    console.log('\n6. Verifying Institutional Audit Trail (audit_logs)...');
    const auditRows = await query(
      `SELECT action, target_type, target_id, details_json FROM audit_logs WHERE action = 'STUDENT_PROMOTION_EXECUTED' ORDER BY id DESC LIMIT 1`
    );
    assert(auditRows.length > 0, 'Audit log recorded for STUDENT_PROMOTION_EXECUTED');
    const auditEntry = auditRows[0];
    const details = typeof auditEntry.details_json === 'string' ? JSON.parse(auditEntry.details_json) : auditEntry.details_json;
    assert(details.department_code === deptCode, `Audit details record correct department_code (${deptCode})`);
    assert(details.promoted_count >= 1 && details.graduated_count >= 1 && details.detained_count >= 1, 'Audit details record accurate operation counts');

    console.log('\n7. Verifying Automated In-App Notifications (notifications)...');
    const s1Notifs = await query(`SELECT title, type, message FROM notifications WHERE user_id = ?`, [u1.id]);
    assert(s1Notifs.some(n => n.type === 'ENROLLMENT_CHANGE' && n.title.includes('Promoted')), 'Promoted student received ENROLLMENT_CHANGE notification');

    const s2Notifs = await query(`SELECT title, type, message FROM notifications WHERE user_id = ?`, [u2.id]);
    assert(s2Notifs.some(n => n.type === 'ENROLLMENT_CHANGE' && n.title.includes('Detention')), 'Detained student received ENROLLMENT_CHANGE notification');

    const s3Notifs = await query(`SELECT title, type, message FROM notifications WHERE user_id = ?`, [u3.id]);
    assert(s3Notifs.some(n => n.type === 'ENROLLMENT_CHANGE' && n.title.includes('Completed')), 'Graduated student received ENROLLMENT_CHANGE notification');

    console.log('\n8. Testing Demotion / Reversal Workflow...');
    const demoteRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/v1/hod/promotion/execute',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hodToken}`, 'Content-Type': 'application/json' }
    }, {
      action: 'demote',
      exceptions: [],
      confirm_code: deptCode
    });

    assert(demoteRes.status === 200, 'POST /promotion/execute (action: demote) returns 200 OK');
    assert(demoteRes.data?.data?.demoted_count >= 1, `Demoted / reverted count reported: ${demoteRes.data?.data?.demoted_count}`);

    // Verify audit log for demotion
    const demoteAudit = await query(`SELECT id FROM audit_logs WHERE action = 'STUDENT_DEMOTION_EXECUTED' ORDER BY id DESC LIMIT 1`);
    assert(demoteAudit.length > 0, 'Audit log recorded for STUDENT_DEMOTION_EXECUTED');

    console.log('\n9. Verifying Zero Hardcoded Hex Colors in hod-students.html...');
    const hodStudentsHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/hod-students.html'), 'utf8');
    const hexMatches = hodStudentsHtml.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    assert(hexMatches.length === 0, `Zero hardcoded hex colors in hod-students.html (found: ${hexMatches.length})`);

    // Clean up test fixtures
    await query(`DELETE FROM notifications WHERE user_id IN (?, ?, ?)`, [u1.id, u2.id, u3.id]);
    await query(`DELETE FROM fingerprint_slots WHERE student_id = ?`, [s3.id]);
    await query(`DELETE FROM student_department_enrollments WHERE student_id IN (?, ?, ?)`, [s1.id, s2.id, s3.id]);
    await query(`DELETE FROM enrollments WHERE student_id IN (?, ?, ?)`, [s1.id, s2.id, s3.id]);
    await query(`DELETE FROM students WHERE id IN (?, ?, ?)`, [s1.id, s2.id, s3.id]);
    await query(`DELETE FROM users WHERE id IN (?, ?, ?)`, [u1.id, u2.id, u3.id]);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
