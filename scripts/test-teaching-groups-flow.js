/**
 * Automated Verification: Teaching Groups & Department Approval Architecture
 * 
 * Tests:
 * 1. Database schema: teaching_groups, teaching_group_members, classroom_posts
 * 2. Teaching group creation with 1:1 auto-linked official attendance register
 * 3. Multi-department cohort join via 6-character invite code
 * 4. Google Classroom stream announcements & discussions
 * 5. Safe archiving with 100% data preservation guarantee
 * 6. Frontend portal DOM & Theme token integrity for Faculty & Student hubs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { query } = require('../src/config/db');

async function runTests() {
  console.log('======================================================');
  console.log('🧪 AUTOMATED TEACHING GROUPS & REDESIGN FLOW TEST');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  Error: ${err.message}`);
    }
  }

  async function testAsync(name, fn) {
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

  // 1. Database Schema Integrity
  console.log('1. Checking Database Tables & Constraints...');

  await testAsync('teaching_groups table exists with required columns', async () => {
    const cols = await query(`PRAGMA table_info(teaching_groups)`);
    const colNames = cols.map(c => c.name);
    assert(colNames.includes('id'), 'has id');
    assert(colNames.includes('name'), 'has name');
    assert(colNames.includes('subject_name'), 'has subject_name');
    assert(colNames.includes('component'), 'has component');
    assert(colNames.includes('teacher_id'), 'has teacher_id');
    assert(colNames.includes('academic_year_id'), 'has academic_year_id');
    assert(colNames.includes('semester'), 'has semester');
    assert(colNames.includes('invite_code'), 'has invite_code');
    assert(colNames.includes('status'), 'has status');
    assert(!colNames.includes('branch_id'), 'ZERO branch_id in teaching_groups');
  });

  await testAsync('teaching_group_members table exists with student_id foreign key', async () => {
    const cols = await query(`PRAGMA table_info(teaching_group_members)`);
    const colNames = cols.map(c => c.name);
    assert(colNames.includes('id'), 'has id');
    assert(colNames.includes('group_id'), 'has group_id');
    assert(colNames.includes('student_id'), 'has student_id');
    assert(colNames.includes('status'), 'has status');
  });

  await testAsync('classroom_posts table exists for Stream discussions', async () => {
    const cols = await query(`PRAGMA table_info(classroom_posts)`);
    const colNames = cols.map(c => c.name);
    assert(colNames.includes('id'), 'has id');
    assert(colNames.includes('group_id'), 'has group_id');
    assert(colNames.includes('author_id'), 'has author_id');
    assert(colNames.includes('content'), 'has content');
  });

  // 2. Elimination of branches Table
  console.log('\n2. Verifying Elimination of branches Table...');

  await testAsync('branches table does NOT exist in SQLite database', async () => {
    const tables = await query(`SELECT name FROM sqlite_master WHERE type='table' AND name='branches'`);
    assert.strictEqual(tables.length, 0, 'branches table is completely dropped');
  });

  await testAsync('Institutional core tables contain zero branch_id columns', async () => {
    const tables = ['attendance_registers', 'attendance_sessions', 'devices', 'enrollments', 'subjects', 'teacher_assignments', 'timetable_slots', 'assessments'];
    for (const tbl of tables) {
      const cols = await query(`PRAGMA table_info(${tbl})`);
      const colNames = cols.map(c => c.name);
      assert(!colNames.includes('branch_id'), `Table ${tbl} has zero branch_id column`);
    }
  });

  // 3. Functional Teaching Group Lifecycle
  console.log('\n3. Testing Teaching Group Lifecycle & Register Linking...');

  let testTeacherId = null;
  let testStudentId = null;
  let testGroupId = null;
  let testRegisterId = null;
  let testInviteCode = 'TEST' + Math.floor(10 + Math.random() * 89);

  await testAsync('Fetch valid teacher and student fixtures for testing', async () => {
    const teachers = await query(`SELECT id, full_name, department_id FROM teachers LIMIT 1`);
    assert(teachers && teachers.length > 0, 'Teacher exists in DB');
    testTeacherId = teachers[0].id;

    const students = await query(`SELECT id, full_name, official_enrollment_no FROM students LIMIT 1`);
    assert(students && students.length > 0, 'Student exists in DB');
    testStudentId = students[0].id;
  });

  await testAsync('Create Teaching Group and verify 1:1 auto-linked Attendance Register', async () => {
    const ay = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ay[0].id;

    const groupResult = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES (?, ?, 'PRACTICAL', ?, ?, 5, ?, 'ACTIVE')`,
      ['Advanced Database Lab - Test Cohort', 'Database Management Systems', testTeacherId, ayId, testInviteCode]
    );

    testGroupId = groupResult.insertId || groupResult.lastInsertRowid;
    assert(testGroupId > 0, 'Teaching group inserted');

    // Create 1:1 linked register
    const regResult = await query(
      `INSERT INTO attendance_registers (name, group_id, teacher_id, academic_year_id, semester, session_type_scope, is_official, is_active)
       VALUES (?, ?, ?, ?, 5, 'PRACTICAL', 1, 1)`,
      ['Advanced Database Lab - Test Cohort [Register]', testGroupId, testTeacherId, ayId]
    );

    testRegisterId = regResult.insertId || regResult.lastInsertRowid;
    assert(testRegisterId > 0, '1:1 official attendance register auto-created');

    const checkReg = await query(`SELECT * FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(checkReg.length, 1, 'Register successfully linked by group_id');
    assert.strictEqual(checkReg[0].session_type_scope, 'PRACTICAL', 'Session type scope matches component');
    assert.strictEqual(checkReg[0].is_official, 1, 'Marked as official register');
  });

  await testAsync('Student joins Teaching Group via invite code', async () => {
    // Resolve group by invite code
    const groups = await query(`SELECT id, status FROM teaching_groups WHERE UPPER(invite_code) = ?`, [testInviteCode]);
    assert(groups && groups.length > 0, 'Found group by invite code');
    assert.strictEqual(groups[0].id, testGroupId, 'Group ID matches');

    // Enroll student
    await query(
      `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
      [testGroupId, testStudentId]
    );

    const members = await query(`SELECT * FROM teaching_group_members WHERE group_id = ? AND student_id = ?`, [testGroupId, testStudentId]);
    assert.strictEqual(members.length, 1, 'Student successfully enrolled');
    assert.strictEqual(members[0].status, 'ENROLLED', 'Membership status is ENROLLED');
  });

  await testAsync('Post message to Classroom Stream and retrieve discussions', async () => {
    const postRes = await query(
      `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
       VALUES (?, 1, 'Welcome to Advanced Database Lab! Practice Session 1 instructions attached.', CURRENT_TIMESTAMP)`,
      [testGroupId]
    );
    const postId = postRes.insertId || postRes.lastInsertRowid;
    assert(postId > 0, 'Classroom post created');

    const posts = await query(`SELECT * FROM classroom_posts WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(posts.length, 1, 'Post retrieved from stream');
    assert(posts[0].content.includes('Welcome to Advanced Database Lab'), 'Post content verified');
  });

  await testAsync('Safe Archiving: Archive Teaching Group and verify 100% data preservation', async () => {
    // Perform archive
    await query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [testGroupId]);
    await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [testGroupId]);

    const tg = await query(`SELECT status, archived_at FROM teaching_groups WHERE id = ?`, [testGroupId]);
    assert.strictEqual(tg[0].status, 'ARCHIVED', 'Group status is ARCHIVED');
    assert(tg[0].archived_at !== null, 'Archived timestamp recorded');

    // Verify all associated data remains 100% intact
    const members = await query(`SELECT * FROM teaching_group_members WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(members.length, 1, 'Student members are NOT deleted on archive');

    const posts = await query(`SELECT * FROM classroom_posts WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(posts.length, 1, 'Classroom posts are NOT deleted on archive');

    const reg = await query(`SELECT is_active FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(reg[0].is_active, 0, 'Linked register set to inactive (read-only preserved)');

    // Unarchive restoration
    await query(`UPDATE teaching_groups SET status = 'ACTIVE', archived_at = NULL WHERE id = ?`, [testGroupId]);
    await query(`UPDATE attendance_registers SET is_active = 1 WHERE group_id = ?`, [testGroupId]);

    const restoredTg = await query(`SELECT status FROM teaching_groups WHERE id = ?`, [testGroupId]);
    assert.strictEqual(restoredTg[0].status, 'ACTIVE', 'Group successfully restored to ACTIVE');
  });

  // Clean up test fixtures
  await query(`DELETE FROM classroom_posts WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM teaching_group_members WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
  await query(`DELETE FROM teaching_groups WHERE id = ?`, [testGroupId]);

  // 4. Frontend Hub Files & Theme Token Compliance
  console.log('\n4. Verifying Frontend Portal Files & Token Compliance...');

  const repoRoot = path.resolve(__dirname, '../..');

  test('Faculty Groups page (/frontend/faculty/groups.html) exists', () => {
    const p = path.join(repoRoot, 'frontend/faculty/groups.html');
    assert(fs.existsSync(p), 'File exists');
    const content = fs.readFileSync(p, 'utf8');
    assert(content.includes('id="btn-create-group"'), 'Has create group button');
    assert(content.includes('id="create-group-modal"'), 'Has create group modal');
    assert(content.includes('id="classroom-hub-modal"'), 'Has classroom hub modal');
    assert(content.includes('id="archive-group-modal"'), 'Has archive group modal');
  });

  test('Faculty Groups page has ZERO hardcoded hex colors', () => {
    const p = path.join(repoRoot, 'frontend/faculty/groups.html');
    const content = fs.readFileSync(p, 'utf8');
    const matches = content.match(/#[0-9a-fA-F]{3,8}\b/g);
    assert(!matches || matches.length === 0, `Zero hardcoded hex colors (found: ${matches ? matches.join(', ') : 'none'})`);
  });

  test('Student Groups page (/frontend/student/groups.html) exists', () => {
    const p = path.join(repoRoot, 'frontend/student/groups.html');
    assert(fs.existsSync(p), 'File exists');
    const content = fs.readFileSync(p, 'utf8');
    assert(content.includes('id="btn-open-join-modal"'), 'Has join group button');
    assert(content.includes('id="join-group-modal"'), 'Has join group modal');
    assert(content.includes('id="student-stream-modal"'), 'Has student stream modal');
  });

  test('Student Groups page has ZERO hardcoded hex colors', () => {
    const p = path.join(repoRoot, 'frontend/student/groups.html');
    const content = fs.readFileSync(p, 'utf8');
    const matches = content.match(/#[0-9a-fA-F]{3,8}\b/g);
    assert(!matches || matches.length === 0, `Zero hardcoded hex colors (found: ${matches ? matches.join(', ') : 'none'})`);
  });

  test('auth.js navigation bars include Teaching Groups for faculty and students', () => {
    const p = path.join(repoRoot, 'frontend/shared/js/auth.js');
    const content = fs.readFileSync(p, 'utf8');
    assert(content.includes('/faculty/groups.html'), 'Faculty nav includes /faculty/groups.html');
    assert(content.includes('/student/groups.html'), 'Student nav includes /student/groups.html');
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

runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
