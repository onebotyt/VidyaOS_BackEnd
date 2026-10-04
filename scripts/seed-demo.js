/**
 * INSTITUTIONAL DEMO SEED SCRIPT — Smart College Attendance System
 * Canonical Polytechnic Setup:
 * - 6 Institutional Departments: IT (Primary Demo), ECE, EE, ME, CE, PHARM (0 CSE!)
 * - 1 Admin (admin@gmail.com / admin / Admin@123)
 * - 1 HOD (hod@gmail.com / Dr. Rajesh Sharma, HOD of IT)
 * - 1 Class Teacher (classteacher@gmail.com / Prof. Priya Mehta, IT Y3 S5)
 * - 1 Subject Teacher (teacher@gmail.com / Prof. Amit Verma, IT)
 * - 10 Students (student1@gmail.com to student10@gmail.com, 2024IT001 - 2024IT010)
 * - 3 Subjects & Official Registers: DBMS (IT501), OS (IT502), CN (IT503)
 * - Attendance marked across 6 dates (Defaulters: Student 9 & 10 with < 75%)
 * - Hardware ESP32 Terminal with staged scans for Today (instant day-sync test)
 * - 1 Assignment + submissions & 1 Exam + marks
 * - Universal Password: Password@123 (Admin: Admin@123 / Password@123)
 */

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');
const path = require('path');

const UNIVERSAL_PASS = 'Password@123';
const ADMIN_PASS = 'Admin@123';

function seed(targetDb = null, options = {}) {
  const db = targetDb || new DatabaseSync(path.resolve(__dirname, '../college_attendance.sqlite'));
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA journal_mode = WAL;');

  const force = options.force || process.env.FORCE_RESEED === 'true';

  // ─── Safety Shield: Check if existing active users exist ─────────────────
  try {
    const userCheck = db.prepare("SELECT count(*) as c FROM users").get();
    if (userCheck && userCheck.c > 0 && !force) {
      console.log('=================================================================');
      console.log(`🛡️  SAFETY SHIELD: Database contains ${userCheck.c} existing user account(s).`);
      console.log('    Refusing demo reseed to prevent data loss. Pass FORCE_RESEED=true');
      console.log('    or { force: true } if you explicitly intend to purge this database.');
      console.log('=================================================================\n');
      db.exec('PRAGMA foreign_keys = ON;');
      return { success: true, preserved: true, userCount: userCheck.c };
    }
  } catch (_) {}

  console.log('=================================================================');
  console.log('🌱 SEEDING CLEAN INSTITUTIONAL DEMO ENVIRONMENT');
  console.log('=================================================================\n');

  const universalHash = bcrypt.hashSync(UNIVERSAL_PASS, 10);
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);

  // ─── Step 1: Wipe EVERYTHING Clean ────────────────────────
  console.log('[1] Wiping all existing data, departments, groups, registers, and users (authorized force reset)...');

  db.exec(`DELETE FROM classroom_posts;`);
  db.exec(`DELETE FROM teaching_group_members;`);
  db.exec(`DELETE FROM teaching_groups;`);
  db.exec(`DELETE FROM assessment_submissions;`);
  db.exec(`DELETE FROM assessments;`);
  db.exec(`DELETE FROM fingerprint_slots;`);
  db.exec(`DELETE FROM esp32_presence;`);
  db.exec(`DELETE FROM devices;`);
  db.exec(`DELETE FROM register_attendance;`);
  db.exec(`DELETE FROM attendance_session_students;`);
  db.exec(`DELETE FROM attendance_sessions;`);
  db.exec(`DELETE FROM attendance_registers;`);
  db.exec(`DELETE FROM student_self_attendance;`);
  db.exec(`DELETE FROM enrollments;`);
  db.exec(`DELETE FROM students;`);
  db.exec(`DELETE FROM teacher_assignments;`);
  db.exec(`DELETE FROM subjects;`);
  db.exec(`DELETE FROM teachers;`);
  db.exec(`DELETE FROM departments;`);
  db.exec(`DELETE FROM academic_years;`);
  db.exec(`DELETE FROM notifications;`);
  db.exec(`DELETE FROM audit_logs;`);
  db.exec(`DELETE FROM user_sessions;`);
  db.exec(`DELETE FROM user_roles;`);
  db.exec(`DELETE FROM users;`);

  try {
    db.exec(`DELETE FROM sqlite_sequence;`);
  } catch (e) {
    console.log('sqlite_sequence note:', e.message);
  }
  console.log('    ✓ All old data and sequence numbers cleared.\n');

  // ─── Step 2: Academic Year & 6 Canonical Departments ───────
  console.log('[2] Creating Academic Year and 6 Standard Polytechnic Departments...');

  // Academic Year: 2026-27 (id=1)
  db.prepare(`
    INSERT INTO academic_years (id, label, start_date, end_date, is_current)
    VALUES (1, '2026-27 (Odd Semester)', '2026-07-01', '2027-06-30', 1)
  `).run();
  const AY_ID = 1;

  // 6 Standard Institutional Departments (Branches = Department)
  const standardDepts = [
    { id: 2, name: 'Electronics Engineering', code: 'ECE', duration: 3 },
    { id: 3, name: 'Electrical Engineering', code: 'EE', duration: 3 },
    { id: 4, name: 'Information Technology', code: 'IT', duration: 3 },
    { id: 5, name: 'Mechanical Engineering', code: 'ME', duration: 3 },
    { id: 6, name: 'Civil Engineering', code: 'CE', duration: 3 },
    { id: 7, name: 'Pharmacy', code: 'PHARM', duration: 2 }
  ];

  for (const sd of standardDepts) {
    db.prepare(`
      INSERT INTO departments (id, name, code, is_active, degree_duration_years, active_term)
      VALUES (?, ?, ?, 1, ?, '2026-27 (Odd Semester)')
    `).run(sd.id, sd.name, sd.code, sd.duration);
    console.log(`    ✓ Department: ${sd.name} (${sd.code}, id=${sd.id})`);
  }

  // Primary Demo Department: Information Technology (id=4)
  const DEPT_ID = 4;
  console.log('    ✓ Primary Demo Department: Information Technology (IT, id=4)\n');

  // ─── Helper: Create user with role ────────────────────────
  function createUser(id, username, email, role, passwordHash, status = 'ACTIVE') {
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, username, email, passwordHash, status);
    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`).run(id, role);
    return id;
  }

  // ─── Step 3: Create System Administrator ───────────────────
  console.log('[3] Provisioning System Administrator...');
  // User 1: admin (admin@gmail.com)
  const adminId = createUser(1, 'admin@gmail.com', 'admin@gmail.com', 'SYSTEM_ADMIN', adminHash);
  // Also create Institutional Administrator teacher profile for user 1
  db.prepare(`
    INSERT INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
    VALUES (1, 1, 4, 'System Administrator', 'ADMIN-01', '0000000000')
  `).run();
  console.log(`    ✓ Admin: admin@gmail.com (id=${adminId}, password: Admin@123)\n`);

  // ─── Step 4: Create Faculty (HOD, Class Teacher, Teacher) ──
  console.log('[4] Provisioning Faculty (HOD, Class Teacher, Subject Teacher)...');

  // 1. HOD: hod@gmail.com (User #2, Teacher #2)
  const hodUserId = createUser(2, 'hod@gmail.com', 'hod@gmail.com', 'TEACHER', universalHash);
  db.prepare(`
    INSERT INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
    VALUES (2, ?, ?, 'Dr. Rajesh Sharma', 'IT-HOD-01', '9876543001')
  `).run(hodUserId, DEPT_ID);
  const hodTeacherId = 2;

  // Set HOD in Information Technology department
  db.prepare(`UPDATE departments SET hod_user_id = ? WHERE id = ?`).run(hodUserId, DEPT_ID);

  // Assign HOD role in teacher_assignments
  db.prepare(`
    INSERT INTO teacher_assignments 
      (id, teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active)
    VALUES (1, ?, 'HOD', 'THEORY', ?, 3, 5, ?, 1, 1)
  `).run(hodTeacherId, DEPT_ID, AY_ID);

  // 2. Class Teacher: classteacher@gmail.com (User #3, Teacher #3)
  const ctUserId = createUser(3, 'classteacher@gmail.com', 'classteacher@gmail.com', 'TEACHER', universalHash);
  db.prepare(`
    INSERT INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
    VALUES (3, ?, ?, 'Prof. Priya Mehta', 'IT-CT-01', '9876543002')
  `).run(ctUserId, DEPT_ID);
  const ctTeacherId = 3;

  // Assign Class Teacher role for IT Year 3, Sem 5
  db.prepare(`
    INSERT INTO teacher_assignments 
      (id, teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active)
    VALUES (2, ?, 'CLASS_TEACHER', 'THEORY', ?, 3, 5, ?, ?, 1)
  `).run(ctTeacherId, DEPT_ID, AY_ID, hodUserId);

  // 3. Subject Teacher: teacher@gmail.com (User #4, Teacher #4)
  const tUserId = createUser(4, 'teacher@gmail.com', 'teacher@gmail.com', 'TEACHER', universalHash);
  db.prepare(`
    INSERT INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
    VALUES (4, ?, ?, 'Prof. Amit Verma', 'IT-T-01', '9876543003')
  `).run(tUserId, DEPT_ID);
  const tTeacherId = 4;

  console.log(`    ✓ HOD: hod@gmail.com (Dr. Rajesh Sharma, Teacher #2)`);
  console.log(`    ✓ Class Teacher: classteacher@gmail.com (Prof. Priya Mehta, Teacher #3)`);
  console.log(`    ✓ Subject Teacher: teacher@gmail.com (Prof. Amit Verma, Teacher #4)\n`);

  // ─── Step 5: Subjects, Teaching Groups & Registers ───────
  console.log('[5] Creating Subjects, Teaching Groups & Digital Registers (IT Year 3, Sem 5)...');
  const Y = 3, S = 5;

  // Subject 1: DBMS (IT501)
  db.prepare(`
    INSERT INTO subjects (id, department_id, year, semester, code, name)
    VALUES (1, ?, ?, ?, 'IT501', 'Database Management Systems')
  `).run(DEPT_ID, Y, S);

  // Subject 2: OS (IT502)
  db.prepare(`
    INSERT INTO subjects (id, department_id, year, semester, code, name)
    VALUES (2, ?, ?, ?, 'IT502', 'Operating Systems')
  `).run(DEPT_ID, Y, S);

  // Subject 3: CN (IT503)
  db.prepare(`
    INSERT INTO subjects (id, department_id, year, semester, code, name)
    VALUES (3, ?, ?, ?, 'IT503', 'Computer Networks')
  `).run(DEPT_ID, Y, S);

  // Create 3 Teaching Groups (Golden Architecture: Container of Instruction)
  db.prepare(`
    INSERT INTO teaching_groups (id, name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
    VALUES (1, 'Database Management Systems (Theory)', 'Database Management Systems', 'THEORY', ?, ?, ?, 'DBMS501', 'ACTIVE')
  `).run(hodTeacherId, AY_ID, S);

  db.prepare(`
    INSERT INTO teaching_groups (id, name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
    VALUES (2, 'Operating Systems (Theory)', 'Operating Systems', 'THEORY', ?, ?, ?, 'OS502', 'ACTIVE')
  `).run(ctTeacherId, AY_ID, S);

  db.prepare(`
    INSERT INTO teaching_groups (id, name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status)
    VALUES (3, 'Computer Networks (Theory)', 'Computer Networks', 'THEORY', ?, ?, ?, 'CN503', 'ACTIVE')
  `).run(tTeacherId, AY_ID, S);

  // Assign Subject Teachers & create Attendance Registers linked 1:1 to Teaching Groups
  // 1. DBMS assigned to HOD (Dr. Rajesh Sharma, Register #1)
  db.prepare(`
    INSERT INTO teacher_assignments 
      (id, teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active)
    VALUES (3, ?, 'SUBJECT_TEACHER', 1, 'THEORY', ?, ?, ?, ?, ?, 1)
  `).run(hodTeacherId, DEPT_ID, Y, S, AY_ID, hodUserId);
  db.prepare(`
    INSERT INTO attendance_registers 
      (id, teacher_id, name, subject_id, assignment_id, department_id, group_id, year, semester, academic_year_id, session_type_scope, is_official)
    VALUES (1, ?, 'Database Management Systems — THEORY — 2026-27', 1, 3, ?, 1, ?, ?, ?, 'THEORY', 1)
  `).run(hodTeacherId, DEPT_ID, Y, S, AY_ID);

  // 2. OS assigned to Class Teacher (Prof. Priya Mehta, Register #2)
  db.prepare(`
    INSERT INTO teacher_assignments 
      (id, teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active)
    VALUES (4, ?, 'SUBJECT_TEACHER', 2, 'THEORY', ?, ?, ?, ?, ?, 1)
  `).run(ctTeacherId, DEPT_ID, Y, S, AY_ID, hodUserId);
  db.prepare(`
    INSERT INTO attendance_registers 
      (id, teacher_id, name, subject_id, assignment_id, department_id, group_id, year, semester, academic_year_id, session_type_scope, is_official)
    VALUES (2, ?, 'Operating Systems — THEORY — 2026-27', 2, 4, ?, 2, ?, ?, ?, 'THEORY', 1)
  `).run(ctTeacherId, DEPT_ID, Y, S, AY_ID);

  // 3. CN assigned to Subject Teacher (Prof. Amit Verma, Register #3)
  db.prepare(`
    INSERT INTO teacher_assignments 
      (id, teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active)
    VALUES (5, ?, 'SUBJECT_TEACHER', 3, 'THEORY', ?, ?, ?, ?, ?, 1)
  `).run(tTeacherId, DEPT_ID, Y, S, AY_ID, hodUserId);
  db.prepare(`
    INSERT INTO attendance_registers 
      (id, teacher_id, name, subject_id, assignment_id, department_id, group_id, year, semester, academic_year_id, session_type_scope, is_official)
    VALUES (3, ?, 'Computer Networks — THEORY — 2026-27', 3, 5, ?, 3, ?, ?, ?, 'THEORY', 1)
  `).run(tTeacherId, DEPT_ID, Y, S, AY_ID);

  console.log('    ✓ Group 1 & Register 1: Database Management Systems (Dr. Rajesh Sharma, code: DBMS501)');
  console.log('    ✓ Group 2 & Register 2: Operating Systems (Prof. Priya Mehta, code: OS502)');
  console.log('    ✓ Group 3 & Register 3: Computer Networks (Prof. Amit Verma, code: CN503)\n');

  // ─── Step 6: Create 10 Students ───────────────────────────
  console.log('[6] Provisioning 10 Students (student1@gmail.com to student10@gmail.com)...');

  const studentData = [
    { roll: 1,  name: 'Aarav Sharma',    email: 'student1@gmail.com',  enroll: '2024IT001', reg: '24101054001' },
    { roll: 2,  name: 'Aditi Verma',     email: 'student2@gmail.com',  enroll: '2024IT002', reg: '24101054002' },
    { roll: 3,  name: 'Akash Patel',     email: 'student3@gmail.com',  enroll: '2024IT003', reg: '24101054003' },
    { roll: 4,  name: 'Ananya Gupta',    email: 'student4@gmail.com',  enroll: '2024IT004', reg: '24101054004' },
    { roll: 5,  name: 'Arjun Rao',       email: 'student5@gmail.com',  enroll: '2024IT005', reg: '24101054005' },
    { roll: 6,  name: 'Bhavya Nair',     email: 'student6@gmail.com',  enroll: '2024IT006', reg: '24101054006' },
    { roll: 7,  name: 'Chirag Joshi',    email: 'student7@gmail.com',  enroll: '2024IT007', reg: '24101054007' },
    { roll: 8,  name: 'Deepika Singh',   email: 'student8@gmail.com',  enroll: '2024IT008', reg: '24101054008' },
    { roll: 9,  name: 'Rohan Kulkarni',  email: 'student9@gmail.com',  enroll: '2024IT009', reg: '24101054009' }, // Defaulter 50%
    { roll: 10, name: 'Sneha Patil',     email: 'student10@gmail.com', enroll: '2024IT010', reg: '24101054010' }  // Defaulter 66.7%
  ];

  const studentIds = [];
  studentData.forEach((s, idx) => {
    const userId = 10 + idx;
    const studentId = idx + 1;
    createUser(userId, s.email, s.email, 'STUDENT', universalHash);

    db.prepare(`
      INSERT INTO students (id, user_id, official_enrollment_no, registration_no, class_roll_no, full_name, entry_mode)
      VALUES (?, ?, ?, ?, ?, ?, 'teacher_provisioned')
    `).run(studentId, userId, s.enroll, s.reg, s.roll, s.name);

    db.prepare(`
      INSERT INTO enrollments (id, student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ENROLLED')
    `).run(studentId, studentId, DEPT_ID, Y, S, AY_ID, s.roll);

    db.prepare(`
      INSERT INTO student_department_enrollments 
        (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
      VALUES (?, ?, ?, ?, ?, ?, '2026-07-01', 'ACTIVE')
    `).run(studentId, DEPT_ID, AY_ID, Y, S, s.roll);

    // Enroll student into the 3 Teaching Groups
    for (let gid = 1; gid <= 3; gid++) {
      db.prepare(`
        INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
        VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')
      `).run(gid, studentId);
    }

    studentIds.push(studentId);
  });

  // Post welcome stream announcements in Teaching Groups
  db.prepare(`INSERT INTO classroom_posts (group_id, author_id, content) VALUES (1, ?, 'Welcome to Database Management Systems! Syllabus and course plan uploaded.')`).run(hodUserId);
  db.prepare(`INSERT INTO classroom_posts (group_id, author_id, content) VALUES (2, ?, 'Welcome to Operating Systems! Please check the weekly timetable.')`).run(ctUserId);
  db.prepare(`INSERT INTO classroom_posts (group_id, author_id, content) VALUES (3, ?, 'Welcome to Computer Networks! We will start with OSI Model architecture.')`).run(tUserId);

  console.log(`    ✓ Enrolled 10 students into Department (IT) and Teaching Groups 1, 2, 3.\n`);

  // ─── Step 7: Attendance Sessions Across 6 Days ─────────────
  console.log('[7] Marking Attendance Sessions for 6 Days in September 2026...');

  const dates = [
    '2026-09-01',
    '2026-09-03',
    '2026-09-05',
    '2026-09-08',
    '2026-09-10',
    '2026-09-12'
  ];

  const registersConfig = [
    { regId: 1, teacherId: hodTeacherId, subjectId: 1, markerUserId: hodUserId, time: '10:00:00' },
    { regId: 2, teacherId: ctTeacherId,  subjectId: 2, markerUserId: ctUserId,  time: '11:15:00' },
    { regId: 3, teacherId: tTeacherId,   subjectId: 3, markerUserId: tUserId,   time: '12:30:00' }
  ];

  let totalSessionsCreated = 0;

  registersConfig.forEach(reg => {
    dates.forEach((date, dateIdx) => {
      const sessRes = db.prepare(`
        INSERT INTO attendance_sessions
          (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id,
           session_type, session_date, start_time, end_time, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'THEORY', ?, ?, ?, 'FINALIZED')
      `).run(
        reg.regId, reg.teacherId, reg.subjectId, DEPT_ID, Y, S, AY_ID,
        date,
        `${date} ${reg.time}`,
        `${date} ${parseInt(reg.time.split(':')[0]) + 1}:00:00`
      );
      const sessId = Number(sessRes.lastInsertRowid);
      totalSessionsCreated++;

      studentIds.forEach((sid, sIdx) => {
        db.prepare(`
          INSERT INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included)
          VALUES (?, ?, ?, ?, 1)
        `).run(sessId, sid, sid, sIdx + 1);

        // Status logic
        let status = 'PRESENT';
        if (sIdx === 8) { // Roll 9 (Rohan Kulkarni)
          status = (dateIdx % 2 === 0) ? 'PRESENT' : 'ABSENT';
        } else if (sIdx === 9) { // Roll 10 (Sneha Patil)
          status = (dateIdx === 2 || dateIdx === 5) ? 'ABSENT' : 'PRESENT';
        } else {
          status = (sIdx === 3 && dateIdx === 4) ? 'LATE' : 'PRESENT';
        }

        db.prepare(`
          INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by)
          VALUES (?, ?, ?, 'MANUAL', ?)
        `).run(sessId, sid, status, reg.markerUserId);
      });
    });
  });

  console.log(`    ✓ Created ${totalSessionsCreated} finalized sessions across 3 registers.`);
  console.log(`    ✓ Students 1-8: High Attendance (83% - 100%)`);
  console.log(`    ✓ Student 9 (Rohan Kulkarni): 50.0% Attendance (Defaulter < 75%)`);
  console.log(`    ✓ Student 10 (Sneha Patil): 66.7% Attendance (Defaulter < 75%)\n`);

  // ─── Step 8: Hardware ESP32 Terminal & Presence Scans ───────
  console.log('[8] Setting Up Hardware ESP32 Terminal & Presence Scans...');

  const todayStr = new Date().toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO devices 
      (id, device_uid, name, department_id, year, semester, academic_year_id, secret_hash, is_active, last_heartbeat_at)
    VALUES (1, 'ESP32_IT_LAB_01', 'IT Department Biometric Terminal', ?, ?, ?, ?, 'default_secret', 1, CURRENT_TIMESTAMP)
  `).run(DEPT_ID, Y, S, AY_ID);

  for (let i = 1; i <= 10; i++) {
    db.prepare(`
      INSERT INTO fingerprint_slots (device_id, slot_id, student_id, is_active)
      VALUES (1, ?, ?, 1)
    `).run(i, i);
  }

  const espDates = [...dates, todayStr];
  let scanCounter = 0;

  espDates.forEach(d => {
    const studentsPresentOnDay = [1, 2, 3, 4, 5, 6, 7];
    if (d !== todayStr) {
      studentsPresentOnDay.push(8);
      if (d === '2026-09-08') studentsPresentOnDay.push(9);
      if (d === '2026-09-05') studentsPresentOnDay.push(10);
    }

    studentsPresentOnDay.forEach(sid => {
      scanCounter++;
      const min = String(10 + (sid * 3) % 45).padStart(2, '0');
      const scanTime = `${d} 09:${min}:15`;
      db.prepare(`
        INSERT INTO esp32_presence (event_id, device_id, student_id, scan_time, payload_json)
        VALUES (?, 1, ?, ?, ?)
      `).run(
        `EVT_${d.replace(/-/g, '')}_${sid}`,
        sid,
        scanTime,
        JSON.stringify({ device: 'ESP32_IT_LAB_01', slot_id: sid, score: 98, verified: true })
      );
    });
  });

  console.log('    ✓ ESP32_IT_LAB_01 hardware reader created (🟢 Online).');
  console.log('    ✓ 10 biometric fingerprint slots assigned.');
  console.log(`    ✓ ${scanCounter} student ESP32 presence scans staged across ${espDates.length} days.\n`);

  // ─── Step 9: Assignments & Unit Test Marks ─────────────────
  console.log('[9] Seeding 1 Assignment and 1 Exam in DBMS...');

  db.prepare(`
    INSERT INTO assessments 
      (id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, description, due_date, max_marks)
    VALUES (1, ?, 1, ?, 1, ?, ?, ?, 'ASSIGNMENT', 'Assignment 1: Relational Algebra & SQL Joins', 'Write SQL queries using INNER JOIN, LEFT JOIN, GROUP BY, and subqueries on university schemas.', '2026-09-30 23:59:59', 25)
  `).run(hodTeacherId, DEPT_ID, Y, S, AY_ID);

  const sampleSubmissions = [
    { sid: 1, marks: 24, feedback: 'Excellent queries and well-documented query explanations.' },
    { sid: 2, marks: 22, feedback: 'Good work! Double-check grouping in problem 4.' },
    { sid: 3, marks: 25, feedback: 'Flawless submission.' }
  ];

  sampleSubmissions.forEach(sub => {
    db.prepare(`
      INSERT INTO assessment_submissions 
        (assessment_id, student_id, file_path, original_filename, submitted_at, status, marks_obtained, feedback, graded_at, graded_by)
        VALUES (1, ?, '/uploads/submissions/sample_sql.pdf', 'Roll_${sub.sid}_SQL_Assignment.pdf', '${todayStr} 08:30:00', 'GRADED', ?, ?, '${todayStr} 10:00:00', ?)
    `).run(sub.sid, sub.marks, sub.feedback, hodUserId);
  });

  db.prepare(`
    INSERT INTO assessments (id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, due_date, max_marks)
    VALUES (2, ?, 1, ?, 1, ?, ?, ?, 'EXAM', 'Unit Test 1 — Database Systems', '2026-09-07', 20)
  `).run(hodTeacherId, DEPT_ID, Y, S, AY_ID);

  for (let i = 1; i <= 10; i++) {
    const marks = 14 + (i % 7);
    db.prepare(`
      INSERT INTO assessment_submissions (assessment_id, student_id, marks_obtained, feedback, graded_by, status)
      VALUES (2, ?, ?, ?, ?, 'GRADED')
    `).run(i, marks, marks >= 18 ? 'Excellent' : 'Good', hodUserId);
  }

  console.log('    ✓ Assignment 1 + 3 graded submissions created in Teaching Group 1.');
  console.log('    ✓ Unit Test 1 + 10 student scores entered in Teaching Group 1.\n');

  // ─── Step 10: System Settings ──────────────────────────────
  db.exec(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value, description) VALUES
    ('attendance_threshold', '75', 'Minimum attendance percentage required'),
    ('academic_year_start_month', '7', 'Academic year start month (July=7)'),
    ('academic_year_start_day', '1', 'Academic year start day'),
    ('institution_name', 'Government Polytechnic College — Information Technology Dept', 'Name of the institution'),
    ('max_session_duration_hours', '3', 'Auto-close session after N hours')
  ;`);

  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[10] ✓ Fresh demo seed completed successfully!\n');

  // ─── Summary Table ─────────────────────────────────────────
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               FRESH INSTITUTIONAL DEMO DATASET (14 USERS)                  ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ PASSWORDS:                                                                 ║');
  console.log('║   Admin:   Admin@123  (or Password@123)                                    ║');
  console.log('║   Faculty & Students: Password@123                                         ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ 1. Admin:           admin@gmail.com         (System Administrator)         ║');
  console.log('║ 2. HOD:             hod@gmail.com           (Dr. Rajesh Sharma, IT HOD)    ║');
  console.log('║ 3. Class Teacher:   classteacher@gmail.com  (Prof. Priya Mehta, IT Y3 S5)  ║');
  console.log('║ 4. Subject Teacher: teacher@gmail.com       (Prof. Amit Verma, IT Dept)    ║');
  console.log('║ 5. Students (10):   student1@gmail.com to student10@gmail.com              ║');
  console.log('║                     - Rolls 1–8: High attendance (83% - 100%)              ║');
  console.log('║                     - Roll 9:    student9@gmail.com  (50.0% Defaulter)     ║');
  console.log('║                     - Roll 10:   student10@gmail.com (66.7% Defaulter)     ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ DEPARTMENTS & REGISTERS                                                    ║');
  console.log('║   Standard Depts:  IT (4), ECE (2), EE (3), ME (5), CE (6), PHARM (7)       ║');
  console.log('║   Primary Dept:    Information Technology (IT, id=4)                       ║');
  console.log('║   Registers:       1: DBMS (HOD), 2: OS (Class Teacher), 3: CN (Teacher)   ║');
  console.log('║   ESP32 Scans:     7 students scanned today on ESP32_IT_LAB_01             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
}

module.exports = { seed };

if (require.main === module) {
  try {
    seed();
  } catch (err) {
    console.error('\n[SEED ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}
