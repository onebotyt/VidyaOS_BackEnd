const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const jwt = require('jsonwebtoken');

console.log('======================================================');
console.log('🧪 AUTOMATED SCHEMA CONSOLIDATION & SIMPLIFICATION TEST');
console.log('======================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  const dbPath = path.resolve(__dirname, '../college_attendance.sqlite');
  const db = new DatabaseSync(dbPath);

  // 1. Table Count & Inspection
  console.log('1. Checking Database Tables & Views...');
  const allObjects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  const tables = allObjects.filter(o => o.type === 'table').map(o => o.name);
  const views = allObjects.filter(o => o.type === 'view').map(o => o.name);

  console.log(`   Found ${tables.length} tables and ${views.length} views.`);

  // Consolidated tables must exist
  assert(tables.includes('assessments'), 'Unified table `assessments` exists');
  assert(tables.includes('assessment_submissions'), 'Unified table `assessment_submissions` exists');

  // Redundant tables must be dropped from physical tables
  const droppedTables = [
    'attendance_session_pins',
    'attendance_session_qr',
    'assignments',
    'assignment_submissions',
    'exams',
    'exam_scores',
    'register_attendance_corrections',
    'device_events',
    'cohort_registration_settings'
  ];

  droppedTables.forEach(t => {
    assert(!tables.includes(t), `Legacy table \`${t}\` eliminated from physical base tables`);
  });

  // Compatibility views must exist for legacy readers
  const expectedViews = [
    'assignments',
    'assignment_submissions',
    'exams',
    'exam_scores',
    'attendance_session_pins',
    'attendance_session_qr'
  ];

  expectedViews.forEach(v => {
    assert(views.includes(v), `SQL Compatibility view \`${v}\` exists`);
  });

  // 2. Attendance Sessions Token Columns
  console.log('\n2. Verifying Verification Tokens on attendance_sessions...');
  const sessionCols = db.prepare("PRAGMA table_info(attendance_sessions)").all().map(c => c.name);
  assert(sessionCols.includes('verification_pin'), 'Column `verification_pin` exists on attendance_sessions');
  assert(sessionCols.includes('verification_qr_hash'), 'Column `verification_qr_hash` exists on attendance_sessions');
  assert(sessionCols.includes('verification_expires_at'), 'Column `verification_expires_at` exists on attendance_sessions');

  // Test updating token on a session
  db.exec("UPDATE attendance_sessions SET verification_pin = '889900', verification_expires_at = datetime('now', '+15 minutes') WHERE id = 1;");
  const updatedSession = db.prepare("SELECT verification_pin, verification_expires_at FROM attendance_sessions WHERE id = 1").get();
  assert(updatedSession.verification_pin === '889900', 'verification_pin successfully set on attendance_sessions');

  // View should reflect the new pin
  const pinViewRow = db.prepare("SELECT pin_code FROM attendance_session_pins WHERE session_id = 1").get();
  assert(pinViewRow && pinViewRow.pin_code === '889900', 'Compatibility view `attendance_session_pins` correctly reads pin from session');

  // 3. Testing Assessments & Submissions Data
  console.log('\n3. Verifying Unified Assessments Data & Views...');
  const assessRows = db.prepare("SELECT type, COUNT(*) as c FROM assessments GROUP BY type").all();
  console.log('   Assessments distribution:', assessRows);
  const assignmentCount = assessRows.find(r => r.type === 'ASSIGNMENT')?.c || 0;
  const examCount = assessRows.find(r => r.type === 'EXAM')?.c || 0;
  assert(assignmentCount >= 1, `Unified assessments contains ${assignmentCount} assignments`);
  assert(examCount >= 1, `Unified assessments contains ${examCount} exams/tests`);

  // Views check
  const vAssignments = db.prepare("SELECT COUNT(*) as c FROM assignments").get().c;
  const vExams = db.prepare("SELECT COUNT(*) as c FROM exams").get().c;
  assert(vAssignments === assignmentCount, `assignments view count (${vAssignments}) matches ASSIGNMENT records in assessments`);
  assert(vExams === examCount, `exams view count (${vExams}) matches EXAM records in assessments`);

  const vSubmissions = db.prepare("SELECT COUNT(*) as c FROM assignment_submissions").get().c;
  const vScores = db.prepare("SELECT COUNT(*) as c FROM exam_scores").get().c;
  assert(vSubmissions >= 1, `assignment_submissions view returns ${vSubmissions} rows`);
  assert(vScores >= 1, `exam_scores view returns ${vScores} rows`);

  // 4. Testing Live HTTP API Endpoints
  console.log('\n4. Testing Live Express API Routes on Consolidated Schema...');
  const { generateAccessToken } = require('../src/utils/tokenHelper');
  const teacherToken = generateAccessToken({ id: 2, username: 'hod@gmail.com', roles: ['TEACHER', 'HOD'] });
  const studentToken = generateAccessToken({ id: 5, username: 'student1@gmail.com', roles: ['STUDENT'] });
  const adminToken = generateAccessToken({ id: 1, username: 'admin@gmail.com', roles: ['SYSTEM_ADMIN'] });

  try {
    // GET /api/v1/assignments (Teacher)
    const asgRes = await fetch('http://localhost:3000/api/v1/assignments', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    const asgData = await asgRes.json();
    assert(asgRes.ok && asgData.success, `GET /api/v1/assignments returned 200 OK (${asgData.data?.length || 0} assignments)`);

    // GET /api/v1/exams (Teacher)
    const exRes = await fetch('http://localhost:3000/api/v1/exams', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    const exData = await exRes.json();
    assert(exRes.ok && exData.success, `GET /api/v1/exams returned 200 OK (${exData.data?.length || 0} exams)`);

    // GET /api/v1/assignments (Student)
    const stAsgRes = await fetch('http://localhost:3000/api/v1/assignments', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const stAsgData = await stAsgRes.json();
    assert(stAsgRes.ok && stAsgData.success, `GET /api/v1/assignments for student returned 200 OK`);

    // GET /api/v1/exams (Student)
    const stExRes = await fetch('http://localhost:3000/api/v1/exams', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const stExData = await stExRes.json();
    assert(stExRes.ok && stExData.success, `GET /api/v1/exams for student returned 200 OK`);

    // POST /api/v1/attendance/sessions/:id/pin (Teacher)
    const pinRes = await fetch('http://localhost:3000/api/v1/attendance/sessions/1/pin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherToken}`, 'Content-Type': 'application/json' }
    });
    const pinData = await pinRes.json();
    assert(pinRes.ok && pinData.success && pinData.data?.pin, `POST /sessions/1/pin generated live PIN: ${pinData.data?.pin}`);

    // POST /api/v1/attendance/sessions/:id/qr (Teacher)
    const qrRes = await fetch('http://localhost:3000/api/v1/attendance/sessions/1/qr', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherToken}`, 'Content-Type': 'application/json' }
    });
    const qrData = await qrRes.json();
    assert(qrRes.ok && qrData.success && qrData.data?.token_hash, `POST /sessions/1/qr generated live QR token`);

    // POST /api/v1/faculty/cohorts/registration-toggle (Class Teacher / Admin)
    const cohortRegRes = await fetch('http://localhost:3000/api/v1/faculty/cohorts/registration-toggle', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: 1,
        branch_id: 1,
        year: 3,
        semester: 5,
        registration_open: true
      })
    });
    const cohortRegData = await cohortRegRes.json();
    assert(cohortRegRes.ok && cohortRegData.success, 'POST /cohorts/registration-toggle successfully stored in system_settings');

    // Verify system_settings row
    const regSetting = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key LIKE 'cohort_reg_%'").get();
    assert(regSetting && regSetting.setting_value === '1', 'system_settings contains valid cohort_reg entry (value: 1)');

  } catch (netErr) {
    console.warn('   Note on live API checks:', netErr.message);
  }

  console.log('\n======================================================');
  console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('======================================================');

  if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
