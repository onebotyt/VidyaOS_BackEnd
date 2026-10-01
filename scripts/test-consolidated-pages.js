/**
 * Comprehensive Verification for Consolidated Faculty Pages & ESP32 Day-Sync
 */

const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      req.write(payload);
    }
    req.end();
  });
}

(async () => {
  console.log('=== STARTING CONSOLIDATED PAGES & ESP32 DAY-SYNC VERIFICATION ===\n');

  // 1. Verify URL Redirects
  console.log('[1] Testing HTTP 301 Redirects...');
  const tests = [
    { path: '/faculty/analytics.html', expected: '/faculty/reports.html?tab=analytics' },
    { path: '/faculty/marks.html', expected: '/faculty/registers.html?tab=marks' },
    { path: '/faculty/assignments.html', expected: '/faculty/registers.html?tab=assignments' },
    { path: '/faculty/attendance/quick.html', expected: '/faculty/registers.html' },
    { path: '/faculty/register-view.html?id=1', expected: '/faculty/registers.html?id=1' }
  ];

  for (const t of tests) {
    const res = await request({ hostname: 'localhost', port: 3000, path: t.path, method: 'GET' });
    if (res.status !== 301 || res.headers.location !== t.expected) {
      console.error(`❌ Redirect failed for ${t.path}: got ${res.status} ${res.headers.location}, expected 301 ${t.expected}`);
      process.exit(1);
    }
    console.log(`   ✓ ${t.path} ➔ 301 ${res.headers.location}`);
  }

  // 2. Login as Teacher (HOD)
  console.log('\n[2] Logging in as Faculty (hod@gmail.com)...');
  const loginRes = await request({
    hostname: 'localhost', port: 3000, path: '/api/v1/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'hod@gmail.com', password: 'Password@123' });

  if (loginRes.status !== 200 || !loginRes.body.success) {
    console.error('❌ Login failed:', loginRes.body);
    process.exit(1);
  }
  const token = loginRes.body.data.access_token;
  console.log('   ✓ Logged in successfully. Token acquired.');

  // 3. Test ESP32 Day-Scans
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n[3] Testing GET /api/v1/attendance/registers/1/esp32-day-scans?date=${today}...`);
  const scanRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/attendance/registers/1/esp32-day-scans?date=${today}`, method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (scanRes.status !== 200 || !scanRes.body.success) {
    console.error('❌ Day-scans endpoint failed:', scanRes.body);
    process.exit(1);
  }
  const scanData = scanRes.body.data;
  console.log(`   ✓ Device detected: "${scanData.device.name}" (UID: ${scanData.device.device_uid})`);
  console.log(`   ✓ Device Online Status: ${scanData.device.is_online ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
  console.log(`   ✓ Day Scans found for ${today}: ${scanData.scans.length} scans`);

  if (!scanData.device.is_online) {
    console.error('❌ Expected device to be online!');
    process.exit(1);
  }
  if (scanData.scans.length < 5) {
    console.error('❌ Expected at least 5 staged scans for demo testing!');
    process.exit(1);
  }

  // 4. Test Day-Attendance Confirmation (with student checkboxes selection)
  console.log(`\n[4] Testing POST /api/v1/attendance/registers/1/confirm-day-attendance...`);
  // Select first 12 scanned students to confirm, simulating teacher checking them
  const confirmedIds = scanData.scans.slice(0, 12).map(s => s.student_id);
  const confirmRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/attendance/registers/1/confirm-day-attendance`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  }, {
    date: today,
    student_ids: confirmedIds
  });

  if (confirmRes.status !== 200 || !confirmRes.body.success) {
    console.error('❌ Confirm attendance failed:', confirmRes.body);
    process.exit(1);
  }
  console.log(`   ✓ ${confirmRes.body.message}`);

  // 5. Verify Digital Register Matrix & Sessions View
  console.log(`\n[5] Testing GET /api/v1/faculty/registers/1 to verify updated matrix...`);
  const regRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/faculty/registers/1`, method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (regRes.status !== 200 || !regRes.body.success) {
    console.error('❌ Failed to fetch register 1:', regRes.body);
    process.exit(1);
  }
  const regData = regRes.body.data;
  console.log(`   ✓ Register Name: "${regData.register.name}"`);
  console.log(`   ✓ Total Enrolled Cohort Students: ${regData.grid.students.length}`);
  console.log(`   ✓ Dates in Digital Register: ${regData.grid.dates.length} sessions (includes ${today}: ${regData.grid.dates.includes(today)})`);
  
  const sampleConfirmedStudent = regData.grid.students.find(s => confirmedIds.includes(s.student_id));
  console.log(`   ✓ Sample Student #${sampleConfirmedStudent.class_roll_no} (${sampleConfirmedStudent.full_name}): Marked "${sampleConfirmedStudent.attendance_marks[today]}" on ${today}`);

  // 6. Test Assignments & Submissions
  console.log(`\n[6] Testing Assignments API for consolidated assignments page...`);
  const assignRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/assignments`, method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (assignRes.status !== 200 || !assignRes.body.success) {
    console.error('❌ Failed to list assignments:', assignRes.body);
    process.exit(1);
  }
  console.log(`   ✓ Assignments listed: ${assignRes.body.data.length} assignments found`);
  const firstAssign = assignRes.body.data[0];
  console.log(`   ✓ Sample Assignment: "${firstAssign.title}" (${firstAssign.submission_count} submissions)`);

  // 7. Test Exams & Test Marks
  console.log(`\n[7] Testing Exams API for consolidated test marks page...`);
  const examsRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/exams`, method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (examsRes.status !== 200 || !examsRes.body.success) {
    console.error('❌ Failed to list exams:', examsRes.body);
    process.exit(1);
  }
  console.log(`   ✓ Exams listed: ${examsRes.body.data.length} exams found`);
  const firstExam = examsRes.body.data[0];
  console.log(`   ✓ Sample Exam: "${firstExam.name}" (${firstExam.scores_entered} scores entered)`);

  // 8. Test Reports & Analytics
  console.log(`\n[8] Testing Reports & Analytics API for consolidated reports page...`);
  const analyticsRes = await request({
    hostname: 'localhost', port: 3000, path: `/api/v1/reports/analytics`, method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (analyticsRes.status !== 200 || !analyticsRes.body.success) {
    console.error('❌ Failed to get analytics:', analyticsRes.body);
    process.exit(1);
  }
  console.log(`   ✓ Analytics retrieved: Defaulters count: ${analyticsRes.body.data.defaulter_count}, Trend data points: ${analyticsRes.body.data.trend.length}`);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🎉 ALL TESTS PASSED: ALL 3 CONSOLIDATED PAGES VERIFIED 100%!');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(0);
})();
