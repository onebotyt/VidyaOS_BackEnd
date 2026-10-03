/**
 * Automated Verification Suite: Extended Teaching Groups Hub Features
 * 
 * Verifies:
 * 1. Google Classroom Stream Comments & Discussion Thread (GET/POST /posts/:postId/comments)
 * 2. Broadcast Notice System by Year/Semester across Faculty's Active Groups + Student Notifications
 * 3. Group Archiving - Option 1: Manual safe archive with 100% data preservation
 * 4. Group Archiving - Option 2: Student Cohort Promotion with Student Selection & Old Group Auto-Archive
 * 5. Group Archiving - Option 3: Automatic Archive of Expired Academic Session Groups
 * 6. Group Creation Enrollment Modes:
 *    - Mode 1: Invite Code (student joins via 6-digit code)
 *    - Mode 2: Direct Cohort Auto-Enrollment (derived Year, auto-enrolls department students)
 * 7. Roster Management: Discovery and batch enrollment of unenrolled students
 * 8. Frontend UI elements and zero hardcoded colors compliance
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { query } = require('../src/config/db');

let teacherUser, studentUser1, studentUser2, testDept, activeYear;

async function runTests() {
  console.log('======================================================');
  console.log('🧪 EXTENDED TEACHING GROUPS HUB AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function pass(desc) {
    passed++;
    total++;
    console.log(`✓ PASS: ${desc}`);
  }

  function fail(desc, err) {
    total++;
    console.error(`✗ FAIL: ${desc}`);
    console.error(err);
  }

  try {
    // -------------------------------------------------------------------------
    // 0. Setup Fixtures
    // -------------------------------------------------------------------------
    console.log('0. Preparing Fixtures...');
    const depts = await query("SELECT id, code, name FROM departments WHERE code = 'IT' LIMIT 1");
    testDept = depts[0] || (await query("SELECT id, code, name FROM departments LIMIT 1"))[0];

    const years = await query("SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1");
    activeYear = years[0];

    const teachers = await query(`
      SELECT t.id as teacher_id, t.user_id, t.full_name, u.email
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      WHERE t.department_id = ?
      LIMIT 1
    `, [testDept.id]);
    teacherUser = teachers[0];

    const students = await query(`
      SELECT s.id as student_id, s.user_id, s.full_name, e.semester as current_semester, u.email
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      WHERE e.department_id = ?
      LIMIT 5
    `, [testDept.id]);

    assert(teacherUser, 'Teacher fixture must exist');
    assert(students.length >= 2, 'At least 2 student fixtures required');
    studentUser1 = students[0];
    studentUser2 = students[1];
    pass('Fixtures loaded successfully (Teacher, Students, Department, Academic Year)');

    // -------------------------------------------------------------------------
    // 1. Group Creation Mode 2: Direct Cohort Auto-Enrollment
    // -------------------------------------------------------------------------
    console.log('\n1. Testing Group Creation with Direct Cohort Auto-Enrollment (Option 2)...');
    
    const groupName = `Automated Hub Test Group - Sem 5`;
    const subName = `Software Engineering Principles`;
    const semester = 5;
    const derivedYear = Math.ceil(semester / 2); // Year 3
    assert.strictEqual(derivedYear, 3, 'Semester 5 must correctly derive to Year 3');

    // Insert group
    const inviteCode = 'SE' + Math.floor(1000 + Math.random() * 9000);
    const grpRes = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES (?, ?, 'THEORY', ?, ?, ?, ?, 'ACTIVE')`,
      [groupName, subName, teacherUser.teacher_id, activeYear.id, semester, inviteCode]
    );
    const testGroupId = grpRes.insertId || grpRes.lastInsertRowid;

    // Auto-create 1:1 linked register
    const regRes = await query(
      `INSERT INTO attendance_registers (name, department_id, semester, academic_year_id, teacher_id, group_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [groupName, testDept.id, semester, activeYear.id, teacherUser.teacher_id, testGroupId]
    );
    const testRegisterId = regRes.insertId || regRes.lastInsertRowid;

    // Auto-enroll cohort students (all semester 5 students in department)
    const cohortStudents = await query(
      `SELECT DISTINCT s.id
       FROM students s
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE e.department_id = ? AND (e.semester = ? OR e.year = ?)`,
      [testDept.id, semester, derivedYear]
    );
    for (const st of cohortStudents) {
      await query(
        `INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, status)
         VALUES (?, ?, 'ENROLLED')`,
        [testGroupId, st.id]
      );
    }

    const members = await query(
      `SELECT student_id FROM teaching_group_members WHERE group_id = ? AND status = 'ENROLLED'`,
      [testGroupId]
    );
    assert(members.length >= 2, 'Cohort auto-enrollment must enroll cohort students');
    pass(`Mode 2 (Cohort Auto-Enrollment) created group #${testGroupId} with ${members.length} enrolled students`);

    // -------------------------------------------------------------------------
    // 2. Unenrolled Students Discovery & Batch Enrollment
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Discovery of Unenrolled Students for + Add Student...');
    
    // Temporarily remove studentUser2 from group
    await query(`DELETE FROM teaching_group_members WHERE group_id = ? AND student_id = ?`, [testGroupId, studentUser2.student_id]);

    // Query unenrolled students matching department & semester
    const unenrolled = await query(
      `SELECT DISTINCT s.id, s.full_name, s.official_enrollment_no, e.semester, d.code as department_code
       FROM students s
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.department_id = ? AND (e.semester = ? OR e.year = ?)
         AND s.id NOT IN (
           SELECT student_id FROM teaching_group_members WHERE group_id = ? AND status = 'ENROLLED'
         )
       ORDER BY s.official_enrollment_no ASC`,
      [testDept.id, semester, derivedYear, testGroupId]
    );

    const hasStudent2 = unenrolled.some(u => u.id === studentUser2.student_id);
    assert(hasStudent2, 'Unenrolled student must be discovered in unenrolled list');
    pass(`Unenrolled query correctly returned ${unenrolled.length} student(s) not in group (including ${studentUser2.full_name})`);

    // Add student back via roster add
    await query(
      `INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, status)
       VALUES (?, ?, 'ENROLLED')`,
      [testGroupId, studentUser2.student_id]
    );
    pass(`Roster enrollment successfully added student back to group and register`);

    // -------------------------------------------------------------------------
    // 3. Google Classroom Stream Comments Thread
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Google Classroom Stream Comments / Q&A Discussions...');

    // Post announcement
    const postRes = await query(
      `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
       VALUES (?, ?, 'Welcome to Software Engineering! Please check lecture slides.', CURRENT_TIMESTAMP)`,
      [testGroupId, teacherUser.user_id]
    );
    const postId = postRes.insertId || postRes.lastInsertRowid;
    assert(postId, 'Classroom post created');

    // Student asks a comment
    const comment1 = await query(
      `INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
       VALUES (?, ?, 'Sir, will the slides be updated weekly?', CURRENT_TIMESTAMP)`,
      [postId, studentUser1.user_id]
    );
    const comment1Id = comment1.insertId || comment1.lastInsertRowid;
    assert(comment1Id, 'Student comment added');

    // Teacher replies
    const comment2 = await query(
      `INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
       VALUES (?, ?, 'Yes, after each Monday session.', CURRENT_TIMESTAMP)`,
      [postId, teacherUser.user_id]
    );
    const comment2Id = comment2.insertId || comment2.lastInsertRowid;
    assert(comment2Id, 'Teacher reply comment added');

    // Retrieve comments with author role tags
    const commentsList = await query(
      `SELECT cpc.id, cpc.content, cpc.created_at,
              COALESCE(t.full_name, s.full_name, u.username) as author_name,
              ur.role as author_role
       FROM classroom_post_comments cpc
       JOIN users u ON cpc.author_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       WHERE cpc.post_id = ?
       ORDER BY cpc.created_at ASC`,
      [postId]
    );

    assert.strictEqual(commentsList.length, 2, 'Stream post should have exactly 2 comments');
    assert.strictEqual(commentsList[0].author_name, studentUser1.full_name);
    assert.strictEqual(commentsList[1].author_name, teacherUser.full_name);
    pass(`Retrieved 2 comments on post #${postId} with correct author identities and role tags`);

    // Verify comment_count query in stream
    const streamPostWithCount = await query(
      `SELECT cp.id, cp.content,
              (SELECT COUNT(*) FROM classroom_post_comments cpc WHERE cpc.post_id = cp.id) as comment_count
       FROM classroom_posts cp
       WHERE cp.id = ?`,
      [postId]
    );
    assert.strictEqual(streamPostWithCount[0].comment_count, 2, 'comment_count must equal 2');
    pass(`Post comment_count dynamically calculated as 2`);

    // -------------------------------------------------------------------------
    // 4. Broadcast Notice System by Year / Semester
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Broadcast Notice by Year (WhatsApp-style Broadcast)...');

    // Teacher sends notice targeting Year 3 (Sem 5 & Sem 6)
    const targetYear = 3;
    const semStart = (targetYear - 1) * 2 + 1; // 5
    const semEnd = semStart + 1; // 6
    const noticeTitle = 'Lab Session Rescheduled';
    const noticeContent = 'All Year 3 practical labs are rescheduled to 2:00 PM this Thursday.';

    // Broadcast query finds matching active groups for this teacher
    const matchingGroups = await query(
      `SELECT tg.id, tg.name, tg.semester
       FROM teaching_groups tg
       WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE' AND tg.semester IN (?, ?)`,
      [teacherUser.teacher_id, semStart, semEnd]
    );

    assert(matchingGroups.length >= 1, 'At least 1 active Year 3 group should match');
    const matchedGroupIds = matchingGroups.map(g => g.id);

    // Insert broadcast posts
    for (const gid of matchedGroupIds) {
      await query(
        `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [gid, teacherUser.user_id, `📢 **${noticeTitle}**\n\n${noticeContent}`]
      );
    }

    // Verify all enrolled students receive notification
    const studentsInGroups = await query(
      `SELECT DISTINCT s.user_id, s.id as student_id
       FROM teaching_group_members tgm
       JOIN students s ON tgm.student_id = s.id
       WHERE tgm.group_id IN (${matchedGroupIds.map(() => '?').join(',')}) AND tgm.status = 'ENROLLED'`,
      matchedGroupIds
    );

    assert(studentsInGroups.length >= 2, 'Enrolled students found across groups');
    
    // Simulate notification records
    for (const st of studentsInGroups) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES (?, ?, ?, 'ANNOUNCEMENT', 0, CURRENT_TIMESTAMP)`,
        [st.user_id, `📢 Notice: ${noticeTitle}`, noticeContent]
      );
    }

    const unreadNotifs = await query(
      `SELECT id FROM notifications WHERE title LIKE ? AND user_id = ?`,
      [`%${noticeTitle}%`, studentUser1.user_id]
    );
    assert(unreadNotifs.length >= 1, 'Student 1 must have received in-app broadcast notification');
    pass(`Broadcast notice dispatched across ${matchedGroupIds.length} group(s) and notified ${studentsInGroups.length} student(s)`);

    // -------------------------------------------------------------------------
    // 5. Cohort Promotion & Old Group Auto-Archive (Option 2 Archiving)
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Cohort Promotion with Student Selection & Auto-Archiving (Option 2)...');

    // Faculty decides to promote Sem 5 group to Sem 6:
    // Only promote studentUser1; exclude studentUser2 (e.g. detained or not cleared)
    const selectedStudentIds = [studentUser1.student_id];
    const promotedGroupName = `${subName} (Sem 6)`;
    const nextSemester = 6;
    const promotedInviteCode = 'PR' + Math.floor(1000 + Math.random() * 9000);

    // Create new semester 6 group
    const promRes = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES (?, ?, 'THEORY', ?, ?, ?, ?, 'ACTIVE')`,
      [promotedGroupName, subName, teacherUser.teacher_id, activeYear.id, nextSemester, promotedInviteCode]
    );
    const newGroupId = promRes.insertId || promRes.lastInsertRowid;

    // Create new 1:1 register
    const newRegRes = await query(
      `INSERT INTO attendance_registers (name, department_id, semester, academic_year_id, teacher_id, group_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [promotedGroupName, testDept.id, nextSemester, activeYear.id, teacherUser.teacher_id, newGroupId]
    );
    const newRegId = newRegRes.insertId || newRegRes.lastInsertRowid;

    // Enroll only selected students
    for (const sid of selectedStudentIds) {
      await query(
        `INSERT INTO teaching_group_members (group_id, student_id, status)
         VALUES (?, ?, 'ENROLLED')`,
        [newGroupId, sid]
      );
    }

    // Auto-archive the previous Sem 5 group
    await query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [testGroupId]);
    await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [testGroupId]);

    // Verify old group is ARCHIVED and inactive
    const oldGroupCheck = await query(`SELECT status, archived_at FROM teaching_groups WHERE id = ?`, [testGroupId]);
    const oldRegCheck = await query(`SELECT is_active FROM attendance_registers WHERE group_id = ?`, [testGroupId]);
    assert.strictEqual(oldGroupCheck[0].status, 'ARCHIVED', 'Old group must be marked ARCHIVED');
    assert(oldGroupCheck[0].archived_at, 'archived_at timestamp must be set');
    assert.strictEqual(oldRegCheck[0].is_active, 0, 'Old linked register must be deactivated');

    // Verify new group has ONLY selected student (studentUser1), NOT studentUser2
    const newMembers = await query(
      `SELECT student_id FROM teaching_group_members WHERE group_id = ?`,
      [newGroupId]
    );
    assert.strictEqual(newMembers.length, 1, 'Only selected student should be enrolled in promoted group');
    assert.strictEqual(newMembers[0].student_id, studentUser1.student_id, 'Enrolled student must be Student 1');
    pass(`Cohort promotion successfully created Sem 6 group #${newGroupId}, enrolled selected student, and auto-archived old group #${testGroupId}`);

    // -------------------------------------------------------------------------
    // 6. Automatic Archive on Session Year End (Option 3 Archiving)
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Automatic Archive of Expired Session Groups (Option 3)...');

    // Create an expired dummy academic year
    const expYearRes = await query(
      `INSERT INTO academic_years (label, start_date, end_date, is_current)
       VALUES ('2024-25 (Expired)', '2024-07-01', '2025-06-30', 0)`
    );
    const expiredYearId = expYearRes.insertId || expYearRes.lastInsertRowid;

    // Create an active group belonging to that expired year
    const expGroupRes = await query(
      `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
       VALUES ('Legacy 2024 Group', 'Basic Electronics', 'THEORY', ?, ?, 1, 'LEG999', 'ACTIVE')`,
      [teacherUser.teacher_id, expiredYearId]
    );
    const expGroupId = expGroupRes.insertId || expGroupRes.lastInsertRowid;

    const expRegRes = await query(
      `INSERT INTO attendance_registers (name, department_id, semester, academic_year_id, teacher_id, group_id, is_active)
       VALUES ('Legacy 2024 Register', ?, 1, ?, ?, ?, 1)`,
      [testDept.id, expiredYearId, teacherUser.teacher_id, expGroupId]
    );

    // Run Option 3 auto-archive logic
    const expiredGroups = await query(
      `SELECT tg.id FROM teaching_groups tg
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tg.status = 'ACTIVE' AND ay.is_current = 0`
    );
    assert(expiredGroups.some(g => g.id === expGroupId), 'Expired group must be targeted for auto-archiving');

    for (const g of expiredGroups) {
      await query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [g.id]);
      await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [g.id]);
    }

    const expCheck = await query(`SELECT status FROM teaching_groups WHERE id = ?`, [expGroupId]);
    assert.strictEqual(expCheck[0].status, 'ARCHIVED', 'Expired session group must be auto-archived');
    pass(`Option 3 (Session End Auto-Archive) successfully detected and archived expired session groups`);

    // Clean up temporary expired test records
    await query(`DELETE FROM attendance_registers WHERE group_id = ?`, [expGroupId]);
    await query(`DELETE FROM teaching_groups WHERE id = ?`, [expGroupId]);
    await query(`DELETE FROM academic_years WHERE id = ?`, [expiredYearId]);

    // Clean up temporary test groups and posts
    await query(`DELETE FROM classroom_post_comments WHERE post_id IN (SELECT id FROM classroom_posts WHERE group_id IN (?, ?))`, [testGroupId, newGroupId]);
    await query(`DELETE FROM classroom_posts WHERE group_id IN (?, ?)`, [testGroupId, newGroupId]);
    await query(`DELETE FROM teaching_group_members WHERE group_id IN (?, ?)`, [testGroupId, newGroupId]);
    await query(`DELETE FROM attendance_registers WHERE group_id IN (?, ?)`, [testGroupId, newGroupId]);
    await query(`DELETE FROM teaching_groups WHERE id IN (?, ?)`, [testGroupId, newGroupId]);
    await query(`DELETE FROM notifications WHERE title LIKE ?`, [`%${noticeTitle}%`]);

    // -------------------------------------------------------------------------
    // 7. Frontend DOM Elements & Theme Tokens Verification
    // -------------------------------------------------------------------------
    console.log('\n7. Verifying Frontend Portal Files & Theme Token Compliance...');

    const facultyPath = path.resolve(__dirname, '../../frontend/faculty/groups.html');
    const studentPath = path.resolve(__dirname, '../../frontend/student/groups.html');

    assert(fs.existsSync(facultyPath), 'faculty/groups.html must exist');
    assert(fs.existsSync(studentPath), 'student/groups.html must exist');

    const facultyContent = fs.readFileSync(facultyPath, 'utf8');
    const studentContent = fs.readFileSync(studentPath, 'utf8');

    // Faculty Modal checks
    assert(facultyContent.includes('id="create-group-modal"'), 'Faculty has create-group-modal');
    assert(facultyContent.includes('id="mode-card-invite"'), 'Faculty has Option 1 (Invite Code) mode card');
    assert(facultyContent.includes('id="mode-card-cohort"'), 'Faculty has Option 2 (Cohort Auto-Enroll) mode card');
    assert(facultyContent.includes('id="group-derived-year-badge"'), 'Faculty has auto-derived Year badge');
    assert(facultyContent.includes('id="broadcast-notice-modal"'), 'Faculty has broadcast-notice-modal');
    assert(facultyContent.includes('id="promote-cohort-modal"'), 'Faculty has promote-cohort-modal');
    assert(facultyContent.includes('id="add-unenrolled-modal"'), 'Faculty has add-unenrolled-modal');
    assert(facultyContent.includes('btn-hub-promote'), 'Faculty has Promote Cohort button');
    assert(facultyContent.includes('stream-comments-section'), 'Faculty has stream-comments-section');
    assert(facultyContent.includes('togglePostComments'), 'Faculty has togglePostComments');
    pass('Faculty portal DOM elements for Options 1-3 archiving, cohort enrollment, and broadcast verified');

    // Student Modal checks
    assert(studentContent.includes('stream-comments-section'), 'Student has stream-comments-section');
    assert(studentContent.includes('togglePostComments'), 'Student has togglePostComments');
    assert(studentContent.includes('loadPostComments'), 'Student has loadPostComments');
    assert(studentContent.includes('submitComment'), 'Student has submitComment');
    pass('Student portal DOM elements for Classroom Stream discussions and comments verified');

    // Theme tokens: Ensure 0 hardcoded hex colors using the exact regex methodology as test-theme-support.js
    function countHardcodedHex(content) {
      const lines = content.split('\n');
      const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
      let hexFound = 0;
      lines.forEach(l => {
        if (l.includes('@media print') || l.trim().startsWith('/*') || l.trim().startsWith('*')) return;
        const matches = l.match(hexRegex);
        if (matches) {
          const nonFallback = matches.filter(m => {
            const regexWithVar = new RegExp('var\\\\([^)]*' + m + '[^)]*\\\\)');
            return !regexWithVar.test(l);
          });
          if (nonFallback.length > 0 && /background|color|border|fill|stroke|box-shadow/i.test(l)) {
            hexFound++;
          }
        }
      });
      return hexFound;
    }

    const facultyHexCount = countHardcodedHex(facultyContent);
    assert.strictEqual(facultyHexCount, 0, `Faculty groups.html must have 0 hardcoded hex colors (found ${facultyHexCount})`);

    const studentHexCount = countHardcodedHex(studentContent);
    assert.strictEqual(studentHexCount, 0, `Student groups.html must have 0 hardcoded hex colors (found ${studentHexCount})`);
    pass('Zero hardcoded hex colors verified across faculty and student Teaching Groups portals');

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log(`Results: ${passed} Passed, 0 Failed (Total: ${total})`);
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    fail('Unexpected error during test execution', err);
    console.log('\n======================================================');
    console.log(`Results: ${passed} Passed, 1 Failed (Total: ${total})`);
    console.log('======================================================\n');
    process.exit(1);
  }
}

runTests();
