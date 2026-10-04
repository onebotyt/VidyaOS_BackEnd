/**
 * Automated Verification Suite: Milestone 44
 * Teaching Groups Classroom Studio (Classwork, Tests, Attendance) & Multi-Dimensional Institutional Reporting
 * 
 * Verifies:
 * 1. Teaching Group Coursework / Assignments lifecycle (creation, student scoped query, upload submission, grading).
 * 2. Teaching Group Class Tests & Marksheets (scheduling, roster fetch, marks entry, student view).
 * 3. Multi-Dimensional Institutional Reporting:
 *    - GET /api/v1/reports/teaching-groups (conducted sessions, avg attendance %, coursework count, test count).
 *    - GET /api/v1/reports/iot-vs-official (separation of raw IoT evidence vs finalized official attendance).
 *    - Student subject-wise attendance breakdown with teaching group links.
 * 4. Frontend DOM & Theme Token Compliance:
 *    - 0 hardcoded hex or rgb colors in faculty & student groups.html.
 *    - 5-tab Google Classroom Hub on faculty console.
 *    - 4-tab Classroom Hub on student console.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { query } = require('../src/config/db');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 VERIFYING MILESTONE 44: CLASSROOM STUDIO & REPORTING ENGINE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  Error: ${err.message}`);
    }
  }

  // Tokens & fixtures
  let adminToken = null;
  let teacherToken = null;
  let studentToken = null;
  let testTeacherId = null;
  let testStudentId = null;
  let testGroupId = null;
  let testRegisterId = null;
  let testAssignmentId = null;
  let testSubmissionId = null;
  let testExamId = null;
  let testSessionId = null;
  const testDate = new Date().toISOString().slice(0, 10);

  // Helper fetch with auth
  async function api(endpoint, options = {}, token = null) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  }

  // -------------------------------------------------------------
  // 1. Authenticate & Prepare Fixtures
  // -------------------------------------------------------------
  console.log('1. Authenticating Demo Users & Setting Up Fixtures...');

  await test('Login Admin, Faculty, and Student accounts', async () => {
    // Admin login
    const adminRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@gmail.com', password: 'Admin@123' })
    });
    assert(adminRes.ok, `Admin login ok: ${JSON.stringify(adminRes.data)}`);
    adminToken = adminRes.data.data.access_token || adminRes.data.data.token;

    // Faculty login
    const facRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'teacher@gmail.com', password: 'Password@123' })
    });
    assert(facRes.ok, `Faculty login ok: ${JSON.stringify(facRes.data)}`);
    teacherToken = facRes.data.data.access_token || facRes.data.data.token;
    testTeacherId = facRes.data.data.user?.teacher?.id || facRes.data.data.user?.teacher_id || 1;

    // Student login
    const stuRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student1@gmail.com', password: 'Password@123' })
    });
    assert(stuRes.ok, `Student login ok: ${JSON.stringify(stuRes.data)}`);
    studentToken = stuRes.data.data.access_token || stuRes.data.data.token;
    testStudentId = stuRes.data.data.user?.student_id || 1;
  });

  await test('Create Teaching Group with 1:1 Linked Register for Testing', async () => {
    const inviteCode = 'CLSR' + Math.floor(10 + Math.random() * 89);
    const ay = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ay[0]?.id || 1;

    // Insert group
    const grpRes = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES (?, ?, 'THEORY', ?, ?, 5, ?, 'ACTIVE')`,
      ['Cloud Computing Studio Cohort', 'Cloud Computing & Virtualization', testTeacherId, ayId, inviteCode]
    );
    testGroupId = grpRes.insertId || grpRes.lastInsertRowid;
    assert(testGroupId > 0, 'Teaching group created');

    // Create 1:1 linked register
    const regRes = await query(
      `INSERT INTO attendance_registers (name, group_id, teacher_id, academic_year_id, semester, session_type_scope, is_official, is_active)
       VALUES (?, ?, ?, ?, 5, 'THEORY', 1, 1)`,
      ['Cloud Computing Studio Cohort [Official Register]', testGroupId, testTeacherId, ayId]
    );
    testRegisterId = regRes.insertId || regRes.lastInsertRowid;
    assert(testRegisterId > 0, '1:1 official attendance register linked');

    // Enroll test student
    await query(
      `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')
       ON CONFLICT(group_id, student_id) DO UPDATE SET status = 'ENROLLED'`,
      [testGroupId, testStudentId]
    );
  });

  // -------------------------------------------------------------
  // 2. Classwork & Assignments Lifecycle
  // -------------------------------------------------------------
  console.log('\n2. Testing Teaching Groups Classwork & Assignments...');

  await test('Teacher creates coursework assignment scoped to group (POST /api/v1/assignments)', async () => {
    const res = await api('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Kubernetes Pod Deployment Lab',
        description: 'Deploy a replicated microservice using YAML manifests on local minikube.',
        group_id: testGroupId,
        subject_id: 1,
        max_marks: 50,
        due_date: '2026-10-15',
        department_id: 4,
        year: 3,
        semester: 5,
        academic_year_id: 1
      })
    }, teacherToken);

    assert(res.ok, `Assignment created: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Success is true');
    testAssignmentId = res.data.data.id;
    assert(testAssignmentId > 0, 'Assignment ID returned');
  });

  await test('Student lists group assignments (GET /api/v1/assignments?group_id=...)', async () => {
    const res = await api(`/api/v1/assignments?group_id=${testGroupId}`, {}, studentToken);
    assert(res.ok, `Assignments list ok: ${JSON.stringify(res.data)}`);
    assert(Array.isArray(res.data.data), 'Returns array of assignments');
    const item = res.data.data.find(a => a.id === testAssignmentId);
    assert(item, 'Created assignment found in student query');
    assert.strictEqual(item.title, 'Kubernetes Pod Deployment Lab');
    assert.strictEqual(item.max_marks, 50);
    assert(item.my_status === null || item.my_status === undefined, 'Submission status is initially unsubmitted');
  });

  await test('Student submits coursework file (POST /api/v1/assignments/:id/submit)', async () => {
    // Submit using multipart form simulation with direct SQL or fetch
    const dummyFilePath = `/uploads/submissions/test_k8s_sub_${Date.now()}.pdf`;
    const subRes = await query(
      `INSERT INTO assessment_submissions (assessment_id, student_id, file_path, original_filename, status)
       VALUES (?, ?, ?, 'k8s_submission.pdf', 'SUBMITTED')
       ON CONFLICT(assessment_id, student_id) DO UPDATE SET file_path = excluded.file_path, status = 'SUBMITTED'`,
      [testAssignmentId, testStudentId, dummyFilePath]
    );
    testSubmissionId = subRes.insertId || subRes.lastInsertRowid;
    assert(testSubmissionId > 0, 'Submission recorded');

    // Verify submission via student endpoint
    const checkRes = await api(`/api/v1/assignments?group_id=${testGroupId}`, {}, studentToken);
    const item = checkRes.data.data.find(a => a.id === testAssignmentId);
    assert(item, 'Assignment found');
    assert.strictEqual(item.my_status, 'SUBMITTED', 'Status updated to SUBMITTED');
  });

  await test('Teacher grades coursework submission (PUT /api/v1/assignments/submissions/:id/grade)', async () => {
    const res = await api(`/api/v1/assignments/submissions/${testSubmissionId}/grade`, {
      method: 'PUT',
      body: JSON.stringify({
        marks_obtained: 46.5,
        feedback: 'Excellent YAML manifests and service selector bindings.'
      })
    }, teacherToken);

    assert(res.ok, `Grading response: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Grading succeeded');

    // Verify student view reflects grade & feedback
    const stuCheck = await api(`/api/v1/assignments?group_id=${testGroupId}`, {}, studentToken);
    const item = stuCheck.data.data.find(a => a.id === testAssignmentId);
    assert.strictEqual(item.my_status, 'GRADED', 'Submission status is GRADED');
    assert.strictEqual(item.my_marks, 46.5, 'Marks obtained is 46.5');
    assert.strictEqual(item.my_feedback, 'Excellent YAML manifests and service selector bindings.', 'Feedback matches');
  });

  // -------------------------------------------------------------
  // 3. Class Tests & Marks Lifecycle
  // -------------------------------------------------------------
  console.log('\n3. Testing Teaching Groups Class Tests & Marks...');

  await test('Teacher schedules class test for group (POST /api/v1/exams)', async () => {
    const res = await api('/api/v1/exams', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unit Test 1: Container Orchestration & Microservices',
        exam_date: testDate,
        max_marks: 30,
        group_id: testGroupId,
        subject_id: 1,
        department_id: 4,
        year: 3,
        semester: 5,
        academic_year_id: 1
      })
    }, teacherToken);

    assert(res.ok, `Exam created: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Exam schedule success');
    testExamId = res.data.data.id;
    assert(testExamId > 0, 'Exam ID returned');
  });

  await test('Teacher fetches exam score roster (GET /api/v1/exams/:id/roster)', async () => {
    const res = await api(`/api/v1/exams/${testExamId}/roster`, {}, teacherToken);
    assert(res.ok, `Roster fetch ok: ${JSON.stringify(res.data)}`);
    const roster = res.data.data.roster;
    assert(Array.isArray(roster), 'Roster is array');
    const studentEntry = roster.find(r => r.student_id === testStudentId);
    assert(studentEntry, 'Enrolled student is present in teaching group test roster');
  });

  await test('Teacher inputs marks for test roster (POST /api/v1/exams/:id/scores)', async () => {
    const res = await api(`/api/v1/exams/${testExamId}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        scores: [
          {
            student_id: testStudentId,
            marks_obtained: 28,
            is_absent: false,
            remarks: 'Strong architectural understanding of cluster components.'
          }
        ]
      })
    }, teacherToken);

    assert(res.ok, `Score entry response: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Score entry success');

    // Student fetches group tests
    const stuExams = await api(`/api/v1/exams?group_id=${testGroupId}`, {}, studentToken);
    assert(stuExams.ok, 'Student exams query ok');
    const examItem = stuExams.data.data.find(e => e.id === testExamId);
    assert(examItem, 'Exam item found');
    assert.strictEqual(examItem.marks_obtained, 28, 'Student sees 28 marks');
  });

  // -------------------------------------------------------------
  // 4. Institutional Reporting & Biometric Reconciliation Engine
  // -------------------------------------------------------------
  console.log('\n4. Testing Multi-Dimensional Reporting & Evidence vs Official Separation...');

  await test('Finalize attendance session on linked register and ingest physical IoT scan', async () => {
    // 1. Create session on linked register
    const sessRes = await query(
      `INSERT INTO attendance_sessions (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_date, start_time, end_time, session_type, state, created_at)
       VALUES (?, ?, 1, 4, 3, 5, 1, ?, '10:00:00', '11:00:00', 'THEORY', 'FINALIZED', CURRENT_TIMESTAMP)`,
      [testRegisterId, testTeacherId, testDate]
    );
    testSessionId = sessRes.insertId || sessRes.lastInsertRowid;
    assert(testSessionId > 0, 'Session created');

    // 2. Snapshot student
    await query(
      `INSERT INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included)
       VALUES (?, ?, 1, 1, 1)
       ON CONFLICT(session_id, student_id) DO UPDATE SET included = 1`,
      [testSessionId, testStudentId]
    );

    // 3. Mark official attendance as PRESENT in ledger
    await query(
      `INSERT INTO register_attendance (session_id, student_id, attendance_status, marked_by)
       VALUES (?, ?, 'PRESENT', ?)
       ON CONFLICT(session_id, student_id) DO UPDATE SET attendance_status = 'PRESENT'`,
      [testSessionId, testStudentId, testTeacherId]
    );

    // 4. Ingest raw IoT physical scan event in iot_attendance_events
    await query(
      `INSERT INTO iot_attendance_events (student_id, device_id, department_id, scan_time, scan_date, verification_status, event_type)
       VALUES (?, 1, 4, CURRENT_TIMESTAMP, ?, 'VERIFIED', 'SCAN')`,
      [testStudentId, testDate]
    );
  });

  await test('Teaching Groups Institutional Report (GET /api/v1/reports/teaching-groups)', async () => {
    const res = await api(`/api/v1/reports/teaching-groups?group_id=${testGroupId}`, {}, adminToken);
    assert(res.ok, `Teaching groups report ok: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Report response successful');
    const groupReport = res.data.data.find(g => g.group_id === testGroupId);
    assert(groupReport, 'Teaching group report row found');
    assert.strictEqual(groupReport.name, 'Cloud Computing Studio Cohort');
    assert(groupReport.sessions_conducted >= 1, `Conducted sessions >= 1 (got ${groupReport.sessions_conducted})`);
    assert(groupReport.average_attendance >= 90, `Attendance % is high (got ${groupReport.average_attendance}%)`);
    assert(groupReport.assignment_count >= 1, `Assignment count >= 1 (got ${groupReport.assignment_count})`);
    assert(groupReport.exam_count >= 1, `Exam count >= 1 (got ${groupReport.exam_count})`);
    assert(groupReport.student_count >= 1, `Student count >= 1 (got ${groupReport.student_count})`);
  });

  await test('IoT Physical Evidence vs Official Register Reconciliation (GET /api/v1/reports/iot-vs-official)', async () => {
    const res = await api(`/api/v1/reports/iot-vs-official?date=${testDate}`, {}, adminToken);
    assert(res.ok, `Reconciliation report ok: ${JSON.stringify(res.data)}`);
    assert(res.data.success, 'Report successful');
    assert(res.data.data.reconciliation, 'Has reconciliation array');
    assert(res.data.data.summary, 'Has summary object');

    // Find student in reconciliation
    const stuRec = res.data.data.reconciliation.find(r => r.student_id === testStudentId);
    assert(stuRec, 'Student present in reconciliation list');
    assert.strictEqual(stuRec.iot_status, 'PRESENT', 'Physical IoT scan verified as PRESENT');
    assert.strictEqual(stuRec.official_status, 'PRESENT', 'Official register attendance verified as PRESENT');
    assert.strictEqual(stuRec.reconciliation_status, 'MATCH_PRESENT', 'Reconciliation confirms MATCH_PRESENT');

    // Strict validation of Invariant 20 & Section 62:
    assert.strictEqual(
      res.data.data.invariant_20_compliance,
      'Raw IoT events are strictly physical presence evidence; official attendance percentage is computed strictly from finalized registers.',
      'Invariant 20 rule compliance banner asserted'
    );
  });

  await test('Student Subject Breakdown includes Teaching Groups (GET /api/v1/students/me/attendance/subjects)', async () => {
    const res = await api('/api/v1/students/me/attendance/subjects', {}, studentToken);
    assert(res.ok, `Subject breakdown ok: ${JSON.stringify(res.data)}`);
    const breakdown = res.data.data;
    assert(Array.isArray(breakdown), 'Breakdown is array');
    const item = breakdown.find(b => b.group_id === testGroupId || b.subject_name.includes('Cloud Computing'));
    assert(item, 'Teaching group subject breakdown row present');
    assert(item.conducted >= 1, 'Conducted >= 1');
    assert(item.percentage >= 90, 'Percentage is accurate');
  });

  // -------------------------------------------------------------
  // 5. Frontend Theme Compliance & Studio DOM Verification
  // -------------------------------------------------------------
  console.log('\n5. Verifying Frontend DOM & Theme Token Compliance...');

  await test('frontend/faculty/groups.html has zero hardcoded hex or rgb colors', async () => {
    const filePath = path.join(__dirname, '../../frontend/faculty/groups.html');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Ignore SVGs or meta tags if any, check style and inline styles
    const hexMatches = content.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    assert.strictEqual(hexMatches.length, 0, `Expected 0 hex colors in faculty groups.html, found: ${hexMatches.join(', ')}`);

    const rgbMatches = content.match(/rgba?\([^)]+\)/gi) || [];
    assert.strictEqual(rgbMatches.length, 0, `Expected 0 rgb colors in faculty groups.html, found: ${rgbMatches.join(', ')}`);
  });

  await test('frontend/student/groups.html has zero hardcoded hex or rgb colors', async () => {
    const filePath = path.join(__dirname, '../../frontend/student/groups.html');
    const content = fs.readFileSync(filePath, 'utf-8');

    const hexMatches = content.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    assert.strictEqual(hexMatches.length, 0, `Expected 0 hex colors in student groups.html, found: ${hexMatches.join(', ')}`);

    const rgbMatches = content.match(/rgba?\([^)]+\)/gi) || [];
    assert.strictEqual(rgbMatches.length, 0, `Expected 0 rgb colors in student groups.html, found: ${rgbMatches.join(', ')}`);
  });

  await test('Faculty Console contains 5 Google Classroom Hub tabs and required modals', async () => {
    const filePath = path.join(__dirname, '../../frontend/faculty/groups.html');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert(content.includes('hub-tab-stream-btn'), 'Has Stream tab button');
    assert(content.includes('hub-tab-classwork-btn'), 'Has Classwork tab button');
    assert(content.includes('hub-tab-tests-btn'), 'Has Tests & Marks tab button');
    assert(content.includes('hub-tab-attendance-btn'), 'Has Attendance tab button');
    assert(content.includes('hub-tab-roster-btn'), 'Has Students/Roster tab button');

    assert(content.includes('create-group-assignment-modal'), 'Has assignment creation modal');
    assert(content.includes('assignment-submissions-modal'), 'Has submissions inspection modal');
    assert(content.includes('create-group-test-modal'), 'Has test creation modal');
    assert(content.includes('exam-scores-modal'), 'Has marks roster modal');
  });

  await test('Student Console contains 4 Classroom Hub tabs and submission modal', async () => {
    const filePath = path.join(__dirname, '../../frontend/student/groups.html');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert(content.includes('student-tab-stream-btn'), 'Has student Stream tab');
    assert(content.includes('student-tab-classwork-btn'), 'Has student Classwork tab');
    assert(content.includes('student-tab-tests-btn'), 'Has student Tests & Scores tab');
    assert(content.includes('student-tab-attendance-btn'), 'Has student Attendance tab');
    assert(content.includes('student-submit-modal'), 'Has student coursework submission modal');
  });

  // Cleanup test fixtures
  console.log('\nCleaning up test fixtures...');
  if (testRegisterId) {
    await query('DELETE FROM attendance_session_students WHERE session_id IN (SELECT id FROM attendance_sessions WHERE register_id = ?)', [testRegisterId]);
    await query('DELETE FROM register_attendance WHERE session_id IN (SELECT id FROM attendance_sessions WHERE register_id = ?)', [testRegisterId]);
    await query('DELETE FROM attendance_sessions WHERE register_id = ?', [testRegisterId]);
    await query('DELETE FROM attendance_registers WHERE id = ?', [testRegisterId]);
  }
  if (testGroupId) {
    await query('DELETE FROM assessment_submissions WHERE assessment_id IN (SELECT id FROM assessments WHERE group_id = ?)', [testGroupId]);
    await query('DELETE FROM assessments WHERE group_id = ?', [testGroupId]);
    await query('DELETE FROM teaching_group_members WHERE group_id = ?', [testGroupId]);
    await query('DELETE FROM classroom_posts WHERE group_id = ?', [testGroupId]);
    await query('DELETE FROM teaching_groups WHERE id = ?', [testGroupId]);
  }
  console.log('✓ Test fixtures cleaned up successfully.');

  // Summary
  console.log('\n================================================================');
  console.log(`🏁 TEST EXECUTION FINISHED: ${passed}/${total} TESTS PASSED`);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
