const http = require('http');
const fs = require('fs');
const path = require('path');

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (body) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${message}`);
}

async function runTests() {
  console.log('=== VERIFYING PHYSICAL LECTURE REGISTER (ENGLISH ONLY) ===\n');

  // Test 1: Check for zero Devanagari / Hindi characters in files
  console.log('[1] Checking files for absence of Hindi/Devanagari text...');
  const devanagariRegex = /[\u0900-\u097F]/;

  const regHtmlPath = path.join(__dirname, '../../frontend/faculty/registers.html');
  const regHtml = fs.readFileSync(regHtmlPath, 'utf8');
  assert(!devanagariRegex.test(regHtml), 'registers.html contains NO Devanagari / Hindi text (100% English)');
  assert(regHtml.includes('LECTURE REGISTER'), 'registers.html contains English book title "LECTURE REGISTER"');
  assert(regHtml.includes('DATES OF LECTURE'), 'registers.html contains English header "DATES OF LECTURE"');
  assert(regHtml.includes('LECTURES ATTENDED'), 'registers.html contains English header "LECTURES ATTENDED"');
  assert(regHtml.includes('LECTURES ABSENT'), 'registers.html contains English header "LECTURES ABSENT"');
  assert(regHtml.includes('DAILY PRESENT (P)'), 'registers.html contains English footer "DAILY PRESENT (P)"');
  assert(regHtml.includes('DAILY ABSENT (A)'), 'registers.html contains English footer "DAILY ABSENT (A)"');

  const facultyRoutePath = path.join(__dirname, '../src/routes/faculty.js');
  const facultyRoute = fs.readFileSync(facultyRoutePath, 'utf8');
  assert(!devanagariRegex.test(facultyRoute), 'faculty.js contains NO Devanagari / Hindi text');

  const cssPath = path.join(__dirname, '../../frontend/shared/css/components.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  assert(!devanagariRegex.test(cssContent), 'components.css contains NO Devanagari / Hindi text');

  // Test 2: Authenticate faculty
  console.log('\n[2] Authenticating faculty teacher...');
  const loginRes = await request('http://localhost:3000/api/v1/auth/faculty/login', {
    method: 'POST'
  }, {
    email: 'admin@gmail.com',
    password: 'password123'
  });

  assert(loginRes.status === 200 && loginRes.body.success, 'Faculty login succeeded');
  const token = loginRes.body.data.access_token;
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // Test 3: Query register detail with month parameter (August 2026)
  console.log('\n[3] Testing GET /api/v1/faculty/registers/1?month=2026-08...');
  const augRes = await request('http://localhost:3000/api/v1/faculty/registers/1?month=2026-08', {
    headers: authHeaders
  });

  if (augRes.status !== 200) {
    console.error('Error response:', augRes.status, augRes.body);
  }
  assert(augRes.status === 200, 'August 2026 register returned status 200');
  const grid = augRes.body.data.grid;
  assert(grid.month === '2026-08', 'Grid month is 2026-08');
  assert(Array.isArray(grid.month_days), 'grid.month_days is an array');
  assert(grid.month_days.length === 31, 'August 2026 has 31 days in month_days');

  // Verify non-instructional holiday detection in English
  const day15 = grid.month_days.find(d => d.day === 15);
  assert(day15 && day15.holiday_label === 'INDEPENDENCE DAY', 'August 15 detected as English holiday "INDEPENDENCE DAY"');

  const day8 = grid.month_days.find(d => d.day === 8);
  assert(day8 && day8.is_second_saturday && day8.holiday_label === 'SECOND SATURDAY', 'August 8 detected as "SECOND SATURDAY"');

  const sundays = grid.month_days.filter(d => d.is_sunday);
  assert(sundays.length >= 4 && sundays.every(s => s.holiday_label === 'SUNDAY'), 'Sundays detected with English label "SUNDAY"');

  // Test 4: Verify student cumulative metrics
  console.log('\n[4] Verifying statutory cumulative calculations for students...');
  assert(grid.students && grid.students.length > 0, 'Students array is populated');
  const student1 = grid.students[0];
  assert(typeof student1.month_attended === 'number', 'student1.month_attended is a number');
  assert(typeof student1.prev_attended === 'number', 'student1.prev_attended is a number');
  assert(typeof student1.total_attended === 'number', 'student1.total_attended is a number');
  assert(typeof student1.month_absent === 'number', 'student1.month_absent is a number');
  assert(typeof student1.percentage === 'number', 'student1.percentage is a number');

  // Test 5: In-cell digital pen mark update
  console.log('\n[5] Testing PUT /api/v1/faculty/registers/1/mark-cell...');
  const testDate = '2026-08-10';
  const markRes = await request('http://localhost:3000/api/v1/faculty/registers/1/mark-cell', {
    method: 'PUT',
    headers: authHeaders
  }, {
    date: testDate,
    student_id: student1.student_id,
    status: 'PRESENT'
  });

  assert(markRes.status === 200 && markRes.body.success, 'mark-cell to PRESENT returned 200 success');
  console.log('markRes.body.data:', markRes.body.data);
  assert(markRes.body.data.attendance_status === 'PRESENT' || markRes.body.data.status === 'PRESENT', 'Attendance status confirmed PRESENT');
  assert(markRes.body.data.daily_totals && typeof markRes.body.data.daily_totals.present === 'number', 'Daily totals updated and returned');

  // Test 6: Student status update (Transferred / Enrolled)
  console.log('\n[6] Testing PUT /api/v1/faculty/registers/1/student-status...');
  const statusRes = await request('http://localhost:3000/api/v1/faculty/registers/1/student-status', {
    method: 'PUT',
    headers: authHeaders
  }, {
    student_id: student1.student_id,
    status: 'TRANSFERRED'
  });
  assert(statusRes.status === 200 && statusRes.body.success, 'Set student status to TRANSFERRED succeeded');

  // Revert student status back to ENROLLED
  const revertRes = await request('http://localhost:3000/api/v1/faculty/registers/1/student-status', {
    method: 'PUT',
    headers: authHeaders
  }, {
    student_id: student1.student_id,
    status: 'ENROLLED'
  });
  assert(revertRes.status === 200 && revertRes.body.success, 'Revert student status to ENROLLED succeeded');

  console.log('\n🎉 ALL PHYSICAL LECTURE REGISTER (100% ENGLISH) TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
