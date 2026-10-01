const fs = require('fs');
const path = require('path');
const http = require('http');
const { query } = require('../src/config/db');
const {
  Admin,
  Faculty,
  Student,
  Attendance,
  DigitalRegister,
  AcademicStructure
} = require('../src/entities');
const excelExportService = require('../src/services/excelExportService');

console.log('======================================================');
console.log('🧪 AUTOMATED TEST: DOMAIN ENTITIES & UBTER IDENTIFIERS');
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

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function login(email, password) {
  const res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: email, password });
  return res.data?.data?.access_token || res.data?.data?.token;
}

async function runTests() {
  try {
    // ──────────────────────────────────────────────────────────
    // 1. CANONICAL DOMAIN ENTITIES TEST
    // ──────────────────────────────────────────────────────────
    console.log('1. Testing Domain Entities Layer...');

    // 1.1 Admin entity
    const admin = new Admin({ id: 1, email: 'admin@college.edu', role: 'ADMIN', name: 'Super Admin' });
    assert(admin.isSuperAdmin(), 'Admin.isSuperAdmin() returns true for ADMIN role');
    assert(admin.hasPermission('departments.archive'), 'Admin has departments.archive permission');

    // 1.2 Faculty entity
    const faculty = new Faculty({
      id: 10,
      user_id: 10,
      name: 'Dr. Rajesh Sharma',
      email: 'hod@gmail.com',
      assignments: [
        { assignment_type: 'HOD', department_code: 'IT', department_id: 4 },
        { assignment_type: 'CLASS_TEACHER', department_code: 'IT', department_id: 4, year: 3, semester: 5 }
      ]
    });
    assert(faculty.isHOD(), 'Faculty.isHOD() returns true when assigned HOD');
    assert(faculty.isClassTeacher(), 'Faculty.isClassTeacher() returns true when assigned CLASS_TEACHER');
    assert(faculty.canManageCohort(4, 3, 5), 'Faculty can manage cohort IT Year 3 Sem 5');

    // 1.3 Student entity with UBTER Identifiers
    const student = new Student({
      id: 101,
      user_id: 201,
      full_name: 'Aarav Patel',
      official_enrollment_no: '2024IT001',
      registration_no: '24101054001',
      class_roll_no: 1,
      department_id: 4,
      department_code: 'IT',
      year: 3,
      semester: 5,
      total_attended: 18,
      total_classes: 20
    });
    assert(student.classRollNo === 1, 'Student entity preserves classRollNo (1)');
    assert(student.registrationNo === '24101054001', 'Student entity preserves UBTER registrationNo (24101054001)');
    assert(student.enrollmentNo === '2024IT001', 'Student entity preserves official enrollmentNo (2024IT001)');
    assert(student.formatIdentifierString().includes('Roll: 1'), 'Student formatIdentifierString includes Roll');
    assert(student.formatIdentifierString().includes('Reg: 24101054001'), 'Student formatIdentifierString includes UBTER Reg');
    assert(student.getAttendancePercentage() === 90, 'Student attendance percentage calculated accurately (90%)');
    assert(student.isExamEligible() === true, 'Student with 90% is exam eligible (>= 75%)');

    // 1.4 Attendance Entity & Session Lifecycle
    const attSession = new Attendance({
      id: 50,
      register_id: 1,
      subject_id: 1,
      teacher_id: 2,
      session_date: '2026-09-20',
      status: 'OPEN'
    });
    assert(attSession.canStudentCheckIn(), 'Attendance session in OPEN state allows check-in');
    attSession.closeSession();
    assert(attSession.status === 'CLOSED', 'Attendance session closeSession() transitions to CLOSED');
    attSession.finalizeSession();
    assert(attSession.status === 'FINALIZED', 'Attendance session finalizeSession() transitions to FINALIZED');

    // 1.5 DigitalRegister Entity & Uttarakhand 50-mark scheme
    const reg = new DigitalRegister({
      id: 1,
      subject_code: 'IT501',
      subject_name: 'Database Management Systems',
      department_id: 4,
      year: 3,
      semester: 5
    });
    const evalScore = reg.computeStudentEvaluation({
      assignmentAvg15: 14.5,
      unitTestAvg20: 18.0,
      attendanceScore10: 9.0,
      presentationScore5: 4.5
    });
    assert(evalScore.totalMarks50 === 46.0, 'DigitalRegister computes Uttarakhand 50-mark evaluation (46/50)');
    assert(evalScore.isPassing === true, 'DigitalRegister 46/50 is passing');

    // 1.6 AcademicStructure Entity
    assert(AcademicStructure.isStandardDepartment('IT'), 'AcademicStructure identifies IT as standard department');
    assert(AcademicStructure.isStandardDepartment('PHARM'), 'AcademicStructure identifies PHARM as standard department');
    assert(!AcademicStructure.isStandardDepartment('CSE'), 'AcademicStructure verifies CSE is purged / not standard');

    // ──────────────────────────────────────────────────────────
    // 2. DATABASE PERSISTENCE & COLUMN VERIFICATION
    // ──────────────────────────────────────────────────────────
    console.log('\n2. Verifying SQLite Database Schema & Records...');
    const tableInfo = await query('PRAGMA table_info(students)');
    const colNames = (tableInfo || []).map(c => c.name);
    assert(colNames.includes('registration_no'), 'students table contains registration_no column');
    assert(colNames.includes('class_roll_no'), 'students table contains class_roll_no column');
    assert(colNames.includes('official_enrollment_no'), 'students table contains official_enrollment_no column');

    // Verify demo students populated with UBTER registration numbers
    const demoStudents = await query('SELECT id, full_name, class_roll_no, registration_no, official_enrollment_no FROM students WHERE official_enrollment_no = ?', ['2024IT001']);
    assert(demoStudents && demoStudents.length > 0, 'Found demo student 2024IT001 in database');
    if (demoStudents && demoStudents.length > 0) {
      const s1 = demoStudents[0];
      assert(s1.class_roll_no === 1, `Demo student has class_roll_no = 1 (actual: ${s1.class_roll_no})`);
      assert(s1.registration_no === '24101054001', `Demo student has UBTER registration_no = 24101054001 (actual: ${s1.registration_no})`);
      assert(s1.official_enrollment_no === '2024IT001', `Demo student has official_enrollment_no = 2024IT001`);
    }

    // ──────────────────────────────────────────────────────────
    // 3. API ENDPOINTS INTEGRATION TEST
    // ──────────────────────────────────────────────────────────
    console.log('\n3. Testing REST API Endpoints with UBTER Identifiers...');

    // 3.1 Student /me API
    const studentToken = await login('student1@gmail.com', 'Password@123');
    assert(studentToken, 'Student 1 logged in successfully');
    const meRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/students/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(meRes.status === 200, 'GET /students/me returned 200 OK');
    assert(meRes.data.data.registration_no === '24101054001', 'GET /students/me returned registration_no (24101054001)');
    assert(meRes.data.data.class_roll_no === 1, 'GET /students/me returned class_roll_no (1)');
    assert(meRes.data.data.official_enrollment_no === '2024IT001', 'GET /students/me returned official_enrollment_no (2024IT001)');

    // 3.2 Exam Roster API
    const hodToken = await login('hod@gmail.com', 'Password@123');
    assert(hodToken, 'HOD (Instructor of Register 1 & Exam 2) logged in successfully');
    const examRosterRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/exams/2/roster',
      method: 'GET',
      headers: { Authorization: `Bearer ${hodToken}` }
    });
    assert(examRosterRes.status === 200, 'GET /exams/2/roster returned 200 OK');
    const firstStudent = examRosterRes.data.data?.roster?.[0];
    assert(firstStudent !== undefined, 'Exam roster contains student records');
    if (firstStudent) {
      assert(firstStudent.registration_no !== undefined, 'Exam roster student includes registration_no field');
      assert(firstStudent.class_roll_no !== undefined, 'Exam roster student includes class_roll_no field');
      assert(firstStudent.official_enrollment_no !== undefined, 'Exam roster student includes official_enrollment_no field');
    }

    // 3.3 Internal Evaluation API
    const evalRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/faculty/registers/1/internal-evaluation',
      method: 'GET',
      headers: { Authorization: `Bearer ${hodToken}` }
    });
    assert(evalRes.status === 200, 'GET /faculty/registers/1/internal-evaluation returned 200 OK');
    const evalRoster = evalRes.data.data?.roster;
    assert(Array.isArray(evalRoster) && evalRoster.length > 0, 'Internal evaluation sheet returned roster array');
    if (evalRoster && evalRoster.length > 0) {
      assert(evalRoster[0].registration_no === '24101054001', 'Internal evaluation sheet roster has UBTER registration_no (24101054001)');
      assert(evalRoster[0].class_roll_no === 1, 'Internal evaluation sheet roster has class_roll_no (1)');
    }

    // ──────────────────────────────────────────────────────────
    // 4. STUDENT SELF-REGISTRATION & APPROVAL LIFECYCLE
    // ──────────────────────────────────────────────────────────
    console.log('\n4. Testing Student Self-Registration with UBTER Number & Approval Flow...');

    // Open registration for IT Y3 S5 cohort if needed
    const classTeacherToken = await login('classteacher@gmail.com', 'Password@123');
    assert(classTeacherToken, 'Class teacher logged in successfully');

    await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/faculty/cohorts/registration-toggle',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${classTeacherToken}`
      }
    }, {
      department_id: 4,
      branch_id: 4,
      year: 3,
      semester: 5,
      open: true
    });

    const testTimestamp = Date.now().toString().slice(-4);
    const testEnroll = `2024TEST${testTimestamp}`;
    const testReg = `24101054999`;
    const testEmail = `test.student${testTimestamp}@gmail.com`;

    // Send and verify OTP
    const sendOtpRes = await request({
      hostname: 'localhost', port: 3000,
      path: '/api/v1/auth/otp/send', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { identifier: testEmail, purpose: 'REGISTRATION' });
    const otpCode = sendOtpRes.data?.data?.debug_otp;
    const verifyOtpRes = await request({
      hostname: 'localhost', port: 3000,
      path: '/api/v1/auth/otp/verify', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { identifier: testEmail, otp_code: otpCode, purpose: 'REGISTRATION' });
    const otpVerificationToken = verifyOtpRes.data?.data?.verification_token;

    // Self-register
    const regPostRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      full_name: `Test UBTER Student ${testTimestamp}`,
      official_enrollment_no: testEnroll,
      registration_no: testReg,
      email: testEmail,
      password: 'Password@123',
      otp_verification_token: otpVerificationToken,
      department_id: 4,
      branch_id: 4,
      year: 3,
      semester: 5
    });
    assert(regPostRes.status === 201, 'POST /auth/student/register with UBTER reg_no returned 201 Created');

    // Class Teacher views pending queue
    const pendingRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/students/registrations/pending?department_id=4&branch_id=4&year=3&semester=5',
      method: 'GET',
      headers: { Authorization: `Bearer ${classTeacherToken}` }
    });
    assert(pendingRes.status === 200, 'GET /students/registrations/pending returned 200 OK');
    const pendingStudent = pendingRes.data.data?.find(s => s.official_enrollment_no === testEnroll);
    assert(pendingStudent !== undefined, 'Pending registrations list contains newly registered student');
    assert(pendingStudent?.registration_no === testReg, `Pending student has UBTER registration_no = ${testReg}`);

    // Class Teacher approves student with class_roll_no 99
    if (pendingStudent) {
      const approveRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/students/registrations/${pendingStudent.student_id}/adjudicate`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${classTeacherToken}`
        }
      }, {
        action: 'APPROVE',
        class_roll_no: 99
      });
      assert(approveRes.status === 200, 'POST adjudicate APPROVE returned 200 OK');

      // Verify student in database
      const dbRows = await query('SELECT s.class_roll_no, s.registration_no, s.official_enrollment_no, e.class_roll_no as enrol_roll FROM students s JOIN enrollments e ON s.id = e.student_id WHERE s.official_enrollment_no = ?', [testEnroll]);
      const dbRow = dbRows?.[0];
      assert(dbRow !== undefined, 'Approved student row exists in database');
      assert(dbRow?.registration_no === testReg, `Approved student registration_no is ${testReg} in DB`);
      assert(dbRow?.class_roll_no === 99, `Approved student class_roll_no is 99 in students table`);
      assert(dbRow?.enrol_roll === 99, `Approved student class_roll_no is 99 in enrollments table`);

      // Clean up test student
      await query('DELETE FROM enrollments WHERE student_id = ?', [pendingStudent.student_id]);
      await query('DELETE FROM students WHERE id = ?', [pendingStudent.student_id]);
      await query('DELETE FROM users WHERE id = ?', [pendingStudent.user_id]);
      console.log('✓ Cleaned up ephemeral test registration.');
    }

    // ──────────────────────────────────────────────────────────
    // 5. EXCEL WORKBOOK COLUMNS VALIDATION
    // ──────────────────────────────────────────────────────────
    console.log('\n5. Verifying Native Excel Workbook Export Mapping...');
    const buffer = await excelExportService.generateInternalEvaluationExcel(1);
    assert(Buffer.isBuffer(buffer) && buffer.length > 5000, `Internal Evaluation Excel workbook generated (${buffer.length} bytes)`);

  } catch (err) {
    console.error('Test execution exception:', err);
    failCount++;
  }

  console.log('\n======================================================');
  console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('======================================================\n');
  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
