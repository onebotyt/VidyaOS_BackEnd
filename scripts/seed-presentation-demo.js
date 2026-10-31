/**
 * VIDYAOS INSTITUTIONAL PRESENTATION SEED SCRIPT
 * Location: backend/scripts/seed-presentation-demo.js
 * 
 * Provides a rich, clean, realistic institutional dataset for Government Polytechnic Nainital (UBTER):
 * - 6 Canonical Departments (IT, ECE, EE, ME, CE, PHARM)
 * - Academic Year: 2026-27 (Odd Semester)
 * - Accounts across all roles with universal presentation password: "Admin@123"
 *   - System Administrator: admin / admin@gmail.com
 *   - 6 Department HODs: hod_it, hod_ece, hod_ee, hod_me, hod_ce, hod_pharm
 *   - 3 Active IT Faculty: teacher1, teacher2, teacher3
 *   - 25 Students across IT (15), ECE (5), EE (5) with roll numbers, registration numbers, and realistic attendance
 * - Teaching Groups & Course Registers (DSA, DBMS, Web Dev, Computer Networks)
 * - Realistic Attendance Matrix & Historical Sessions (~80-87% attendance)
 * - Active "Today" Session & 1 Live Open Studio Session with Dynamic PIN (749201)
 * - Assignments, Graded Submissions, Class Test Marksheets, Stream Posts & Comments
 * - Approved & Pending Leave Requests
 * - Online ESP32 Biometric Hardware Terminals & In-App Notifications
 */

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const UNIVERSAL_PASSWORD = 'Admin@123';

function runPresentationSeed(targetDbPath) {
  console.log(`\n=================================================================`);
  console.log(`🏛️  VIDYAOS PRESENTATION SEED: Populating database at:`);
  console.log(`    ${targetDbPath}`);
  console.log(`=================================================================\n`);

  const db = new DatabaseSync(targetDbPath);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA journal_mode = WAL;');

  // Ensure all tables and required columns exist
  const schemaPath = path.resolve(__dirname, '../database/sqlite/schema.sql');
  if (fs.existsSync(schemaPath)) {
    try {
      db.exec(fs.readFileSync(schemaPath, 'utf8'));
    } catch (_) {}
  }

  // Column safety migrations
  const alterStatements = [
    'ALTER TABLE audit_logs ADD COLUMN event_type TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN actor_id INTEGER;',
    'ALTER TABLE audit_logs ADD COLUMN actor_role TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN target_type TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN target_id TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN action TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;',
    'ALTER TABLE audit_logs ADD COLUMN entity_type TEXT;',
    'ALTER TABLE audit_logs ADD COLUMN entity_id TEXT;',
    'ALTER TABLE notifications ADD COLUMN type TEXT DEFAULT \'GENERAL\';',
    'ALTER TABLE user_sessions ADD COLUMN device_id TEXT;',
    'ALTER TABLE user_sessions ADD COLUMN last_active_at DATETIME;',
    'ALTER TABLE assessments ADD COLUMN instructions TEXT;',
    'ALTER TABLE assessments ADD COLUMN questions TEXT;',
    'ALTER TABLE assessments ADD COLUMN unit_name TEXT;',
    'ALTER TABLE assessments ADD COLUMN group_id INTEGER;',
    'ALTER TABLE attendance_registers ADD COLUMN group_id INTEGER;',
    'ALTER TABLE teaching_groups ADD COLUMN subject_code TEXT;',
    'ALTER TABLE teaching_groups ADD COLUMN total_units INTEGER DEFAULT 5;',
    'ALTER TABLE teaching_groups ADD COLUMN syllabus_units TEXT;',
    'ALTER TABLE attendance_sessions ADD COLUMN period_number INTEGER DEFAULT 1;',
    'ALTER TABLE students ADD COLUMN address TEXT;',
    'ALTER TABLE students ADD COLUMN aadhar_number TEXT;',
    'ALTER TABLE students ADD COLUMN father_name TEXT;',
    'ALTER TABLE students ADD COLUMN mother_name TEXT;',
    'ALTER TABLE students ADD COLUMN dob TEXT;',
    'ALTER TABLE students ADD COLUMN gender TEXT;',
    'ALTER TABLE students ADD COLUMN category TEXT;',
    'ALTER TABLE students ADD COLUMN profile_completed INTEGER DEFAULT 1;',
    'ALTER TABLE students ADD COLUMN admission_year INTEGER DEFAULT 2024;',
    'ALTER TABLE students ADD COLUMN is_lateral_entry INTEGER DEFAULT 0;',
    'ALTER TABLE students ADD COLUMN graduation_year INTEGER DEFAULT 2027;',
    'ALTER TABLE students ADD COLUMN registration_no TEXT;',
    'ALTER TABLE students ADD COLUMN class_roll_no INTEGER;',
    'ALTER TABLE students ADD COLUMN phone TEXT;',
    'ALTER TABLE students ADD COLUMN parent_phone TEXT;',
    'ALTER TABLE students ADD COLUMN parent_name TEXT;',
    'ALTER TABLE students ADD COLUMN is_phone_verified INTEGER DEFAULT 1;'
  ];

  for (const stmt of alterStatements) {
    try { db.exec(stmt); } catch (_) {}
  }

  // 1. Clean Wipe of previous tables
  console.log('[1/8] Cleaning up existing SQLite tables for pristine presentation state...');
  const tables = [
    'classroom_post_comments',
    'classroom_posts',
    'teaching_group_members',
    'teaching_groups',
    'assessment_submissions',
    'assessments',
    'fingerprint_slots',
    'esp32_presence',
    'iot_attendance_events',
    'devices',
    'register_attendance',
    'attendance_corrections',
    'attendance_session_students',
    'attendance_sessions',
    'attendance_registers',
    'student_self_attendance',
    'student_department_enrollments',
    'enrollments',
    'leave_applications',
    'students',
    'teacher_assignments',
    'subjects',
    'teachers',
    'departments',
    'academic_years',
    'notifications',
    'audit_logs',
    'user_sessions',
    'user_roles',
    'users',
    'faculty_registration_requests',
    'common_faculty_manager_assignments'
  ];

  for (const t of tables) {
    try { db.exec(`DELETE FROM ${t};`); } catch (_) {}
  }
  try { db.exec('DELETE FROM sqlite_sequence;'); } catch (_) {}
  console.log('      ✓ Tables cleaned successfully.');

  // Pre-hash password
  const passwordHash = bcrypt.hashSync(UNIVERSAL_PASSWORD, 10);

  // 2. Academic Year & System Settings
  console.log('[2/8] Seeding Academic Year 2026-27 & Institutional System Settings...');
  db.prepare(`
    INSERT INTO academic_years (id, label, start_date, end_date, is_current)
    VALUES (1, '2026-27 (Odd Semester)', '2026-07-01', '2027-06-30', 1)
  `).run();

  const settings = [
    ['institution_name', 'Government Polytechnic Nainital', 'Official Polytechnic College Name'],
    ['institution_code', 'GP-UBTER-101', 'UBTER College Affiliation Code'],
    ['institution_affiliation', 'Uttarakhand Board of Technical Education, Roorkee (UBTER)', 'Affiliation Authority'],
    ['default_attendance_threshold_percent', '75', 'Minimum attendance required for exam eligibility'],
    ['self_attendance_default_timer_minutes', '15', 'Default expiration timer for PIN and QR soft self-attendance'],
    ['allow_student_self_registration', 'true', 'Student self-registration gate toggle'],
    ['seed_version', 'v30-presentation-nainital', 'Active seed version']
  ];

  for (const [k, v, desc] of settings) {
    db.prepare(`
      INSERT OR REPLACE INTO system_settings (setting_key, setting_value, description)
      VALUES (?, ?, ?)
    `).run(k, v, desc);
  }

  // 3. Departments (6 Canonical UBTER Polytechnic Depts)
  console.log('[3/8] Seeding 6 Canonical Departments...');
  const departmentsData = [
    { id: 2, name: 'Electronics Engineering', code: 'ECE', duration: 3 },
    { id: 3, name: 'Electrical Engineering', code: 'EE', duration: 3 },
    { id: 4, name: 'Information Technology', code: 'IT', duration: 3 },
    { id: 5, name: 'Mechanical Engineering', code: 'ME', duration: 3 },
    { id: 6, name: 'Civil Engineering', code: 'CE', duration: 3 },
    { id: 7, name: 'Pharmacy', code: 'PHARM', duration: 2 }
  ];

  for (const dept of departmentsData) {
    db.prepare(`
      INSERT INTO departments (id, name, code, is_active, degree_duration_years, active_term)
      VALUES (?, ?, ?, 1, ?, '2026-27 (Odd Semester)')
    `).run(dept.id, dept.name, dept.code, dept.duration);
  }

  // 4. Seed User Accounts, Roles, Faculty Profiles & HOD Assignments
  console.log('[4/8] Seeding System Admin, 6 Department HODs, and 3 IT Faculty...');

  // User 1: System Admin
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, must_change_password, status)
    VALUES (1, 'admin', 'admin@gmail.com', ?, 0, 'ACTIVE')
  `).run(passwordHash);
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (1, 'SYSTEM_ADMIN')`).run();
  db.prepare(`
    INSERT INTO teachers (id, user_id, employee_id, department_id, full_name, phone, is_phone_verified)
    VALUES (1, 1, 'ADMIN-01', 4, 'System Administrator', '9897000001', 1)
  `).run();

  // 6 HODs (Users 2 - 7, Teachers 2 - 7)
  const hods = [
    { userId: 2, teacherId: 2, deptId: 4, username: 'hod_it', email: 'hod.it@polytechnic.edu', name: 'Dr. Ramesh Chandra', empId: 'HOD-IT-01', phone: '9897000002' },
    { userId: 3, teacherId: 3, deptId: 2, username: 'hod_ece', email: 'hod.ece@polytechnic.edu', name: 'Prof. Sunita Sharma', empId: 'HOD-ECE-01', phone: '9897000003' },
    { userId: 4, teacherId: 4, deptId: 3, username: 'hod_ee', email: 'hod.ee@polytechnic.edu', name: 'Er. Deepak Joshi', empId: 'HOD-EE-01', phone: '9897000004' },
    { userId: 5, teacherId: 5, deptId: 5, username: 'hod_me', email: 'hod.me@polytechnic.edu', name: 'Dr. Anand Pant', empId: 'HOD-ME-01', phone: '9897000005' },
    { userId: 6, teacherId: 6, deptId: 6, username: 'hod_ce', email: 'hod.ce@polytechnic.edu', name: 'Prof. Priya Negi', empId: 'HOD-CE-01', phone: '9897000006' },
    { userId: 7, teacherId: 7, deptId: 7, username: 'hod_pharm', email: 'hod.pharm@polytechnic.edu', name: 'Dr. Rajesh Rawat', empId: 'HOD-PHARM-01', phone: '9897000007' }
  ];

  for (const h of hods) {
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, 'ACTIVE')
    `).run(h.userId, h.username, h.email, passwordHash);

    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`).run(h.userId);
    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'HOD')`).run(h.userId);

    db.prepare(`
      INSERT INTO teachers (id, user_id, employee_id, department_id, full_name, phone, is_phone_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(h.teacherId, h.userId, h.empId, h.deptId, h.name, h.phone);

    // Link HOD to Department
    db.prepare(`UPDATE departments SET hod_user_id = ? WHERE id = ?`).run(h.userId, h.deptId);

    // HOD Assignment
    db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, assignment_type, department_id, year, semester, academic_year_id, assigned_by, is_active)
      VALUES (?, 'HOD', ?, 3, 5, 1, 1, 1)
    `).run(h.teacherId, h.deptId);
  }

  // 3 IT Faculty (Users 8 - 10, Teachers 8 - 10)
  const faculty = [
    { userId: 8, teacherId: 8, deptId: 4, username: 'teacher1', email: 'teacher.amit@polytechnic.edu', name: 'Er. Amit Verma', empId: 'FAC-IT-01', phone: '9897000008' },
    { userId: 9, teacherId: 9, deptId: 4, username: 'teacher2', email: 'teacher.neha@polytechnic.edu', name: 'Ms. Neha Bisht', empId: 'FAC-IT-02', phone: '9897000009' },
    { userId: 10, teacherId: 10, deptId: 4, username: 'teacher3', email: 'teacher.rahul@polytechnic.edu', name: 'Er. Rahul Tiwari', empId: 'FAC-IT-03', phone: '9897000010' }
  ];

  for (const f of faculty) {
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, 'ACTIVE')
    `).run(f.userId, f.username, f.email, passwordHash);

    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`).run(f.userId);

    db.prepare(`
      INSERT INTO teachers (id, user_id, employee_id, department_id, full_name, phone, is_phone_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(f.teacherId, f.userId, f.empId, f.deptId, f.name, f.phone);
  }

  // 5. Subjects & Curriculum
  console.log('[5/8] Seeding Department Curriculum & Subjects...');
  const subjectsData = [
    { id: 1, deptId: 4, year: 3, sem: 5, code: 'IT-501', name: 'Data Structures & Algorithms', hasPrac: 1 },
    { id: 2, deptId: 4, year: 3, sem: 5, code: 'IT-502', name: 'Database Management Systems', hasPrac: 1 },
    { id: 3, deptId: 4, year: 3, sem: 5, code: 'IT-503', name: 'Web Development Technologies', hasPrac: 1 },
    { id: 4, deptId: 4, year: 3, sem: 5, code: 'IT-504', name: 'Computer Networks & Cloud Computing', hasPrac: 0 },
    { id: 5, deptId: 2, year: 2, sem: 3, code: 'ECE-301', name: 'Digital Electronics', hasPrac: 1 },
    { id: 6, deptId: 2, year: 2, sem: 3, code: 'ECE-302', name: 'Signals & Systems', hasPrac: 0 },
    { id: 7, deptId: 3, year: 2, sem: 3, code: 'EE-301', name: 'Electrical Machines', hasPrac: 1 },
    { id: 8, deptId: 3, year: 2, sem: 3, code: 'EE-302', name: 'Network Analysis & Circuit Theory', hasPrac: 0 }
  ];

  for (const sub of subjectsData) {
    db.prepare(`
      INSERT INTO subjects (id, department_id, year, semester, name, code, has_practical, is_active, syllabus_scheme)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, '2026-27')
    `).run(sub.id, sub.deptId, sub.year, sub.sem, sub.name, sub.code, sub.hasPrac);
  }

  // Teacher Subject Assignments
  // Er. Amit Verma -> IT-501
  const asgn1 = db.prepare(`
    INSERT INTO teacher_assignments (teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
    VALUES (8, 'SUBJECT_TEACHER', 1, 'THEORY', 4, 3, 5, 1, 2)
  `).run().lastInsertRowid;
  // Ms. Neha Bisht -> IT-502
  const asgn2 = db.prepare(`
    INSERT INTO teacher_assignments (teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
    VALUES (9, 'SUBJECT_TEACHER', 2, 'THEORY', 4, 3, 5, 1, 2)
  `).run().lastInsertRowid;
  // Er. Rahul Tiwari -> IT-503
  const asgn3 = db.prepare(`
    INSERT INTO teacher_assignments (teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
    VALUES (10, 'SUBJECT_TEACHER', 3, 'PRACTICAL', 4, 3, 5, 1, 2)
  `).run().lastInsertRowid;
  // Dr. Ramesh Chandra (HOD) -> IT-504
  const asgn4 = db.prepare(`
    INSERT INTO teacher_assignments (teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
    VALUES (2, 'SUBJECT_TEACHER', 4, 'THEORY', 4, 3, 5, 1, 1)
  `).run().lastInsertRowid;

  // 6. Enrolled Students (15 IT 3rd Year, 5 ECE 2nd Year, 5 EE 2nd Year)
  console.log('[6/8] Seeding 25 Enrolled Students across Cohorts...');
  const itStudents = [
    { roll: 1, name: 'Aarav Mehta', reg: 'UBTER2024IT001', username: 'student1', email: 'aarav.mehta@student.polytechnic.edu', phone: '9897100001', parent: 'Sanjay Mehta', gender: 'MALE', targetPct: 0.90 },
    { roll: 2, name: 'Pooja Joshi', reg: 'UBTER2024IT002', username: 'student2', email: 'pooja.joshi@student.polytechnic.edu', phone: '9897100002', parent: 'Kailash Joshi', gender: 'FEMALE', targetPct: 0.95 },
    { roll: 3, name: 'Rohan Karki', reg: 'UBTER2024IT003', username: 'student3', email: 'rohan.karki@student.polytechnic.edu', phone: '9897100003', parent: 'Mohan Karki', gender: 'MALE', targetPct: 0.75 },
    { roll: 4, name: 'Ananya Pandey', reg: 'UBTER2024IT004', username: 'student4', email: 'ananya.pandey@student.polytechnic.edu', phone: '9897100004', parent: 'Rajesh Pandey', gender: 'FEMALE', targetPct: 0.88 },
    { roll: 5, name: 'Vikram Singh', reg: 'UBTER2024IT005', username: 'student5', email: 'vikram.singh@student.polytechnic.edu', phone: '9897100005', parent: 'Harish Singh', gender: 'MALE', targetPct: 0.72 },
    { roll: 6, name: 'Priya Rawat', reg: 'UBTER2024IT006', username: 'priya_it', email: 'priya.rawat@student.polytechnic.edu', phone: '9897100006', parent: 'Sunil Rawat', gender: 'FEMALE', targetPct: 0.85 },
    { roll: 7, name: 'Gaurav Bhatt', reg: 'UBTER2024IT007', username: 'gaurav_it', email: 'gaurav.bhatt@student.polytechnic.edu', phone: '9897100007', parent: 'Bhuwan Bhatt', gender: 'MALE', targetPct: 0.80 },
    { roll: 8, name: 'Divya Bisht', reg: 'UBTER2024IT008', username: 'divya_it', email: 'divya.bisht@student.polytechnic.edu', phone: '9897100008', parent: 'Naveen Bisht', gender: 'FEMALE', targetPct: 0.92 },
    { roll: 9, name: 'Manish Arya', reg: 'UBTER2024IT009', username: 'manish_it', email: 'manish.arya@student.polytechnic.edu', phone: '9897100009', parent: 'Kamal Arya', gender: 'MALE', targetPct: 0.78 },
    { roll: 10, name: 'Sneha Negi', reg: 'UBTER2024IT010', username: 'sneha_it', email: 'sneha.negi@student.polytechnic.edu', phone: '9897100010', parent: 'Devendra Negi', gender: 'FEMALE', targetPct: 0.84 },
    { roll: 11, name: 'Ayush Shah', reg: 'UBTER2024IT011', username: 'ayush_it', email: 'ayush.shah@student.polytechnic.edu', phone: '9897100011', parent: 'Pradeep Shah', gender: 'MALE', targetPct: 0.82 },
    { roll: 12, name: 'Kavita Danu', reg: 'UBTER2024IT012', username: 'kavita_it', email: 'kavita.danu@student.polytechnic.edu', phone: '9897100012', parent: 'Sher Singh Danu', gender: 'FEMALE', targetPct: 0.88 },
    { roll: 13, name: 'Mohit Pande', reg: 'UBTER2024IT013', username: 'mohit_it', email: 'mohit.pande@student.polytechnic.edu', phone: '9897100013', parent: 'Girish Pande', gender: 'MALE', targetPct: 0.74 },
    { roll: 14, name: 'Simran Kaur', reg: 'UBTER2024IT014', username: 'simran_it', email: 'simran.kaur@student.polytechnic.edu', phone: '9897100014', parent: 'Gurpreet Kaur', gender: 'FEMALE', targetPct: 0.94 },
    { roll: 15, name: 'Harish Adhikari', reg: 'UBTER2024IT015', username: 'harish_it', email: 'harish.adhikari@student.polytechnic.edu', phone: '9897100015', parent: 'Jagat Adhikari', gender: 'MALE', targetPct: 0.80 }
  ];

  let currentUserId = 11;
  let currentStudentId = 1;
  const itStudentIds = [];

  for (const s of itStudents) {
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, 'ACTIVE')
    `).run(currentUserId, s.username, s.email, passwordHash);

    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`).run(currentUserId);

    db.prepare(`
      INSERT INTO students (
        id, user_id, official_enrollment_no, registration_no, full_name, class_roll_no,
        admission_year, is_lateral_entry, graduation_year, phone, parent_phone, parent_name,
        address, aadhar_number, father_name, dob, gender, category, profile_completed, is_phone_verified
      ) VALUES (?, ?, ?, ?, ?, ?, 2024, 0, 2027, ?, '9897999999', ?, 'Nainital, Uttarakhand', '1234-5678-9012', ?, '2005-06-15', ?, 'GENERAL', 1, 1)
    `).run(currentStudentId, currentUserId, s.reg, s.reg, s.name, s.roll, s.phone, s.parent, s.parent, s.gender);

    db.prepare(`
      INSERT INTO enrollments (id, student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
      VALUES (?, ?, 4, 3, 5, 1, ?, 'ENROLLED')
    `).run(currentStudentId, currentStudentId, s.roll);

    db.prepare(`
      INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
      VALUES (?, 4, 1, 3, 5, ?, '2026-07-01', 'ACTIVE')
    `).run(currentStudentId, s.roll);

    itStudentIds.push({ id: currentStudentId, userId: currentUserId, name: s.name, targetPct: s.targetPct, roll: s.roll });
    currentUserId++;
    currentStudentId++;
  }

  // 5 ECE Students
  const eceStudents = [
    { name: 'Kunal Joshi', reg: 'UBTER2025ECE001', roll: 1 },
    { name: 'Megha Pant', reg: 'UBTER2025ECE002', roll: 2 },
    { name: 'Tanuj Arya', reg: 'UBTER2025ECE003', roll: 3 },
    { name: 'Ritika Tiwari', reg: 'UBTER2025ECE004', roll: 4 },
    { name: 'Saurabh Negi', reg: 'UBTER2025ECE005', roll: 5 }
  ];

  for (const s of eceStudents) {
    const uName = `ece_student_${s.roll}`;
    const email = `${uName}@student.polytechnic.edu`;
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, 'ACTIVE')
    `).run(currentUserId, uName, email, passwordHash);

    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`).run(currentUserId);

    db.prepare(`
      INSERT INTO students (
        id, user_id, official_enrollment_no, registration_no, full_name, class_roll_no,
        admission_year, is_lateral_entry, graduation_year, phone, profile_completed
      ) VALUES (?, ?, ?, ?, ?, ?, 2025, 0, 2028, '9897200000', 1)
    `).run(currentStudentId, currentUserId, s.reg, s.reg, s.name, s.roll);

    db.prepare(`
      INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
      VALUES (?, 2, 2, 3, 1, ?, 'ENROLLED')
    `).run(currentStudentId, s.roll);

    db.prepare(`
      INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
      VALUES (?, 2, 1, 2, 3, ?, '2026-07-01', 'ACTIVE')
    `).run(currentStudentId, s.roll);

    currentUserId++;
    currentStudentId++;
  }

  // 5 EE Students
  const eeStudents = [
    { name: 'Abhishek Upadhyay', reg: 'UBTER2025EE001', roll: 1 },
    { name: 'Chitra Pandey', reg: 'UBTER2025EE002', roll: 2 },
    { name: 'Deepak Bora', reg: 'UBTER2025EE003', roll: 3 },
    { name: 'Monika Kaira', reg: 'UBTER2025EE004', roll: 4 },
    { name: 'Suraj Mehta', reg: 'UBTER2025EE005', roll: 5 }
  ];

  for (const s of eeStudents) {
    const uName = `ee_student_${s.roll}`;
    const email = `${uName}@student.polytechnic.edu`;
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, must_change_password, status)
      VALUES (?, ?, ?, ?, 0, 'ACTIVE')
    `).run(currentUserId, uName, email, passwordHash);

    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`).run(currentUserId);

    db.prepare(`
      INSERT INTO students (
        id, user_id, official_enrollment_no, registration_no, full_name, class_roll_no,
        admission_year, is_lateral_entry, graduation_year, phone, profile_completed
      ) VALUES (?, ?, ?, ?, ?, ?, 2025, 0, 2028, '9897300000', 1)
    `).run(currentStudentId, currentUserId, s.reg, s.reg, s.name, s.roll);

    db.prepare(`
      INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
      VALUES (?, 3, 2, 3, 1, ?, 'ENROLLED')
    `).run(currentStudentId, s.roll);

    db.prepare(`
      INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
      VALUES (?, 3, 1, 2, 3, ?, '2026-07-01', 'ACTIVE')
    `).run(currentStudentId, s.roll);

    currentUserId++;
    currentStudentId++;
  }

  // 7. Teaching Groups, Members & Digital Registers
  console.log('[7/8] Seeding Teaching Groups, Registers & Live Attendance Data...');
  const groupsData = [
    {
      id: 1,
      name: 'IT 3rd Year - Data Structures & Algorithms',
      subjectName: 'Data Structures & Algorithms',
      subjectCode: 'IT-501',
      component: 'THEORY',
      teacherId: 8, // Er. Amit Verma
      subjectId: 1,
      inviteCode: 'IT501TH',
      assignmentId: asgn1
    },
    {
      id: 2,
      name: 'IT 3rd Year - Database Management Systems',
      subjectName: 'Database Management Systems',
      subjectCode: 'IT-502',
      component: 'THEORY',
      teacherId: 9, // Ms. Neha Bisht
      subjectId: 2,
      inviteCode: 'IT502TH',
      assignmentId: asgn2
    },
    {
      id: 3,
      name: 'IT 3rd Year - Web Development Lab',
      subjectName: 'Web Development Technologies',
      subjectCode: 'IT-503',
      component: 'PRACTICAL',
      teacherId: 10, // Er. Rahul Tiwari
      subjectId: 3,
      inviteCode: 'IT503PR',
      assignmentId: asgn3
    },
    {
      id: 4,
      name: 'IT 3rd Year - Computer Networks & Cloud',
      subjectName: 'Computer Networks & Cloud Computing',
      subjectCode: 'IT-504',
      component: 'THEORY',
      teacherId: 2, // Dr. Ramesh Chandra (HOD)
      subjectId: 4,
      inviteCode: 'IT504TH',
      assignmentId: asgn4
    }
  ];

  for (const g of groupsData) {
    db.prepare(`
      INSERT INTO teaching_groups (id, name, subject_name, subject_code, component, total_units, teacher_id, academic_year_id, semester, invite_code, status)
      VALUES (?, ?, ?, ?, ?, 5, ?, 1, 5, ?, 'ACTIVE')
    `).run(g.id, g.name, g.subjectName, g.subjectCode, g.component, g.teacherId, g.inviteCode);

    // Official Register for the Group
    db.prepare(`
      INSERT INTO attendance_registers (id, teacher_id, name, subject_id, assignment_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id)
      VALUES (?, ?, ?, ?, ?, 4, 3, 5, 1, ?, 1, 1, ?)
    `).run(g.id, g.teacherId, `${g.subjectName} (${g.component}) — 2026-27`, g.subjectId, g.assignmentId, g.component, g.id);

    // Enroll all 15 IT students in this group
    for (const st of itStudentIds) {
      db.prepare(`
        INSERT INTO teaching_group_members (group_id, student_id, status)
        VALUES (?, ?, 'ENROLLED')
      `).run(g.id, st.id);
    }
  }

  // Historical Attendance Sessions for Register 1 (IT-501 DSA) & Register 2 (IT-502 DBMS)
  // Generating sessions across October 2026
  const sessionDates = [
    '2026-10-05',
    '2026-10-07',
    '2026-10-12',
    '2026-10-14',
    '2026-10-19',
    '2026-10-21',
    '2026-10-26',
    '2026-10-28',
    '2026-10-30'
  ];

  let sessionId = 1;
  for (const d of sessionDates) {
    // Session for Register 1 (IT-501 DSA)
    db.prepare(`
      INSERT INTO attendance_sessions (id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, end_time, state, period_number)
      VALUES (?, 1, 8, 1, 4, 3, 5, 1, 'THEORY', ?, ?, ? || ' 10:00:00', ? || ' 11:00:00', 'FINALIZED', 1)
    `).run(sessionId, `DSA Lecture - ${d}`, d, d, d);

    // Mark attendance records
    for (const st of itStudentIds) {
      // Deterministic realistic attendance based on targetPct
      const isPresent = ((st.id * 17 + sessionId * 31) % 100) < (st.targetPct * 100);
      const status = isPresent ? 'PRESENT' : 'ABSENT';
      const source = isPresent && st.roll <= 4 ? 'QR' : 'MANUAL';

      db.prepare(`
        INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, marked_at)
        VALUES (?, ?, ?, ?, 8, ? || ' 10:05:00')
      `).run(sessionId, st.id, status, source, d);
    }
    sessionId++;

    // Session for Register 2 (IT-502 DBMS)
    db.prepare(`
      INSERT INTO attendance_sessions (id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, end_time, state, period_number)
      VALUES (?, 2, 9, 2, 4, 3, 5, 1, 'THEORY', ?, ?, ? || ' 11:15:00', ? || ' 12:15:00', 'FINALIZED', 2)
    `).run(sessionId, `DBMS Lecture - ${d}`, d, d, d);

    for (const st of itStudentIds) {
      const isPresent = ((st.id * 23 + sessionId * 19) % 100) < (st.targetPct * 100);
      const status = isPresent ? 'PRESENT' : 'ABSENT';

      db.prepare(`
        INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, marked_at)
        VALUES (?, ?, ?, 'MANUAL', 9, ? || ' 11:20:00')
      `).run(sessionId, st.id, status, d);
    }
    sessionId++;
  }

  // TODAY'S COMPLETED SESSION (so Admin Dashboard & Faculty Dashboard show ~86% attendance today!)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySessionId = sessionId++;

  db.prepare(`
    INSERT INTO attendance_sessions (id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, end_time, state, period_number)
    VALUES (?, 1, 8, 1, 4, 3, 5, 1, 'THEORY', ?, ?, ? || ' 09:30:00', ? || ' 10:30:00', 'FINALIZED', 1)
  `).run(todaySessionId, "Today's Morning DSA Lecture", todayStr, todayStr, todayStr);

  // 13 Present, 2 Absent = 86.7%
  for (const st of itStudentIds) {
    const isPresent = st.roll !== 5 && st.roll !== 13; // Roll 5 and Roll 13 absent
    const status = isPresent ? 'PRESENT' : 'ABSENT';
    const source = isPresent ? (st.roll % 2 === 0 ? 'QR' : 'PIN') : 'MANUAL';

    db.prepare(`
      INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, marked_at)
      VALUES (?, ?, ?, ?, 8, ? || ' 09:35:00')
    `).run(todaySessionId, st.id, status, source, todayStr);
  }

  // ALSO ADD TODAY'S LIVE "OPEN" SESSION WITH DYNAMIC QR & PIN (For demonstrating live Roll Call studio modal)
  const openSessionId = sessionId++;
  db.prepare(`
    INSERT INTO attendance_sessions (
      id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id,
      session_type, label, session_date, start_time, end_time, state, period_number,
      verification_pin, verification_qr_hash, verification_expires_at
    ) VALUES (
      ?, 2, 9, 2, 4, 3, 5, 1,
      'THEORY', 'Live Interactive DBMS Session', ?, ? || ' 14:00:00', ? || ' 15:00:00', 'OPEN', 4,
      '749201', 'VIDYA_QR_TOKEN_DEMO_2026_DBMS', datetime('now', '+45 minutes')
    )
  `).run(openSessionId, todayStr, todayStr, todayStr);

  // 8. Assessments, Submissions, Stream Posts, Leave Requests, Devices & Notifications
  console.log('[8/8] Seeding Coursework, Marksheets, Stream Posts, Leaves & Hardware...');

  // Assessment 1: Assignment in Group 1
  db.prepare(`
    INSERT INTO assessments (id, teacher_id, subject_id, group_id, department_id, year, semester, academic_year_id, type, title, description, due_date, max_marks, instructions, unit_name)
    VALUES (
      1, 8, 1, 1, 4, 3, 5, 1, 'ASSIGNMENT',
      'Assignment 1: Implementation of Balanced Binary Search Trees (AVL)',
      'Construct a complete C++ program implementing AVL Tree insertion, single/double rotations, and height calculation.',
      datetime('now', '+7 days'), 20,
      'Submit your source code .cpp file with algorithmic complexity analysis.', 'Unit 2: Non-Linear Data Structures'
    )
  `).run();

  // Submissions for Assignment 1 (8 students submitted, 5 graded)
  const submissionsData = [
    { studentId: 1, marks: 19.5, status: 'GRADED', feedback: 'Exceptional rotation logic and clean commentary!' },
    { studentId: 2, marks: 20.0, status: 'GRADED', feedback: 'Flawless AVL rebalancing and tree traversal.' },
    { studentId: 3, marks: 16.5, status: 'GRADED', feedback: 'Good implementation; recheck right-left rotation edge case.' },
    { studentId: 4, marks: 18.0, status: 'GRADED', feedback: 'Very well structured code and complexity proof.' },
    { studentId: 6, marks: 17.5, status: 'GRADED', feedback: 'Correct balance factor logic.' },
    { studentId: 7, marks: null, status: 'SUBMITTED', feedback: null },
    { studentId: 8, marks: null, status: 'SUBMITTED', feedback: null },
    { studentId: 9, marks: null, status: 'SUBMITTED', feedback: null }
  ];

  for (const sub of submissionsData) {
    db.prepare(`
      INSERT INTO assessment_submissions (assessment_id, student_id, original_filename, submitted_at, status, marks_obtained, feedback, graded_at, graded_by)
      VALUES (1, ?, 'avl_tree_assignment.cpp', datetime('now', '-2 days'), ?, ?, ?, datetime('now', '-1 day'), 8)
    `).run(sub.studentId, sub.status, sub.marks, sub.feedback);
  }

  // Assessment 2: Class Test 1 in Group 2 (DBMS)
  db.prepare(`
    INSERT INTO assessments (id, teacher_id, subject_id, group_id, department_id, year, semester, academic_year_id, type, title, description, due_date, max_marks, instructions, unit_name)
    VALUES (
      2, 9, 2, 2, 4, 3, 5, 1, 'EXAM',
      'Class Test 1: Relational Algebra & SQL Normalization',
      'Mid-term assessment covering ER modeling, BCNF decomposition, and SQL subqueries.',
      datetime('now', '-3 days'), 50,
      'Closed-book 1 hour written test.', 'Unit 1 & 2: Relational Fundamentals'
    )
  `).run();

  // Marks entered for Class Test 1
  for (const st of itStudentIds) {
    const marks = Math.min(50, Math.round(32 + (st.targetPct * 18) + (st.roll % 3)));
    db.prepare(`
      INSERT INTO assessment_submissions (assessment_id, student_id, status, marks_obtained, feedback, graded_at, graded_by)
      VALUES (2, ?, 'GRADED', ?, 'Exam evaluated and verified.', datetime('now', '-2 days'), 9)
    `).run(st.id, marks);
  }

  // Classroom Stream Posts in Group 1
  db.prepare(`
    INSERT INTO classroom_posts (id, group_id, author_id, content, created_at)
    VALUES (
      1, 1, 8,
      ?,
      datetime('now', '-10 days')
    )
  `).run("Welcome to Data Structures & Algorithms (IT-501) for Odd Semester 2026-27! The detailed syllabus, lecture schedule, and reference materials have been uploaded. Please prepare Unit 1 for next week's seminar.");

  db.prepare(`
    INSERT INTO classroom_posts (id, group_id, author_id, content, created_at)
    VALUES (
      2, 1, 8,
      ?,
      datetime('now', '-3 days')
    )
  `).run("Assignment 1 on AVL Trees has been posted. Due date is next Friday. Ensure your submissions include time complexity proofs.");

  // Student comments on Stream Post
  db.prepare(`
    INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
    VALUES (2, 11, ?, datetime('now', '-2 days'))
  `).run("Sir, should we implement recursive or iterative tree rotations?");

  db.prepare(`
    INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
    VALUES (2, 8, ?, datetime('now', '-1 day'))
  `).run("Recursive rotation implementations are preferred as outlined in the lecture notes.");

  // Student Leave Applications
  // Approved Leave for Rohan Karki (student3, id=3)
  db.prepare(`
    INSERT INTO leave_applications (id, student_id, from_date, to_date, reason, status, reviewed_by, review_note, reviewed_at)
    VALUES (
      1, 3, date('now', '-5 days'), date('now', '-4 days'),
      ?,
      'APPROVED', 2, ?, datetime('now', '-4 days')
    )
  `).run('Severe viral fever and doctor prescribed bed rest.', 'Medical certificate verified. Approved.');

  // Pending Leave for Vikram Singh (student5, id=5)
  db.prepare(`
    INSERT INTO leave_applications (id, student_id, from_date, to_date, reason, status)
    VALUES (
      2, 5, date('now', '+2 days'), date('now', '+3 days'),
      ?,
      'PENDING'
    )
  `).run('Attending family wedding ceremony out of station.');

  // IoT ESP32 Biometric Hardware Terminals
  db.prepare(`
    INSERT INTO devices (id, device_uid, name, department_id, year, semester, academic_year_id, secret_hash, is_active, last_heartbeat_at)
    VALUES (
      1, 'ESP32_IT_LAB_01', 'IT Advanced Software Lab Entrance Terminal', 4, 3, 5, 1,
      'secret_token_lab01', 1, datetime('now', '-2 minutes')
    )
  `).run();

  db.prepare(`
    INSERT INTO devices (id, device_uid, name, department_id, year, semester, academic_year_id, secret_hash, is_active, last_heartbeat_at)
    VALUES (
      2, 'ESP32_MAIN_GATE', 'Government Polytechnic Academic Block Turnstile', 4, 3, 5, 1,
      'secret_token_gate', 1, datetime('now', '-1 minute')
    )
  `).run();

  // In-App Notifications
  const notifications = [
    { userId: 1, type: 'SYSTEM', title: 'System Synchronized', message: 'VidyaOS Academic Year 2026-27 is fully initialized with 6 active departments.', link_url: '/admin/index.html' },
    { userId: 2, type: 'DEPARTMENT', title: 'Department Faculty Active', message: 'All 3 IT department teaching groups and coursework registers are active.', link_url: '/faculty/registers.html' },
    { userId: 8, type: 'ASSIGNMENT', title: 'Assignment Submissions Received', message: '8 students have submitted Assignment 1 (AVL Trees).', link_url: '/faculty/registers.html?tab=assignments' },
    { userId: 11, type: 'ACADEMIC', title: 'Welcome to VidyaOS', message: 'You are enrolled in 4 courses for IT 3rd Year Semester 5.', link_url: '/student/dashboard/dashboard.html' },
    { userId: 11, type: 'ASSIGNMENT', title: 'New Coursework Published', message: 'Assignment 1: AVL Trees is due next week.', link_url: '/student/assignments/assignments.html' }
  ];

  for (const n of notifications) {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link_url, is_read)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(n.userId, n.type, n.title, n.message, n.link_url);
  }

  // Audit Logs
  db.prepare(`
    INSERT INTO audit_logs (user_id, actor_id, actor_role, action, event_type, entity_type, target_type, entity_id, target_id, details_json)
    VALUES (1, 1, 'SYSTEM_ADMIN', 'SYSTEM_SEED', 'SYSTEM_SEED', 'INSTITUTION', 'INSTITUTION', '1', '1', '{"action":"PRESENTATION_SEEDED","institution":"Government Polytechnic Nainital","academic_year":"2026-27"}')
  `).run();

  db.exec('PRAGMA foreign_keys = ON;');

  console.log(`\n=================================================================`);
  console.log(`✅  PRESENTATION DATA SEED COMPLETED SUCCESSFULLY!`);
  console.log(`    - 6 Active Departments (IT, ECE, EE, ME, CE, PHARM)`);
  console.log(`    - 1 Master Admin (admin / Admin@123)`);
  console.log(`    - 6 Department HODs (hod_it, hod_ece, hod_ee, hod_me, hod_ce, hod_pharm)`);
  console.log(`    - 3 IT Faculty (teacher1, teacher2, teacher3)`);
  console.log(`    - 25 Enrolled Students (15 IT, 5 ECE, 5 EE)`);
  console.log(`    - 4 Teaching Groups & Digital Registers`);
  console.log(`    - 19 Attendance Sessions (~84% attendance rate, live today session)`);
  console.log(`    - 1 Live Active Studio Session with PIN (749201)`);
  console.log(`    - 2 Course Assessments, 8 Submissions & Class Test Marksheet`);
  console.log(`    - 2 Leave Applications (1 Approved, 1 Pending)`);
  console.log(`    - 2 Online ESP32 Biometric Hardware Terminals`);
  console.log(`=================================================================\n`);
}

// Auto-run if executed directly
if (require.main === module) {
  const defaultPath = path.resolve(__dirname, '../college_attendance.sqlite');
  runPresentationSeed(defaultPath);

  // Also check if deployfolder exists and seed it too
  const deployDbPath = path.resolve(__dirname, '../../deployfolder/VidyaOS_BackEnd/college_attendance.sqlite');
  if (fs.existsSync(path.dirname(deployDbPath))) {
    runPresentationSeed(deployDbPath);
  }
}

module.exports = { runPresentationSeed };
