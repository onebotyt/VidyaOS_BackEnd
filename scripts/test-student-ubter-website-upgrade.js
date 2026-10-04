const fs = require('fs');
const path = require('path');
const http = require('http');
const { query } = require('../src/config/db');

console.log('======================================================');
console.log('🧪 AUTOMATED TEST: WEBSITE UPGRADE FOR UBTER SCHEME');
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

async function runTests() {
  try {
    // ─────────────────────────────────────────────────────────
    // 1. STUDENT LOGIN BY UBTER REGISTRATION NUMBER
    // ─────────────────────────────────────────────────────────
    console.log('1. Testing Student Login Multi-Identifier Resolution...');
    
    // Login by UBTER Registration Number (24101054001)
    const ubterLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      enrollment_no: '24101054001',
      password: 'Password@123',
      force_logout: true,
      device_id: 'ubter_test_dev'
    });

    assert(ubterLoginRes.status === 200, 'Student login by UBTER Registration Number (24101054001) returned 200 OK');
    assert(ubterLoginRes.data && ubterLoginRes.data.success, 'Student login payload has success: true');
    const studentUser = ubterLoginRes.data?.data?.user;
    assert(studentUser && studentUser.registration_no === '24101054001', `Student user payload contains registration_no = 24101054001 (actual: ${studentUser?.registration_no})`);
    assert(studentUser && Number(studentUser.class_roll_no) === 1, `Student user payload contains class_roll_no = 1 (actual: ${studentUser?.class_roll_no})`);
    assert(studentUser && studentUser.official_enrollment_no === '2024IT001', `Student user payload contains official_enrollment_no = 2024IT001 (actual: ${studentUser?.official_enrollment_no})`);

    // Login by Enrollment Number (2024IT001)
    const enrollLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      enrollment_no: '2024IT001',
      password: 'Password@123',
      force_logout: true,
      device_id: 'ubter_test_dev'
    });
    assert(enrollLoginRes.status === 200, 'Student login by Board Enrollment Number (2024IT001) returned 200 OK');
    assert(enrollLoginRes.data?.data?.user?.registration_no === '24101054001', 'Enrollment login returns registration_no');

    // Login by Email (student1@gmail.com)
    const emailLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      email: 'student1@gmail.com',
      password: 'Password@123',
      force_logout: true,
      device_id: 'ubter_test_dev'
    });
    assert(emailLoginRes.status === 200, 'Student login by Gmail (student1@gmail.com) returned 200 OK');

    // ─────────────────────────────────────────────────────────
    // 2. ADMIN STUDENT ROSTER & SEARCH
    // ─────────────────────────────────────────────────────────
    console.log('\n2. Testing Admin Student Roster & UBTER Search...');
    const adminLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      email: 'admin',
      password: 'Admin@123',
      force_logout: true,
      device_id: 'ubter_admin_dev'
    });
    assert(adminLoginRes.status === 200, 'Admin logged in successfully');
    const adminToken = adminLoginRes.data?.data?.access_token;

    // Get Admin roster
    const rosterRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/admin/students/roster?limit=10',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(rosterRes.status === 200, 'GET /admin/students/roster returned 200 OK');
    const studentsList = rosterRes.data?.data?.students || [];
    assert(studentsList.length > 0, `Admin roster returned student records (${studentsList.length} found)`);
    const demoStudent = studentsList.find(s => s.official_enrollment_no === '2024IT001');
    assert(demoStudent && demoStudent.registration_no === '24101054001', 'Admin roster student contains registration_no');
    assert(demoStudent && Number(demoStudent.class_roll_no) === 1, 'Admin roster student contains class_roll_no');

    // Search roster by UBTER Reg No
    const searchRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/admin/students/roster?search=24101054001',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'GET /admin/students/roster?search=24101054001 returned 200 OK');
    const searchResults = searchRes.data?.data?.students || [];
    assert(searchResults.length === 1 && searchResults[0].official_enrollment_no === '2024IT001', 'Search by UBTER Reg No accurately returned matching student');

    // ─────────────────────────────────────────────────────────
    // 3. HOD STUDENTS ROSTER
    // ─────────────────────────────────────────────────────────
    console.log('\n3. Testing HOD Students Endpoint...');
    const hodLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      email: 'hod@gmail.com',
      password: 'Password@123'
    });
    assert(hodLoginRes.status === 200, 'HOD logged in successfully');
    const hodToken = hodLoginRes.data?.data?.access_token;

    const hodStudentsRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/hod/students',
      method: 'GET',
      headers: { Authorization: `Bearer ${hodToken}` }
    });
    assert(hodStudentsRes.status === 200, 'GET /hod/students returned 200 OK');
    const hodList = hodStudentsRes.data?.data || [];
    assert(hodList.length > 0, `HOD students returned records (${hodList.length} found)`);
    const hodStudent1 = hodList.find(s => s.official_enrollment_no === '2024IT001');
    assert(hodStudent1 && hodStudent1.full_name && hodStudent1.full_name.trim().length > 0, `HOD student record has full_name (actual: "${hodStudent1?.full_name}")`);
    assert(hodStudent1 && hodStudent1.registration_no === '24101054001', 'HOD student record has registration_no');
    assert(hodStudent1 && Number(hodStudent1.class_roll_no) === 1, 'HOD student record has class_roll_no');

    // ─────────────────────────────────────────────────────────
    // 4. FRONTEND DOM & THEME TOKEN INTEGRITY
    // ─────────────────────────────────────────────────────────
    console.log('\n4. Verifying Frontend DOM & Presentation Standards...');
    
    // Check admin/students.html
    const adminHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin/students.html'), 'utf8');
    assert(adminHtml.includes('UBTER Reg No'), 'admin/students.html table has UBTER Reg No column header');
    assert(!adminHtml.includes('#${s.class_roll_no}'), 'admin/students.html has clean roll numbers without # prefix');
    const adminHexMatches = adminHtml.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert(adminHexMatches.length === 0, `admin/students.html has zero hardcoded hex colors (found: ${adminHexMatches.length})`);

    // Check login/student.html
    const loginHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login/student.html'), 'utf8');
    assert(loginHtml.includes('UBTER Reg No'), 'login/student.html mentions UBTER Reg No in label/subtitles');
    assert(loginHtml.includes('type="text"'), 'login/student.html input type is text (supports email, enrollment, reg no)');

    // Check student/dashboard.html
    const dashHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/dashboard.html'), 'utf8');
    assert(!dashHtml.includes('Class Roll #${s.class_roll_no}'), 'dashboard.html roll badge has no # prefix');
    assert(dashHtml.includes('UBTER Reg:'), 'dashboard.html header badge displays UBTER Reg No');

    // Check student/profile.html
    const profHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/profile.html'), 'utf8');
    assert(!profHtml.includes('Roll #${s.class_roll_no'), 'profile.html hero roll badge has no # prefix');
    assert(profHtml.includes('hero-reg-badge'), 'profile.html hero badges include hero-reg-badge');

    // Check student/scores.html
    const scoresHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/scores.html'), 'utf8');
    assert(scoresHtml.includes('scores-roll-no'), 'scores.html includes student identity card with roll no');
    assert(scoresHtml.includes('scores-reg-no'), 'scores.html includes student identity card with UBTER reg no');
    const scoresHexMatches = scoresHtml.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert(scoresHexMatches.length === 0, `scores.html has zero hardcoded hex colors (found: ${scoresHexMatches.length})`);

    // Check student/attendance.html
    const attHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/attendance.html'), 'utf8');
    assert(attHtml.includes('student-identity-badge'), 'attendance.html page header includes student-identity-badge');

    // Check faculty/registers.html
    const regHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/registers.html'), 'utf8');
    assert(regHtml.includes('s.registration_no || s.official_enrollment_no'), 'registers.html evaluation sheet renders UBTER registration_no in REG NO column');

    console.log('\n======================================================');
    console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
    console.log('======================================================\n');

    process.exit(failCount === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
