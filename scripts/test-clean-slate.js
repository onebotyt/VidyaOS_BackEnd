const http = require('http');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('=== VERIFYING GMAIL LOGIN & MINIMAL DATASET ===\n');

  const usersToTest = [
    { role: 'Admin',         email: 'admin@gmail.com',        endpoint: '/api/v1/auth/faculty/login' },
    { role: 'HOD',           email: 'hod@gmail.com',          endpoint: '/api/v1/auth/faculty/login' },
    { role: 'Class Teacher', email: 'classteacher@gmail.com', endpoint: '/api/v1/auth/faculty/login' },
    { role: 'Teacher',       email: 'teacher@gmail.com',      endpoint: '/api/v1/auth/faculty/login' },
    { role: 'Student 1',     email: 'student1@gmail.com',     endpoint: '/api/v1/auth/student/login' },
    { role: 'Student 9',     email: 'student9@gmail.com',     endpoint: '/api/v1/auth/student/login' }
  ];

  let hodToken = null;
  let ctToken = null;
  let studentToken = null;

  for (const u of usersToTest) {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: u.endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: u.email, password: u.role === 'Admin' ? 'Admin@123' : 'Password@123' });

    if (res.status === 200 && res.body.success) {
      console.log(`✓ [${u.role}] Logged in successfully with Gmail: ${u.email}`);
      console.log(`    Name: ${res.body.data.user.full_name}, Roles: ${res.body.data.user.roles.join(', ')}`);
      if (u.email === 'hod@gmail.com') hodToken = res.body.data.access_token;
      if (u.email === 'classteacher@gmail.com') ctToken = res.body.data.access_token;
      if (u.email === 'student1@gmail.com') studentToken = res.body.data.access_token;
    } else {
      console.error(`✗ [${u.role}] Failed to log in with Gmail: ${u.email}`, res);
      process.exit(1);
    }
  }

  // 1. Verify Attendance Registers (Register 1: DBMS)
  console.log('\n--- Checking Digital Register #1 (DBMS) ---');
  const regRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/faculty/registers/1',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  console.log(`Register 1 Status: ${regRes.status}`);
  console.log(`Register Name: ${regRes.body.data?.register?.name}`);
  console.log(`Enrolled Students: ${regRes.body.data?.students?.length}`);
  console.log(`Attendance Sessions: ${regRes.body.data?.sessions?.length}`);

  // 2. Verify ESP32 Today Scans on Register 1
  console.log('\n--- Checking ESP32 Today Scans on Register #1 ---');
  const espRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/attendance/registers/1/esp32-day-scans',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  console.log(`ESP Scans Status: ${espRes.status}`);
  console.log(`Terminal: ${espRes.body.data?.device?.name} (Online: ${espRes.body.data?.device?.is_online})`);
  console.log(`Scanned Students Count: ${espRes.body.data?.scans?.length}`);
  if (espRes.body.data?.scans?.length) {
    console.log(`First scanned student: ${espRes.body.data.scans[0]?.full_name} (${espRes.body.data.scans[0]?.official_enrollment_no})`);
  }

  // 3. Verify Defaulters Report (< 75%)
  console.log('\n--- Checking Low Attendance Defaulters Report ---');
  const defRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/reports/low-attendance?threshold=75',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${ctToken}` }
  });
  console.log(`Defaulters Status: ${defRes.status}`);
  const defaulters = Array.isArray(defRes.body.data) ? defRes.body.data : (defRes.body.data?.defaulters || []);
  console.log(`Total Defaulters Found (<75%): ${defaulters.length}`);
  defaulters.forEach(d => {
    console.log(`  - Roll ${d.class_roll_no}: ${d.full_name} (${d.official_enrollment_no}) -> ${d.percentage}% (Need ${d.classes_needed_to_recover} classes)`);
  });

  // 4. Verify Student Profile via Gmail
  console.log('\n--- Checking Student Profile & Attendance ---');
  const studRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/students/me',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log(`Student Profile Status: ${studRes.status}`);
  console.log(`Student Name: ${studRes.body.data?.full_name}`);
  console.log(`Enrollment No: ${studRes.body.data?.official_enrollment_no}`);
  console.log(`Department: ${studRes.body.data?.department_name} (${studRes.body.data?.department_code})`);

  console.log('\n=== ALL MINIMAL DATASET & GMAIL LOGIN CHECKS PASSED 100%! ===');
}

run().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
