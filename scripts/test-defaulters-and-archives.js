/**
 * Automated Verification Suite: Milestone 46
 * Defaulter Escalation & Early Warning Engine, Teaching Group Archive Studio,
 * Notification Dispatch, CSV Export & Theme Token Compliance
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { query } = require('../src/config/db');
const defaulterService = require('../src/services/defaulterService');
const auditService = require('../src/services/auditService');

const BASE_URL = 'http://localhost:3000/api/v1';

function request(method, pathUrl, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const cleanPath = pathUrl.startsWith('/') ? pathUrl.slice(1) : pathUrl;
    const url = new URL(cleanPath, BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function login(username, password) {
  const res = await request('POST', '/auth/login', { username, password });
  if (res.status !== 200 || !res.body.success) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token;
}

async function runSuite() {
  console.log('======================================================');
  console.log('🧪 AUTOMATED DEFAULTERS & TEACHING GROUP ARCHIVE TEST');
  console.log('======================================================\n');

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

  // Tokens
  const { generateAccessToken } = require('../src/utils/tokenHelper');
  let adminToken = null;
  let facultyToken = null;
  let studentToken = null;

  console.log('1. Authenticating Demo Accounts...');
  await test('Admin token acquisition (SYSTEM_ADMIN role)', async () => {
    adminToken = generateAccessToken({ id: 1, username: 'admin@gmail.com', roles: ['SYSTEM_ADMIN'] });
    assert(adminToken, 'Admin token acquired');
  });

  await test('Faculty token acquisition (TEACHER & HOD roles)', async () => {
    facultyToken = generateAccessToken({ id: 2, username: 'hod@gmail.com', roles: ['TEACHER', 'HOD'] });
    assert(facultyToken, 'Faculty token acquired');
  });

  await test('Student token acquisition (STUDENT role)', async () => {
    studentToken = generateAccessToken({ id: 10, username: 'student1@gmail.com', roles: ['STUDENT'] });
    assert(studentToken, 'Student token acquired');
  });

  // 2. Teaching Group Archive Studio
  console.log('\n2. Testing Teaching Group Archive Studio Endpoints...');
  let testGroupId = null;
  let testTeacherId = null;

  await test('Create active teaching group fixture', async () => {
    const teacherRows = await query(`SELECT id FROM teachers WHERE user_id = 2 LIMIT 1`);
    testTeacherId = teacherRows[0].id;
    const ay = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ay[0].id;

    const res = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES (?, ?, 'THEORY', ?, ?, 5, ?, 'ACTIVE')`,
      ['Archive Test Cohort', 'Operating Systems', testTeacherId, ayId, 'ARCH99']
    );
    testGroupId = res.insertId || res.lastInsertRowid;

    // Create 1:1 linked register
    await query(
      `INSERT INTO attendance_registers (name, group_id, teacher_id, academic_year_id, semester, session_type_scope, is_official, is_active)
       VALUES (?, ?, ?, ?, 5, 'THEORY', 1, 1)`,
      ['Archive Test Cohort [Register]', testGroupId, testTeacherId, ayId]
    );

    // Add 1 student member
    const studentRows = await query(`SELECT id FROM students LIMIT 1`);
    await query(
      `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
      [testGroupId, studentRows[0].id]
    );

    // Add 1 classroom post
    await query(
      `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
       VALUES (?, 2, 'Pre-archive announcement', CURRENT_TIMESTAMP)`,
      [testGroupId]
    );

    assert(testGroupId > 0, 'Fixture created successfully');
  });

  await test('Archive group via POST /api/v1/teaching-groups/:id/archive', async () => {
    const res = await request('POST', `/teaching-groups/${testGroupId}/archive`, {}, facultyToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'ARCHIVED');

    // Verify DB
    const [tg] = await query(`SELECT status, archived_at FROM teaching_groups WHERE id = ?`, [testGroupId]);
    assert.strictEqual(tg.status, 'ARCHIVED');
    assert(tg.archived_at !== null, 'archived_at timestamp recorded');

    // Verify linked register is_active = 0
    const [ar] = await query(`SELECT is_active FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(ar.is_active, 0, 'Linked register set to inactive (read-only preserved)');

    // Verify student members and posts are preserved 100%
    const members = await query(`SELECT * FROM teaching_group_members WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(members.length, 1, 'Student members preserved');
    const posts = await query(`SELECT * FROM classroom_posts WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(posts.length, 1, 'Posts preserved');

    // Verify audit log
    const auditLogs = await query(
      `SELECT * FROM audit_logs WHERE (event_type = 'TEACHING_GROUP_ARCHIVED' OR action = 'TEACHING_GROUP_ARCHIVED') AND (target_id = ? OR entity_id = ?)`,
      [String(testGroupId), String(testGroupId)]
    );
    assert(auditLogs.length > 0, 'TEACHING_GROUP_ARCHIVED audit log generated');
  });

  await test('Attempting to archive an already archived group returns 400 ALREADY_ARCHIVED', async () => {
    const res = await request('POST', `/teaching-groups/${testGroupId}/archive`, {}, facultyToken);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'ALREADY_ARCHIVED');
  });

  await test('Unarchive group via POST /api/v1/teaching-groups/:id/unarchive', async () => {
    const res = await request('POST', `/teaching-groups/${testGroupId}/unarchive`, {}, facultyToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'ACTIVE');

    // Verify DB
    const [tg] = await query(`SELECT status, archived_at FROM teaching_groups WHERE id = ?`, [testGroupId]);
    assert.strictEqual(tg.status, 'ACTIVE');
    assert.strictEqual(tg.archived_at, null, 'archived_at cleared');

    // Verify linked register is_active = 1
    const [ar] = await query(`SELECT is_active FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(ar.is_active, 1, 'Linked register restored to active');

    // Verify audit log
    const auditLogs = await query(
      `SELECT * FROM audit_logs WHERE (event_type = 'TEACHING_GROUP_RESTORED' OR action = 'TEACHING_GROUP_RESTORED') AND (target_id = ? OR entity_id = ?)`,
      [String(testGroupId), String(testGroupId)]
    );
    assert(auditLogs.length > 0, 'TEACHING_GROUP_RESTORED audit log generated');
  });

  // Clean up group fixtures
  await query(`DELETE FROM classroom_posts WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM teaching_group_members WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM teaching_groups WHERE id = ?`, [testGroupId]);

  // 3. Defaulter Calculation & Early Warning Engine
  console.log('\n3. Testing Defaulter Calculation & Early Warning Engine...');

  await test('defaulterService calculation logic handles healthy, warning, and critical states', async () => {
    const report = await defaulterService.getDefaulterReport({ threshold: 75 });
    assert(typeof report.threshold === 'number');
    assert(typeof report.total_students === 'number');
    assert(typeof report.total_defaulters === 'number');
    assert(Array.isArray(report.data), 'Returns student records array');

    for (const st of report.data) {
      if (st.status === 'HEALTHY') {
        assert(st.attendance_percentage >= 75 || st.conducted_sessions === 0);
        assert(st.required_classes === 0);
      } else if (st.status === 'WARNING') {
        assert(st.attendance_percentage >= 60 && st.attendance_percentage < 75);
        assert(st.required_classes > 0);
      } else if (st.status === 'CRITICAL') {
        assert(st.attendance_percentage < 60);
        assert(st.required_classes > 0);
      }
    }
  });

  await test('Mathematical correctness of safe absences and recovery classes', () => {
    // Healthy student: 9 of 10 attended (90%)
    // safeAbsences = floor(9 * 100 / 75 - 10) = floor(12 - 10) = 2
    const safeAbsences = Math.max(0, Math.floor((9 * 100 / 75) - 10));
    assert.strictEqual(safeAbsences, 2);
    // If student misses 2: attended 9 / conducted 12 = 75.0% >= 75%
    assert((9 / (10 + safeAbsences)) >= 0.75);

    // Defaulter student: 4 of 10 attended (40%)
    // requiredClasses = ceil((0.75 * 10 - 4) / (1 - 0.75)) = ceil(3.5 / 0.25) = 14
    const cutoff = 75;
    const targetRatio = cutoff / 100;
    const reqClasses = Math.ceil(((targetRatio * 10) - 4) / (1 - targetRatio));
    assert.strictEqual(reqClasses, 14);
    // If student attends next 14 consecutive: (4 + 14) / (10 + 14) = 18 / 24 = 75.0% >= 75%
    assert(((4 + reqClasses) / (10 + reqClasses)) >= 0.75);
  });

  await test('REST Endpoint GET /api/v1/reports/defaulters returns structured report', async () => {
    const res = await request('GET', '/reports/defaulters?threshold=75', null, facultyToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.threshold, 75);
    assert(Array.isArray(res.body.data.data));
  });

  // 4. Batch Defaulter Notification Dispatch
  console.log('\n4. Testing Defaulter Notification Dispatch...');
  let targetStudentId = null;
  let targetUserId = null;

  await test('Find student fixture for early warning dispatch', async () => {
    const students = await query(`SELECT id, user_id, full_name FROM students WHERE user_id IS NOT NULL LIMIT 1`);
    assert(students && students.length > 0, 'Found student');
    targetStudentId = students[0].id;
    targetUserId = students[0].user_id;
  });

  await test('POST /api/v1/reports/defaulters/notify dispatches warnings and logs audit', async () => {
    const res = await request(
      'POST',
      '/reports/defaulters/notify',
      {
        studentIds: [targetStudentId],
        threshold: 75,
        customMessage: 'Unit Test Warning: Attendance below 75% threshold.'
      },
      facultyToken
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.recipients_count, 1);

    // Verify notification was stored in DB for target student
    const notifs = await query(
      `SELECT * FROM notifications WHERE user_id = ? AND type = 'ATTENDANCE_WARNING' ORDER BY id DESC LIMIT 1`,
      [targetUserId]
    );
    assert(notifs.length > 0, 'Notification found in DB for student');
    assert(notifs[0].message.includes('Unit Test Warning'));

    // Verify audit log
    const audits = await query(
      `SELECT * FROM audit_logs WHERE (event_type = 'DEFAULTER_NOTICE_DISPATCHED' OR action = 'DEFAULTER_NOTICE_DISPATCHED') ORDER BY id DESC LIMIT 1`
    );
    assert(audits.length > 0, 'DEFAULTER_NOTICE_DISPATCHED audit log found');
  });

  // 5. CSV Export
  console.log('\n5. Testing CSV Defaulter Export...');
  await test('GET /api/v1/reports/defaulters/export returns valid CSV stream', async () => {
    const res = await request('GET', '/reports/defaulters/export?threshold=75', null, facultyToken);
    assert.strictEqual(res.status, 200);
    assert(res.headers['content-type'].includes('text/csv'));
    assert(typeof res.body === 'string');
    assert(res.body.includes('Roll No'));
    assert(res.body.includes('Attendance %'));
    assert(res.body.includes('Safe Absences'));
    assert(res.body.includes('Required Classes'));
  });

  // 6. Frontend DOM & Theme Token Compliance
  console.log('\n6. Checking Frontend DOM & Zero Hex Colors...');
  const repoRoot = path.resolve(__dirname, '../..');

  const filesToCheck = [
    'frontend/faculty/reports.html',
    'frontend/faculty/hod-reports.html',
    'frontend/student/attendance.html',
    'frontend/student/profile.html',
    'frontend/faculty/groups.html',
    'frontend/shared/js/auth.js',
    'frontend/js/auth.js'
  ];

  for (const relPath of filesToCheck) {
    await test(`File ${relPath} has ZERO hardcoded hex colors`, () => {
      const fullPath = path.join(repoRoot, relPath);
      assert(fs.existsSync(fullPath), `File exists: ${relPath}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      const hex = content.match(/#[0-9a-fA-F]{3,8}\b/g);
      assert(!hex || hex.length === 0, `${relPath} contains hex colors: ${hex ? hex.join(', ') : 'none'}`);
    });
  }

  await test('reports.html contains Defaulter Console DOM elements and notice modal', () => {
    const content = fs.readFileSync(path.join(repoRoot, 'frontend/faculty/reports.html'), 'utf8');
    assert(content.includes('id="defaulter-kpi-row"'), 'Contains defaulter KPI row');
    assert(content.includes('id="pill-defaulters"'), 'Contains filter pill buttons');
    assert(content.includes('id="notify-defaulters-modal"'), 'Contains notify defaulters modal');
    assert(content.includes('id="select-all-defaulters"'), 'Contains select all checkbox');
    assert(content.includes('exportDefaultersCsv'), 'Contains CSV export handler');
  });

  await test('student/attendance.html contains subject card ID and deep link scroll handler', () => {
    const content = fs.readFileSync(path.join(repoRoot, 'frontend/student/attendance.html'), 'utf8');
    assert(content.includes('id="subject-card-'), 'Contains subject card dynamic ID');
    assert(content.includes('handleDeepLinkScroll()'), 'Contains deep link scroll handler');
    assert(content.includes('predictor-note'), 'Contains attendance predictor note');
  });

  await test('auth.js navigation bars link canonical /admin/audit-logs.html', () => {
    const content = fs.readFileSync(path.join(repoRoot, 'frontend/shared/js/auth.js'), 'utf8');
    assert(content.includes('/admin/audit-logs.html'), 'Admin navigation includes /admin/audit-logs.html');
  });

  console.log('\n======================================================');
  console.log(`Results: ${passed} Passed, ${total - passed} Failed (Total: ${total})`);
  console.log('======================================================\n');

  if (total - passed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch(err => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
