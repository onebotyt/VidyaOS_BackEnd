const http = require('http');
const fs = require('fs');
const path = require('path');

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
  console.log('=== STARTING HOD SETTINGS & NAVIGATION SUITE ===\n');

  // 1. Authenticate HOD
  const hodToken = await login('hod@gmail.com', 'Password@123');
  console.log('✔ HOD login successful');

  // 2. Test GET /api/v1/hod/settings
  const getRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/settings',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });

  if (getRes.status !== 200 || !getRes.json?.success) {
    throw new Error(`GET /api/v1/hod/settings failed: ${getRes.status} ${getRes.body}`);
  }
  const settingsData = getRes.json.data;
  console.log('✔ GET /api/v1/hod/settings returned 200:', {
    department: settingsData.department_name,
    duration_years: settingsData.degree_duration_years,
    active_term: settingsData.active_term,
    defaulter_threshold: settingsData.defaulter_threshold_percent,
    teachers_count: settingsData.teachers_count,
    students_count: settingsData.students_count,
    terminals_count: settingsData.terminals_count
  });

  if (typeof settingsData.teachers_count !== 'number' || typeof settingsData.terminals_count !== 'number') {
    throw new Error('Resource counts missing from settings payload');
  }

  // 3. Test PUT /api/v1/hod/settings with duration max 3 years validation
  const invalidPut = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/settings',
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, {
    degree_duration_years: 4
  });
  if (invalidPut.status === 200) {
    throw new Error('Expected validation failure when setting degree duration to 4 years (max 3)');
  }
  console.log('✔ Degree duration validation successfully rejected 4 years (capped to max 3 years)');

  const putRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/settings',
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, {
    degree_duration_years: 3,
    attendance_defaulter_threshold_percent: 78
  });

  if (putRes.status !== 200 || !putRes.json?.success) {
    throw new Error(`PUT /api/v1/hod/settings failed: ${putRes.status} ${putRes.body}`);
  }
  console.log('✔ PUT /api/v1/hod/settings updated policies successfully with 3 years duration');

  // 4. Test RBAC: Non-HOD teacher should get 403
  const teacherToken = await login('teacher@gmail.com', 'Password@123');
  const teacherGet = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/settings',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  if (teacherGet.status !== 403) {
    throw new Error(`Expected 403 for non-HOD teacher on /settings, got ${teacherGet.status}`);
  }
  console.log('✔ RBAC verified: Regular teacher receives 403 Forbidden');

  // 5. Test Redirects: /faculty/settings.html -> /faculty/hod-settings.html
  const redirRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/faculty/settings.html',
    method: 'GET'
  });
  if (redirRes.status !== 301 || redirRes.headers.location !== '/faculty/hod-settings.html') {
    throw new Error(`Redirect /faculty/settings.html failed: status=${redirRes.status}, location=${redirRes.headers.location}`);
  }
  console.log('✔ Redirect verified: /faculty/settings.html -> 301 to /faculty/hod-settings.html');

  // 6. Test Frontend files for Settings in navigation
  const frontendDir = path.join(__dirname, '../../frontend');
  
  // A. Check auth.js
  const authJs = fs.readFileSync(path.join(frontendDir, 'js/auth.js'), 'utf8');
  if (!authJs.includes('/faculty/hod-settings.html') || (!authJs.includes('Department Settings') && !authJs.includes('Dept Settings'))) {
    throw new Error('auth.js does not have Department Settings in HOD navItems!');
  }
  console.log('✔ auth.js has Department Settings in hamburger navigation menu');

  // B. Check HOD subpages
  const requiredPages = [
    'faculty/hod-settings.html',
    'faculty/hod-teachers.html',
    'faculty/hod-subjects.html',
    'faculty/hod-students.html',
    'faculty/hod-archive.html',
    'faculty/hod-devices.html',
    'faculty/hod-reports.html',
    'faculty/dashboard.html'
  ];

  for (const page of requiredPages) {
    const fullPath = path.join(frontendDir, page);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Page missing: ${page}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes('/faculty/hod-settings.html')) {
      throw new Error(`${page} does NOT have a link to /faculty/hod-settings.html!`);
    }
  }
  // C. Verify hod-settings.html specific constraints
  const settingsHtml = fs.readFileSync(path.join(frontendDir, 'faculty/hod-settings.html'), 'utf8');
  if (settingsHtml.includes('setting-term') || settingsHtml.includes('Active Session Term')) {
    throw new Error('hod-settings.html still contains Active Session Term elements!');
  }
  if (settingsHtml.includes('value="4"') || settingsHtml.includes('value="5"') || settingsHtml.includes('value="6"')) {
    throw new Error('hod-settings.html still contains duration options beyond 3 years!');
  }
  console.log('✔ hod-settings.html: Active Term removed and duration capped at 3 years');

  // D. Verify hod-subjects.html specific constraints
  const subjectsHtml = fs.readFileSync(path.join(frontendDir, 'faculty/hod-subjects.html'), 'utf8');
  if (subjectsHtml.includes('Degree Program Duration') || subjectsHtml.includes('duration-modal') || subjectsHtml.includes('Change Degree Duration')) {
    throw new Error('hod-subjects.html still contains Degree Program Duration banner or modal!');
  }
  console.log('✔ hod-subjects.html: Degree Program Duration banner and modal cleanly removed');

  // E. Verify hod-students.html specific constraints & API normalization
  const studentsHtml = fs.readFileSync(path.join(frontendDir, 'faculty/hod-students.html'), 'utf8');
  if (studentsHtml.includes('Department Program Scope') || studentsHtml.includes('Active Academic Session')) {
    throw new Error('hod-students.html still contains Department Program Scope or Active Academic Session banner!');
  }
  if (studentsHtml.includes("const API = '/api/v1/hod';")) {
    throw new Error("hod-students.html still has const API = '/api/v1/hod', causing duplicated /api/v1 prefix!");
  }
  console.log('✔ hod-students.html: Program Scope banner removed and API prefix fixed to /hod');

  // Test /api/v1/hod/students
  const stdRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/students',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  if (stdRes.status !== 200) {
    throw new Error(`GET /api/v1/hod/students failed with status ${stdRes.status}`);
  }
  console.log('✔ GET /api/v1/hod/students returns 200 OK');

  // Test duplicated prefix resilience /api/v1/api/v1/hod/students
  const stdDupRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/api/v1/hod/students',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  if (stdDupRes.status !== 200) {
    throw new Error(`GET /api/v1/api/v1/hod/students failed with status ${stdDupRes.status}`);
  }
  console.log('✔ Server middleware normalized duplicated /api/v1/api/v1/ prefix to 200 OK');

  console.log('\n=== ALL HOD SETTINGS & NAVIGATION TESTS PASSED! ===');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
