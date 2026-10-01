const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function login(email, password) {
  const res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/auth/faculty/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email, password });
  const token = res.json?.data?.access_token || res.json?.data?.token;
  if (res.status !== 200 || !token) {
    throw new Error(`Login failed for ${email}: ${res.body}`);
  }
  return token;
}

async function run() {
  console.log('=== STARTING ADD STUDENT DYNAMIC YEAR TEST ===\n');

  // 1. Authenticate HOD
  const hodToken = await login('hod@gmail.com', 'Password@123');
  console.log('✔ HOD login successful');

  // 2. Fetch hierarchy to verify academicYears & degree_duration_years
  const hierRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/hierarchy',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });

  if (hierRes.status !== 200 || !hierRes.json?.success) {
    throw new Error(`GET hierarchy failed: ${hierRes.status} ${hierRes.body}`);
  }

  const { academicYears, degree_duration_years } = hierRes.json.data;
  console.log(`✔ Hierarchy returned ${academicYears?.length} academic year(s) from database:`, academicYears);
  console.log(`✔ Degree duration from database: ${degree_duration_years} Years`);

  if (!academicYears || !academicYears.length) {
    throw new Error('No academic years returned in hierarchy payload');
  }

  const activeAy = academicYears.find(ay => ay.is_current) || academicYears[0];
  const testEnrollmentNo = '2026CSE999';

  // 3. Add student with academic_year_id from database
  const addRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/students',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, {
    official_enrollment_no: testEnrollmentNo,
    full_name: 'Test Dynamic Student',
    email: 'test.dynamic@gmail.com',
    academic_year_id: activeAy.id,
    year: 1,
    semester: 1,
    is_lateral_entry: false
  });

  if (addRes.status !== 201 || !addRes.json?.success) {
    throw new Error(`Add student failed: ${addRes.status} ${addRes.body}`);
  }

  console.log('✔ Add student with database academic_year_id returned 201 Created:');
  console.log('  Data:', addRes.json.data);

  // 4. Clean up test student from DB
  const { query } = require('../src/config/db');
  await query('DELETE FROM enrollments WHERE student_id = ?', [addRes.json.data.student_id]);
  await query('DELETE FROM students WHERE id = ?', [addRes.json.data.student_id]);
  await query('DELETE FROM users WHERE username = ?', [testEnrollmentNo]);
  console.log('✔ Test student cleaned up successfully from database.');

  console.log('\n=== ALL DYNAMIC YEAR TESTS PASSED! ===');
}

run().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
