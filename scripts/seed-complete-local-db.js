/**
 * Complete Local Database Seeder for VidyaOS
 * Generates rich, realistic test data for all portals:
 * - Student Portal (/student/*)
 * - Faculty Portal (/faculty/*)
 * - HOD Portal (/faculty/* with HOD privileges)
 * - Admin Portal (/admin/*)
 * 
 * Includes personal student account for Girdhar Dhami:
 * - Email: gdhami115@gmail.com
 * - Roll No: 1
 * - UBTER Roll No: 24011090008
 * - Mobile: 7453046125
 * - Password: Password@123 / girdhartdhami
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { query } = require('../src/config/db');

// Minimal valid PDF generator for coursework and assessment uploads
function createDummyPdf(text) {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 120 >>
stream
BT
/F1 16 Tf
50 720 Td
(${text.replace(/[()]/g, '')}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000414 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
495
%%EOF`;
}

async function main() {
  console.log('🚀 Starting Full VidyaOS Local Database Seeding...');

  // Hash for Password@123
  const defaultPasswordHash = await bcrypt.hash('Password@123', 10);

  // 1. Academic Year
  console.log('\n--- 1. Ensuring Academic Year ---');
  await query(`
    INSERT INTO academic_years (id, label, start_date, end_date, is_current)
    VALUES (1, '2026-27 (Winter Session)', '2026-07-01', '2027-06-30', 1)
    ON DUPLICATE KEY UPDATE label = VALUES(label), is_current = 1
  `);
  console.log('✓ Academic year 2026-27 ensured');

  // 2. Departments
  console.log('\n--- 2. Ensuring Departments ---');
  const depts = [
    { id: 4, name: 'Information Technology', code: 'IT', hod_user_id: 2, degree_duration_years: 3 },
    { id: 2, name: 'Electronics Engineering', code: 'ECE', hod_user_id: null, degree_duration_years: 3 },
    { id: 3, name: 'Electrical Engineering', code: 'EE', hod_user_id: null, degree_duration_years: 3 },
    { id: 5, name: 'Mechanical Engineering', code: 'ME', hod_user_id: null, degree_duration_years: 3 },
    { id: 6, name: 'Civil Engineering', code: 'CE', hod_user_id: null, degree_duration_years: 3 },
    { id: 7, name: 'Pharmacy', code: 'PHARM', hod_user_id: null, degree_duration_years: 2 }
  ];
  for (const d of depts) {
    await query(`
      INSERT INTO departments (id, name, code, hod_user_id, degree_duration_years, active_term, is_active, is_official)
      VALUES (?, ?, ?, ?, ?, '2026-27 (Winter Session)', 1, 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code), hod_user_id = VALUES(hod_user_id), is_active = 1
    `, [d.id, d.name, d.code, d.hod_user_id, d.degree_duration_years]);
  }
  console.log(`✓ ${depts.length} departments ensured`);

  // 3. Branches
  console.log('\n--- 3. Ensuring Branches ---');
  const branches = [
    { id: 1, department_id: 4, name: 'Information Technology', code: 'IT' },
    { id: 2, department_id: 2, name: 'Electronics & Communication', code: 'ECE' },
    { id: 3, department_id: 3, name: 'Electrical Engineering', code: 'EE' },
    { id: 4, department_id: 5, name: 'Mechanical Engineering', code: 'ME' },
    { id: 5, department_id: 6, name: 'Civil Engineering', code: 'CE' },
    { id: 6, department_id: 7, name: 'Pharmacy', code: 'PHARM' }
  ];
  for (const b of branches) {
    await query(`
      INSERT INTO branches (id, department_id, name, code, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code), is_active = 1
    `, [b.id, b.department_id, b.name, b.code]);
  }
  console.log(`✓ ${branches.length} branches ensured`);

  // 4. Subjects
  console.log('\n--- 4. Ensuring Subjects for Semester 5 IT ---');
  const subjects = [
    { id: 1, department_id: 4, name: 'Data Structures & Algorithms', code: 'IT-501', sem: 5, year: 3, has_prac: 1 },
    { id: 2, department_id: 4, name: 'Database Management Systems', code: 'IT-502', sem: 5, year: 3, has_prac: 1 },
    { id: 3, department_id: 4, name: 'Web Development Technologies', code: 'IT-503', sem: 5, year: 3, has_prac: 1 },
    { id: 4, department_id: 4, name: 'Computer Networks & Cloud Computing', code: 'IT-504', sem: 5, year: 3, has_prac: 0 },
    { id: 9, department_id: 4, name: 'Java Programming', code: 'IT506', sem: 5, year: 3, has_prac: 1 }
  ];
  for (const s of subjects) {
    await query(`
      INSERT INTO subjects (id, department_id, year, semester, name, code, has_practical, is_active, is_official, syllabus_scheme)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, '2026-27')
      ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code), has_practical = VALUES(has_practical), is_active = 1
    `, [s.id, s.department_id, s.year, s.sem, s.name, s.code, s.has_prac]);
  }
  console.log(`✓ ${subjects.length} subjects ensured`);

  // 5. Teachers & Administrative Users
  console.log('\n--- 5. Ensuring Faculty & Admin Users ---');
  const staffUsers = [
    {
      userId: 1,
      email: 'admin@gmail.com',
      username: 'admin@gmail.com',
      roles: ['SYSTEM_ADMIN', 'ADMIN'],
      phone: '9897000001'
    },
    {
      userId: 2,
      teacherId: 2,
      email: 'hod@gmail.com',
      username: 'hod@gmail.com',
      fullName: 'Dr. Ramesh Chandra',
      empId: 'HOD-IT-01',
      deptId: 4,
      roles: ['HOD', 'TEACHER'],
      phone: '9897000002'
    },
    {
      userId: 8,
      teacherId: 8,
      email: 'teacher1@gmail.com',
      username: 'teacher1@gmail.com',
      fullName: 'Er. Amit Verma',
      empId: 'FAC-IT-01',
      deptId: 4,
      roles: ['TEACHER'],
      phone: '9897000008'
    },
    {
      userId: 9,
      teacherId: 9,
      email: 'teacher2@gmail.com',
      username: 'teacher2@gmail.com',
      fullName: 'Ms. Neha Bisht',
      empId: 'FAC-IT-02',
      deptId: 4,
      roles: ['TEACHER'],
      phone: '9897000009'
    },
    {
      userId: 10,
      teacherId: 10,
      email: 'teacher3@gmail.com',
      username: 'teacher3@gmail.com',
      fullName: 'Er. Rahul Tiwari',
      empId: 'FAC-IT-03',
      deptId: 4,
      roles: ['TEACHER'],
      phone: '9897000010'
    },
    {
      userId: 36,
      teacherId: 11,
      email: 'common@gmail.com',
      username: 'common@gmail.com',
      fullName: 'Dr. Kavita Kapoor',
      empId: 'FAC-COM-01',
      deptId: 4,
      roles: ['TEACHER'],
      phone: '9897000011'
    }
  ];

  for (const u of staffUsers) {
    await query(`
      INSERT INTO users (id, username, email, password_hash, status, must_change_password, phone)
      VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?)
      ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash), status = 'ACTIVE', must_change_password = 0, phone = VALUES(phone)
    `, [u.userId, u.username, u.email, defaultPasswordHash, u.phone]);

    // Roles
    for (const r of u.roles) {
      const exists = await query(`SELECT id FROM user_roles WHERE user_id = ? AND role = ?`, [u.userId, r]);
      if (!exists || exists.length === 0) {
        await query(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`, [u.userId, r]);
      }
    }

    // Teacher record
    if (u.teacherId) {
      await query(`
        INSERT INTO teachers (id, user_id, employee_id, department_id, full_name, phone, is_phone_verified)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE department_id = VALUES(department_id), full_name = VALUES(full_name), phone = VALUES(phone), is_phone_verified = 1
      `, [u.teacherId, u.userId, u.empId, u.deptId, u.fullName, u.phone]);
    }
  }
  console.log(`✓ Faculty & Admin staff accounts configured`);

  // 6. Student Accounts (including Girdhar Dhami & 15 cohort students)
  console.log('\n--- 6. Ensuring Students & Girdhar Dhami ---');

  // Girdhar Dhami (Student 1, User 11)
  await query(`
    INSERT INTO users (id, username, email, password_hash, status, must_change_password, phone)
    VALUES (11, 'gdhami115@gmail.com', 'gdhami115@gmail.com', ?, 'ACTIVE', 0, '7453046125')
    ON DUPLICATE KEY UPDATE email = 'gdhami115@gmail.com', username = 'gdhami115@gmail.com', password_hash = VALUES(password_hash), status = 'ACTIVE', must_change_password = 0, phone = '7453046125'
  `, [defaultPasswordHash]);

  const roleCheck = await query(`SELECT id FROM user_roles WHERE user_id = 11 AND role = 'STUDENT'`);
  if (!roleCheck || roleCheck.length === 0) {
    await query(`INSERT INTO user_roles (user_id, role) VALUES (11, 'STUDENT')`);
  }

  await query(`
    INSERT INTO students (
      id, user_id, official_enrollment_no, ubter_roll_no, enrollment_no_status, full_name,
      registration_no, class_roll_no, phone, parent_phone, parent_name,
      is_phone_verified, admission_year, is_lateral_entry, graduation_year,
      address, aadhar_number, father_name, dob, gender, category, profile_completed, entry_mode
    ) VALUES (
      1, 11, '24011090008', '24011090008', 'ASSIGNED', 'Girdhar Dhami',
      '24101054', 1, '7453046125', '9897999999', 'Sanjay Dhami',
      1, 2024, 0, 2027,
      'Tallital, Nainital, Uttarakhand', '1234-5678-9012', 'Sanjay Dhami', '2005-06-15', 'MALE', 'GENERAL', 1, 'verified'
    )
    ON DUPLICATE KEY UPDATE
      official_enrollment_no = '24011090008',
      ubter_roll_no = '24011090008',
      full_name = 'Girdhar Dhami',
      registration_no = '24101054',
      class_roll_no = 1,
      phone = '7453046125',
      parent_phone = '9897999999',
      parent_name = 'Sanjay Dhami',
      profile_completed = 1
  `);
  console.log('✓ Student 1: Girdhar Dhami (gdhami115@gmail.com, Roll 1, Enrollment 24011090008) configured');

  // Ensure student1@gmail.com also exists as alias or secondary test student
  const student1Exists = await query(`SELECT id FROM users WHERE email = 'student1@gmail.com'`);
  if (!student1Exists || student1Exists.length === 0) {
    const s1Res = await query(`
      INSERT INTO users (username, email, password_hash, status, must_change_password, phone)
      VALUES ('student1@gmail.com', 'student1@gmail.com', ?, 'ACTIVE', 0, '9897100001')
    `, [defaultPasswordHash]);
    const s1UserId = s1Res.insertId || s1Res.lastID;
    await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [s1UserId]);
    await query(`
      INSERT INTO students (user_id, official_enrollment_no, enrollment_no_status, full_name, registration_no, class_roll_no, phone, admission_year, graduation_year, profile_completed)
      VALUES (?, 'UBTER2024IT016', 'ASSIGNED', 'Student Demo One', 'UBTER2024IT016', 16, '9897100001', 2024, 2027, 1)
    `, [s1UserId]);
    console.log('✓ student1@gmail.com created as secondary test account');
  }

  // Ensure students 2 through 15 exist
  const studentNames = [
    'Aarav Joshi', 'Ananya Sharma', 'Aditya Rawat', 'Sneha Negi',
    'Rohan Bisht', 'Pooja Tiwari', 'Karan Mehra', 'Divya Pant',
    'Harsh Pandey', 'Megha Arya', 'Priyanshu Bhatt', 'Kavita Singh',
    'Abhishek Rana', 'Nisha Danu'
  ];

  for (let i = 2; i <= 15; i++) {
    const email = `student${i}@gmail.com`;
    const name = studentNames[i - 2] || `Student IT ${i}`;
    const roll = i;
    const enrollNo = `UBTER2024IT${String(i).padStart(3, '0')}`;
    const phone = `989710${String(i).padStart(4, '0')}`;

    let u = await query(`SELECT id FROM users WHERE email = ?`, [email]);
    let uId;
    if (!u || u.length === 0) {
      const res = await query(`
        INSERT INTO users (username, email, password_hash, status, must_change_password, phone)
        VALUES (?, ?, ?, 'ACTIVE', 0, ?)
      `, [email, email, defaultPasswordHash, phone]);
      uId = res.insertId || res.lastID;
      await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [uId]);
    } else {
      uId = u[0].id;
      await query(`UPDATE users SET password_hash = ?, status = 'ACTIVE' WHERE id = ?`, [defaultPasswordHash, uId]);
    }

    let s = await query(`SELECT id FROM students WHERE user_id = ?`, [uId]);
    if (!s || s.length === 0) {
      await query(`
        INSERT INTO students (id, user_id, official_enrollment_no, enrollment_no_status, full_name, registration_no, class_roll_no, phone, admission_year, graduation_year, profile_completed)
        VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, 2024, 2027, 1)
        ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), class_roll_no = VALUES(class_roll_no)
      `, [i, uId, enrollNo, name, enrollNo, roll, phone]);
    } else {
      await query(`
        UPDATE students 
        SET full_name = ?, class_roll_no = ?, official_enrollment_no = ?, profile_completed = 1 
        WHERE id = ?
      `, [name, roll, enrollNo, s[0].id]);
    }
  }
  console.log('✓ All 15 IT cohort students verified');

  // 7. Enrollments & Student Department Enrollments
  console.log('\n--- 7. Synchronizing Enrollments & Department Records ---');
  const allStudents = await query(`SELECT id, class_roll_no FROM students WHERE id <= 16`);
  for (const st of allStudents) {
    await query(`
      INSERT INTO enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, status)
      VALUES (?, 4, 1, 3, 5, ?, 'ENROLLED')
      ON DUPLICATE KEY UPDATE department_id = 4, year = 3, semester = 5, status = 'ENROLLED'
    `, [st.id, st.class_roll_no]);

    await query(`
      INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
      VALUES (?, 4, 1, 3, 5, ?, '2026-07-01', 'ACTIVE')
      ON DUPLICATE KEY UPDATE status = 'ACTIVE', department_id = 4, year = 3, semester = 5
    `, [st.id, st.class_roll_no]);
  }
  console.log(`✓ Synchronized enrollments for ${allStudents.length} students`);

  // 8. Teaching Groups
  console.log('\n--- 8. Ensuring Teaching Groups ---');
  const groups = [
    { id: 1, name: 'IT 3rd Year - Data Structures & Algorithms', subCode: 'IT-501', subName: 'Data Structures & Algorithms', teacherId: 8, invite: 'IT501TH', comp: 'THEORY' },
    { id: 2, name: 'IT 3rd Year - Database Management Systems', subCode: 'IT-502', subName: 'Database Management Systems', teacherId: 9, invite: 'IT502TH', comp: 'THEORY' },
    { id: 3, name: 'IT 3rd Year - Web Development Lab', subCode: 'IT-503', subName: 'Web Development Technologies', teacherId: 10, invite: 'IT503PR', comp: 'PRACTICAL' },
    { id: 4, name: 'IT 3rd Year - Computer Networks & Cloud', subCode: 'IT-504', subName: 'Computer Networks & Cloud Computing', teacherId: 2, invite: 'IT504TH', comp: 'THEORY' },
    { id: 5, name: 'Java Programming [IT506]', subCode: 'IT506', subName: 'Java Programming', teacherId: 2, invite: 'JAVA506', comp: 'THEORY' }
  ];

  for (const g of groups) {
    await query(`
      INSERT INTO teaching_groups (id, name, subject_name, subject_code, component, total_units, teacher_id, academic_year_id, department_id, semester, year, invite_code, status)
      VALUES (?, ?, ?, ?, ?, 5, ?, 1, 4, 5, 3, ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE name = VALUES(name), subject_name = VALUES(subject_name), subject_code = VALUES(subject_code), teacher_id = VALUES(teacher_id), department_id = 4, semester = 5, year = 3, status = 'ACTIVE'
    `, [g.id, g.name, g.subName, g.subCode, g.comp, g.teacherId, g.invite]);

    // Enroll all 15 students into this group
    for (const st of allStudents) {
      const exists = await query(`SELECT id FROM teaching_group_members WHERE group_id = ? AND student_id = ?`, [g.id, st.id]);
      if (!exists || exists.length === 0) {
        await query(`INSERT INTO teaching_group_members (group_id, student_id) VALUES (?, ?)`, [g.id, st.id]);
      }
    }
  }
  console.log(`✓ 5 Teaching Groups active and all students enrolled`);

  // 9. Timetable Slots
  console.log('\n--- 9. Seeding Timetable Slots (Monday - Saturday) ---');
  await query(`DELETE FROM timetable_slots WHERE department_id = 4 AND semester = 5`);

  // day_of_week: 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const timetable = [
    // Monday
    { day: 1, subId: 1, teacherId: 8, start: '09:00', end: '10:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 1, subId: 2, teacherId: 9, start: '10:00', end: '11:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 1, subId: 4, teacherId: 2, start: '11:15', end: '12:15', room: 'IT-CR-01', type: 'THEORY' },
    { day: 1, subId: 3, teacherId: 10, start: '13:00', end: '15:00', room: 'IT-Lab-1', type: 'PRACTICAL' },

    // Tuesday
    { day: 2, subId: 9, teacherId: 2, start: '09:00', end: '10:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 2, subId: 1, teacherId: 8, start: '10:00', end: '11:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 2, subId: 2, teacherId: 9, start: '11:15', end: '12:15', room: 'IT-CR-01', type: 'THEORY' },
    { day: 2, subId: 4, teacherId: 2, start: '13:00', end: '14:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 2, subId: 9, teacherId: 2, start: '14:00', end: '16:00', room: 'IT-Lab-2', type: 'PRACTICAL' },

    // Wednesday
    { day: 3, subId: 4, teacherId: 2, start: '09:00', end: '10:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 3, subId: 9, teacherId: 2, start: '10:00', end: '11:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 3, subId: 1, teacherId: 8, start: '11:15', end: '12:15', room: 'IT-CR-01', type: 'THEORY' },
    { day: 3, subId: 2, teacherId: 9, start: '13:00', end: '15:00', room: 'IT-Lab-1', type: 'PRACTICAL' },

    // Thursday
    { day: 4, subId: 2, teacherId: 9, start: '09:00', end: '10:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 4, subId: 4, teacherId: 2, start: '10:00', end: '11:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 4, subId: 3, teacherId: 10, start: '11:15', end: '12:15', room: 'IT-CR-01', type: 'THEORY' },
    { day: 4, subId: 1, teacherId: 8, start: '13:00', end: '15:00', room: 'IT-Lab-1', type: 'PRACTICAL' },

    // Friday
    { day: 5, subId: 9, teacherId: 2, start: '09:00', end: '10:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 5, subId: 3, teacherId: 10, start: '10:00', end: '11:00', room: 'IT-CR-01', type: 'THEORY' },
    { day: 5, subId: 1, teacherId: 8, start: '11:15', end: '12:15', room: 'IT-CR-01', type: 'THEORY' },
    { day: 5, subId: 4, teacherId: 2, start: '13:00', end: '14:30', room: 'IT-CR-01', type: 'THEORY' },

    // Saturday
    { day: 6, subId: 3, teacherId: 10, start: '09:30', end: '11:30', room: 'Seminar-Hall-A', type: 'THEORY' },
    { day: 6, subId: 9, teacherId: 2, start: '11:45', end: '13:00', room: 'IT-CR-01', type: 'THEORY' }
  ];

  for (const slot of timetable) {
    await query(`
      INSERT INTO timetable_slots (department_id, year, semester, academic_year_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, session_type, created_at, updated_at)
      VALUES (4, 3, 5, 1, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [slot.subId, slot.teacherId, slot.day, slot.start, slot.end, slot.room, slot.type]);
  }
  console.log(`✓ Seeded ${timetable.length} weekly timetable slots across Monday-Saturday`);

  // 10. Attendance Registers & Realistic Historical Attendance Sessions
  console.log('\n--- 10. Seeding Attendance Registers & Sessions ---');
  const registers = [
    { id: 1, teacherId: 8, subId: 1, grpId: 1, name: 'Data Structures & Algorithms (THEORY) — 2026-27', type: 'THEORY' },
    { id: 2, teacherId: 9, subId: 2, grpId: 2, name: 'Database Management Systems (THEORY) — 2026-27', type: 'THEORY' },
    { id: 3, teacherId: 10, subId: 3, grpId: 3, name: 'Web Development Technologies (PRACTICAL) — 2026-27', type: 'PRACTICAL' },
    { id: 4, teacherId: 2, subId: 4, grpId: 4, name: 'Computer Networks & Cloud Computing (THEORY) — 2026-27', type: 'THEORY' },
    { id: 5, teacherId: 2, subId: 9, grpId: 5, name: 'Java Programming (THEORY) — 2026-27', type: 'THEORY' }
  ];

  for (const reg of registers) {
    await query(`
      INSERT INTO attendance_registers (id, teacher_id, name, subject_id, group_id, department_id, year, semester, academic_year_id, session_type, is_active, is_official)
      VALUES (?, ?, ?, ?, ?, 4, 3, 5, 1, ?, 1, 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name), subject_id = VALUES(subject_id), group_id = VALUES(group_id), teacher_id = VALUES(teacher_id), is_active = 1
    `, [reg.id, reg.teacherId, reg.name, reg.subId, reg.grpId, reg.type]);
  }

  // Clear previous sessions for these registers to start fresh & realistic
  await query(`DELETE FROM register_attendance WHERE session_id IN (SELECT id FROM attendance_sessions WHERE register_id IN (1, 2, 3, 4, 5))`);
  await query(`DELETE FROM attendance_session_students WHERE session_id IN (SELECT id FROM attendance_sessions WHERE register_id IN (1, 2, 3, 4, 5))`);
  await query(`DELETE FROM attendance_sessions WHERE register_id IN (1, 2, 3, 4, 5)`);

  // Generate 7 finalized sessions for each subject over the last 3 weeks
  const today = new Date();
  let totalSessionsCreated = 0;

  for (const reg of registers) {
    for (let dayOffset = 21; dayOffset >= 2; dayOffset -= 3) {
      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() - dayOffset);
      const dateStr = sessionDate.toISOString().split('T')[0];
      const startTime = `${dateStr} 10:00:00`;
      const endTime = `${dateStr} 11:00:00`;
      const label = `${reg.name.split(' (')[0]} Lecture (${dateStr})`;

      const sRes = await query(`
        INSERT INTO attendance_sessions (register_id, session_date, start_time, end_time, session_type, state, label, finalized_by, finalized_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'FINALIZED', ?, ?, ?, ?, ?)
      `, [reg.id, dateStr, startTime, endTime, reg.type, label, reg.teacherId, endTime, startTime, endTime]);

      const sessionId = sRes.insertId || sRes.lastID;
      totalSessionsCreated++;

      // Mark attendance for all students
      for (const st of allStudents) {
        // Girdhar Dhami (student 1) gets 88% attendance: 1 absence every 8 sessions
        let status = 'PRESENT';
        let source = 'QR';
        if (st.id === 1) {
          if (dayOffset === 18 && reg.id === 1) status = 'ABSENT';
          else if (dayOffset === 9 && reg.id === 4) status = 'ABSENT';
          else if (dayOffset === 3 && reg.id === 2) status = 'LATE';
          else status = 'PRESENT';
        } else {
          // Other students: random realistic distribution
          const rand = (st.id * 17 + dayOffset * 13 + reg.id * 7) % 100;
          if (rand < 15) {
            status = 'ABSENT';
            source = 'MANUAL';
          } else if (rand < 25) {
            status = 'LATE';
            source = 'PIN';
          } else {
            status = 'PRESENT';
            source = rand % 2 === 0 ? 'QR' : 'BIOMETRIC';
          }
        }

        // Insert into attendance_session_students
        await query(`
          INSERT INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, attendance_status, included, marked_at, marked_by, source)
          VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?)
        `, [sessionId, st.id, st.class_roll_no, status, startTime, reg.teacherId, source]);

        // Insert into register_attendance
        await query(`
          INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, marked_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [sessionId, st.id, status, source, reg.teacherId, startTime]);
      }
    }

    // Also create 1 ACTIVE (LIVE) session for today with a valid PIN & QR token so faculty and students can test live taking!
    const todayStr = today.toISOString().split('T')[0];
    const livePin = String(1000 + (reg.id * 1111) % 9000);
    const liveQr = `VIDYA_ATTENDANCE_${reg.id}_${todayStr}_TOKEN`;

    const activeRes = await query(`
      INSERT INTO attendance_sessions (
        register_id, session_date, start_time, end_time, session_type, state, label,
        pin_code, qr_token, token_expires_at, created_at, updated_at
      ) VALUES (
        ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 4 HOUR), ?, 'ACTIVE', ?,
        ?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR), NOW(), NOW()
      )
    `, [reg.id, todayStr, reg.type, `${reg.name.split(' (')[0]} Live Session (Today)`, livePin, liveQr]);

    const activeSessionId = activeRes.insertId || activeRes.lastID;
    totalSessionsCreated++;

    // Add students to active session as well
    for (const st of allStudents) {
      await query(`
        INSERT INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, attendance_status, included, marked_by, source)
        VALUES (?, ?, 1, ?, 'ABSENT', 1, ?, 'MANUAL')
      `, [activeSessionId, st.id, st.class_roll_no, reg.teacherId]);
    }
  }
  console.log(`✓ Created ${totalSessionsCreated} attendance sessions (both finalized history and active live sessions with QR/PIN)`);

  // 11. Assessments & Submissions (Exams, Assignments, Practicals)
  console.log('\n--- 11. Seeding Assessments & Submissions ---');
  const uploadsDir = path.join(__dirname, '../uploads/submissions');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const assessmentsList = [
    { id: 1, title: 'Sessional Test 1: Data Structures & Trees', type: 'EXAM', maxMarks: 20, grpId: 1, teacherId: 8, subId: 1 },
    { id: 2, title: 'Class Test 1: Relational Algebra & SQL Normalization', type: 'EXAM', maxMarks: 20, grpId: 2, teacherId: 9, subId: 2 },
    { id: 3, title: 'Mid-Term Test: Computer Networks & Routing', type: 'EXAM', maxMarks: 20, grpId: 4, teacherId: 2, subId: 4 },
    { id: 4, title: 'Class Test 1: Core Java Fundamentals', type: 'EXAM', maxMarks: 20, grpId: 5, teacherId: 2, subId: 9 },

    { id: 5, title: 'Assignment 1: AVL Tree Balance Algorithms', type: 'ASSIGNMENT', maxMarks: 10, grpId: 1, teacherId: 8, subId: 1 },
    { id: 6, title: 'Assignment 1: Database Normalization (3NF & BCNF)', type: 'ASSIGNMENT', maxMarks: 10, grpId: 2, teacherId: 9, subId: 2 },
    { id: 7, title: 'Assignment 1: Java OOP Principles & Inheritance', type: 'ASSIGNMENT', maxMarks: 10, grpId: 5, teacherId: 2, subId: 9 },
    { id: 8, title: 'Assignment 2: Java Collections & Exception Handling', type: 'ASSIGNMENT', maxMarks: 10, grpId: 5, teacherId: 2, subId: 9 },

    { id: 9, title: 'Lab Practical 1: Responsive Web UI Layouts', type: 'PRACTICAL', maxMarks: 20, grpId: 3, teacherId: 10, subId: 3 },
    { id: 10, title: 'Lab Practical 1: Java Multithreading & Sockets', type: 'PRACTICAL', maxMarks: 20, grpId: 5, teacherId: 2, subId: 9 }
  ];

  for (const a of assessmentsList) {
    await query(`
      INSERT INTO assessments (id, group_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, title, type, max_marks, created_at, updated_at)
      VALUES (?, ?, ?, ?, 4, 3, 5, 1, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE title = VALUES(title), type = VALUES(type), max_marks = VALUES(max_marks), group_id = VALUES(group_id), teacher_id = VALUES(teacher_id)
    `, [a.id, a.grpId, a.teacherId, a.subId, a.title, a.type, a.maxMarks]);

    // Submissions for students
    for (const st of allStudents) {
      const filename = `sub_${a.id}_student_${st.id}.pdf`;
      const filePathOnDisk = path.join(uploadsDir, filename);
      if (!fs.existsSync(filePathOnDisk)) {
        fs.writeFileSync(filePathOnDisk, createDummyPdf(`VidyaOS Assessment: ${a.title} - Submitted by Student ID ${st.id} (Roll ${st.class_roll_no})`));
      }

      // Generate realistic scores
      let marks;
      let feedback = 'Good performance. Keep it up!';
      if (st.id === 1) {
        // Girdhar Dhami top scores
        marks = a.maxMarks === 10 ? 9.5 : (a.maxMarks === 20 ? 19.0 : 47.0);
        feedback = 'Outstanding submission. Accurate reasoning, clean execution, and complete documentation.';
      } else {
        const factor = 0.65 + ((st.id * 3 + a.id * 7) % 30) / 100.0;
        marks = Math.round(a.maxMarks * factor * 2) / 2; // e.g. 14.5, 17.0
      }

      await query(`
        INSERT INTO assessment_submissions (assessment_id, student_id, file_path, original_filename, marks_obtained, status, submitted_at, graded_at, graded_by, feedback)
        VALUES (?, ?, ?, ?, ?, 'GRADED', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), ?, ?)
        ON DUPLICATE KEY UPDATE marks_obtained = VALUES(marks_obtained), status = 'GRADED', feedback = VALUES(feedback), file_path = VALUES(file_path)
      `, [a.id, st.id, `/uploads/submissions/${filename}`, filename, marks, a.teacherId, feedback]);
    }
  }
  console.log(`✓ Seeded ${assessmentsList.length} assessments and graded submissions for all students`);

  // 12. Leave Applications
  console.log('\n--- 12. Seeding Leave Applications ---');
  await query(`DELETE FROM leave_applications`);
  const leaves = [
    {
      studentId: 1, // Girdhar Dhami
      startDate: '2026-11-08',
      endDate: '2026-11-09',
      reason: 'Suffered from high viral fever; attended clinic in Nainital. Doctor advised 2 days physical rest.',
      status: 'APPROVED',
      reviewedBy: 2,
      reviewNotes: 'Medical certificate reviewed. Leave approved.'
    },
    {
      studentId: 1, // Girdhar Dhami
      startDate: '2026-11-28',
      endDate: '2026-11-30',
      reason: 'Representing college at State Technical Symposium & Hackathon 2026.',
      status: 'PENDING',
      reviewedBy: null,
      reviewNotes: null
    },
    {
      studentId: 3, // Ananya Sharma
      startDate: '2026-11-12',
      endDate: '2026-11-14',
      reason: 'Attending elder sister marriage ceremony in Dehradun.',
      status: 'APPROVED',
      reviewedBy: 2,
      reviewNotes: 'Wedding invitation verified. Leave sanctioned.'
    },
    {
      studentId: 6, // Rohan Bisht
      startDate: '2026-11-25',
      endDate: '2026-11-26',
      reason: 'Urgent family emergency requiring out-of-town travel.',
      status: 'PENDING',
      reviewedBy: null,
      reviewNotes: null
    }
  ];

  for (const l of leaves) {
    await query(`
      INSERT INTO leave_applications (student_id, start_date, end_date, reason, status, reviewed_by, reviewed_at, review_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ${l.status === 'APPROVED' ? 'NOW()' : 'NULL'}, ?, DATE_SUB(NOW(), INTERVAL 2 DAY))
    `, [l.studentId, l.startDate, l.endDate, l.reason, l.status, l.reviewedBy, l.reviewNotes]);
  }
  console.log(`✓ Seeded ${leaves.length} leave applications (both pending and approved)`);

  // 13. Classroom Posts & Comments
  console.log('\n--- 13. Seeding Classroom Posts & Community Discussions ---');
  await query(`DELETE FROM classroom_post_comments`);
  await query(`DELETE FROM classroom_posts`);

  const posts = [
    {
      groupId: 1,
      authorId: 8,
      content: 'Welcome to Odd Semester 2026-27 for Data Structures & Algorithms! The complete Unit 1 to 5 syllabus, textbook references, and lecture presentation notes have been uploaded to Coursework.',
      type: 'ANNOUNCEMENT'
    },
    {
      groupId: 1,
      authorId: 8,
      content: 'Reminder: Class Test 1 on AVL Trees, Binary Heaps and amortized graph analysis will take place next Tuesday. Please review the practice problem set.',
      type: 'ANNOUNCEMENT'
    },
    {
      groupId: 2,
      authorId: 9,
      content: 'All students are requested to finish ER-to-Relational mapping exercises before Wednesday laboratory. We will be executing live SQL DDL scripts in Oracle/MySQL.',
      type: 'ANNOUNCEMENT'
    },
    {
      groupId: 4,
      authorId: 2,
      content: 'Computer Networks Packet Tracer configuration files for Subnetting and OSPF routing are now shared in course materials.',
      type: 'ANNOUNCEMENT'
    },
    {
      groupId: 5,
      authorId: 2,
      content: 'Java Programming Multithreading assignment has been evaluated. Review your feedback in your marksheets.',
      type: 'ANNOUNCEMENT'
    }
  ];

  for (const p of posts) {
    const res = await query(`
      INSERT INTO classroom_posts (group_id, author_id, content, post_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 3 DAY), NOW())
    `, [p.groupId, p.authorId, p.content, p.type]);

    const postId = res.insertId || res.lastID;

    // Add discussion comments
    await query(`
      INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
      VALUES 
        (?, 11, 'Thank you Sir! Will the test also cover Red-Black tree deletion cases?', DATE_SUB(NOW(), INTERVAL 2 DAY)),
        (?, 8, 'Deletion cases are optional reading for extra credit, but rotation proofs will be asked.', DATE_SUB(NOW(), INTERVAL 1 DAY))
    `, [postId, postId]);
  }
  console.log(`✓ Seeded ${posts.length} classroom announcements and discussions`);

  // 14. Hardware Devices (ESP32 Terminals) & IoT Events
  console.log('\n--- 14. Seeding ESP32 Terminals & IoT Attendance Events ---');
  await query(`DELETE FROM iot_attendance_events`);
  
  const devices = [
    {
      id: 1,
      uuid: 'ESP32_IT_LAB_01',
      name: 'IT Advanced Software Lab Entrance Terminal',
      deptId: 4,
      battery: 96,
      rssi: -52,
      ip: '192.168.1.101',
      templates: 45
    },
    {
      id: 2,
      uuid: 'ESP32_MAIN_GATE',
      name: 'Government Polytechnic Academic Block Turnstile',
      deptId: 4,
      battery: 88,
      rssi: -62,
      ip: '192.168.1.102',
      templates: 120
    },
    {
      id: 3,
      uuid: 'ESP32_SEMINAR_01',
      name: 'Auditorium & Seminar Hall Attendance Station',
      deptId: 4,
      battery: 94,
      rssi: -56,
      ip: '192.168.1.103',
      templates: 65
    }
  ];

  for (const d of devices) {
    const apiKeyHash = `secret_token_${d.uuid.toLowerCase()}`;
    await query(`
      INSERT INTO devices (
        id, device_uuid, device_name, department_id, device_type, api_key_hash, status, is_active,
        battery_pct, wifi_rssi, ip_address, as608_enrolled_count, last_heartbeat, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 'TERMINAL', ?, 'ACTIVE', 1,
        ?, ?, ?, ?, NOW(), NOW(), NOW()
      )
      ON DUPLICATE KEY UPDATE
        device_name = VALUES(device_name), status = 'ACTIVE', is_active = 1,
        battery_pct = VALUES(battery_pct), wifi_rssi = VALUES(wifi_rssi),
        ip_address = VALUES(ip_address), as608_enrolled_count = VALUES(as608_enrolled_count),
        last_heartbeat = NOW()
    `, [d.id, d.uuid, d.name, d.deptId, apiKeyHash, d.battery, d.rssi, d.ip, d.templates]);

    // Insert live scan events for today
    await query(`
      INSERT INTO iot_attendance_events (student_id, device_id, department_id, scan_time, scan_date, verification_status, event_type, raw_payload)
      VALUES 
        (1, ?, 4, NOW(), CURDATE(), 'SUCCESS', 'FINGERPRINT', '{"finger_id": 1, "confidence": 98}'),
        (2, ?, 4, DATE_SUB(NOW(), INTERVAL 5 MINUTE), CURDATE(), 'SUCCESS', 'FINGERPRINT', '{"finger_id": 2, "confidence": 94}'),
        (3, ?, 4, DATE_SUB(NOW(), INTERVAL 10 MINUTE), CURDATE(), 'SUCCESS', 'CARD', '{"card_uid": "A1B2C3D4"}')
    `, [d.id, d.id, d.id]);
  }
  console.log(`✓ Seeded ${devices.length} ESP32 terminals with telemetry and live IoT scans`);

  // 15. Course Files (NBA Accreditation)
  console.log('\n--- 15. Seeding NBA Course Files & Documents ---');
  for (const g of groups) {
    const cfRes = await query(`
      INSERT INTO course_files (
        teaching_group_id, subject_id, teacher_id, department_id, academic_year_id, semester, status, hod_remarks, audited_at, audited_by, created_at, updated_at
      ) VALUES (
        ?, (SELECT id FROM subjects WHERE code = ? LIMIT 1), ?, 4, 1, 5, 'APPROVED', 'Complete and fully adheres to NBA Tier-II documentation criteria.', NOW(), 2, NOW(), NOW()
      )
      ON DUPLICATE KEY UPDATE status = 'APPROVED', hod_remarks = VALUES(hod_remarks)
    `, [g.id, g.subCode, g.teacherId]);

    const cfId = cfRes.insertId || cfRes.lastID || g.id;

    await query(`
      INSERT INTO course_file_documents (course_file_id, item_key, title, file_path, file_name, file_size, mime_type, status, version, uploaded_by, verified_by, verified_at)
      VALUES 
        (?, 'SYLLABUS', 'Approved Board Syllabus Scheme', '/uploads/course_files/syllabus.pdf', 'syllabus.pdf', 245000, 'application/pdf', 'APPROVED', 1, ?, 2, NOW()),
        (?, 'CO_PO_MAPPING', 'Course Outcome and Program Outcome Matrix', '/uploads/course_files/copo.pdf', 'copo.pdf', 180000, 'application/pdf', 'APPROVED', 1, ?, 2, NOW())
      ON DUPLICATE KEY UPDATE status = 'APPROVED'
    `, [cfId, g.teacherId, cfId, g.teacherId]);
  }
  console.log('✓ Seeded NBA Course Files & verification documents');

  // 16. Notifications
  console.log('\n--- 16. Seeding Comprehensive Notifications ---');
  await query(`DELETE FROM notifications`);
  const notifs = [
    // Girdhar Dhami (Student)
    { userId: 11, type: 'ACADEMIC', title: 'Odd Semester 2026-27 Active', msg: 'You are enrolled in 5 active courses in Information Technology (Semester 5).', url: '/student/dashboard/dashboard.html' },
    { userId: 11, type: 'ATTENDANCE', title: 'Monthly Attendance Update', msg: 'Your attendance is 88.5% across all subjects. Excellent consistency!', url: '/student/attendance/attendance.html' },
    { userId: 11, type: 'ASSIGNMENT', title: 'Marks Published: Java Programming', msg: 'Dr. Ramesh Chandra graded your Java Multithreading Practical: 19.5/20.', url: '/student/scores/scores.html' },
    { userId: 11, type: 'TIMETABLE', title: 'Timetable Published', msg: 'Your weekly lecture and laboratory schedule is live.', url: '/student/timetable/timetable.html' },

    // Faculty & HOD
    { userId: 2, type: 'DEPARTMENT', title: 'HOD Overview: All Registers Active', msg: 'All 5 IT teaching registers and 3 ESP32 biometric terminals are operational.', url: '/faculty/registers.html' },
    { userId: 2, type: 'LEAVE', title: 'Student Leave Application Submitted', msg: 'Girdhar Dhami submitted a leave request for State Hackathon 2026.', url: '/faculty/leaves/index.html' },
    { userId: 8, type: 'ATTENDANCE', title: 'Live Attendance Session Ready', msg: 'Today live attendance session is active with PIN & QR verification.', url: '/faculty/registers.html' },

    // Admin
    { userId: 1, type: 'SYSTEM', title: 'System Health Optimal', msg: 'Campus database, terminals, and web portals are synchronized and online.', url: '/admin/dashboard/index.html' }
  ];

  for (const n of notifs) {
    await query(`
      INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, DATE_SUB(NOW(), INTERVAL 1 HOUR))
    `, [n.userId, n.type, n.title, n.msg, n.url]);
  }
  console.log(`✓ Seeded ${notifs.length} notifications`);

  console.log('\n======================================================');
  console.log('🎉 LOCAL DATABASE SEEDING COMPLETED SUCCESSFULLY! 🎉');
  console.log('======================================================\n');
  console.log('Ready for phone & desktop testing across all roles:');
  console.log('1. STUDENT (Girdhar Dhami):');
  console.log('   - Email: gdhami115@gmail.com (or student1@gmail.com)');
  console.log('   - UBTER Roll No: 24011090008');
  console.log('   - Phone: 7453046125');
  console.log('   - Password: Password@123 (or girdhartdhami)');
  console.log('2. HOD & FACULTY (Dr. Ramesh Chandra):');
  console.log('   - Email: hod@gmail.com');
  console.log('   - Password: Password@123');
  console.log('3. FACULTY (Er. Amit Verma):');
  console.log('   - Email: teacher1@gmail.com');
  console.log('   - Password: Password@123');
  console.log('4. SYSTEM ADMIN:');
  console.log('   - Email: admin@gmail.com');
  console.log('   - Password: Password@123');
  console.log('======================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ SEEDING FAILED:', err);
  process.exit(1);
});
