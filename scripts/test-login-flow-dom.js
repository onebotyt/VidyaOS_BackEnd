const http = require('http');
const fs = require('fs');
const path = require('path');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

async function run() {
  console.log('=== VERIFYING LOGIN RESOLUTION & FLOWS ===\n');

  // 1. Verify URL redirects (Unified Login Portal)
  console.log('[1] Verifying Login URL Aliases & 301 Redirects...');
  const r1 = await get('/login');
  assert(r1.status === 301 && r1.headers.location === '/login/index.html', 'GET /login -> 301 /login/index.html');

  const r2 = await get('/login.html');
  assert(r2.status === 301 && r2.headers.location === '/login/index.html', 'GET /login.html -> 301 /login/index.html');

  const r3 = await get('/faculty/login');
  assert(r3.status === 301 && r3.headers.location === '/login/index.html', 'GET /faculty/login -> 301 /login/index.html');

  const r4 = await get('/student/login');
  assert(r4.status === 301 && r4.headers.location === '/login/index.html', 'GET /student/login -> 301 /login/index.html');

  const r5 = await get('/student/login.html');
  assert(r5.status === 301 && r5.headers.location === '/login/index.html', 'GET /student/login.html -> 301 /login/index.html');

  // 2. Verify script tags in login pages
  console.log('\n[2] Verifying frontend script inclusions...');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login/index.html'), 'utf8');
  assert(indexHtml.includes('<script src="/js/ui.js"></script>'), 'index.html includes /js/ui.js');
  assert(indexHtml.includes('<script src="/js/api.js"></script>'), 'index.html includes /js/api.js');
  assert(indexHtml.includes('<script src="/js/auth.js'), 'index.html includes /js/auth.js');

  const facultyHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login/faculty.html'), 'utf8');
  assert(facultyHtml.includes('<script src="/js/ui.js"></script>'), 'faculty.html includes /js/ui.js');
  assert(facultyHtml.includes('<script src="/js/api.js"></script>'), 'faculty.html includes /js/api.js');
  assert(facultyHtml.includes('<script src="/js/auth.js'), 'faculty.html includes /js/auth.js');

  const studentHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login/student.html'), 'utf8');
  assert(studentHtml.includes('<script src="/js/ui.js"></script>'), 'student.html includes /js/ui.js');
  assert(studentHtml.includes('<script src="/js/api.js"></script>'), 'student.html includes /js/api.js');
  assert(studentHtml.includes('<script src="/js/auth.js'), 'student.html includes /js/auth.js');

  // 3. Verify auth.js has showToast fallback
  const authJs = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/auth.js'), 'utf8');
  assert(authJs.includes('window.showToast'), 'auth.js includes window.showToast fallback');

  // 4. Test API Logins: Admin with Admin@123, Faculty with Password@123
  console.log('\n[3] Testing backend authentication for all roles...');
  const testUsers = [
    { role: 'Admin', email: 'admin@gmail.com', pass: 'Admin@123', expectedUrl: '/admin/dashboard.html' },
    { role: 'HOD', email: 'hod@gmail.com', pass: 'Password@123', expectedUrl: '/faculty/dashboard.html' },
    { role: 'Class Teacher', email: 'classteacher@gmail.com', pass: 'Password@123', expectedUrl: '/faculty/dashboard.html' },
    { role: 'Teacher', email: 'teacher@gmail.com', pass: 'Password@123', expectedUrl: '/faculty/dashboard.html' },
  ];

  for (const u of testUsers) {
    const res = await post('/api/v1/auth/faculty/login', { email: u.email, password: u.pass, force_logout: true, device_id: 'test_dev_' + Date.now() + Math.random() });
    assert(res.status === 200 && res.body.success, `${u.role} (${u.email}) login succeeded with "${u.pass}"`);
    assert(res.body.data && res.body.data.access_token, `Access token generated for ${u.email}`);
    assert(res.body.data.user && res.body.data.user.roles.length > 0, `User roles populated for ${u.email}`);
  }

  // Verify Admin CANNOT log in with Password@123
  const badAdminRes = await post('/api/v1/auth/faculty/login', { email: 'admin@gmail.com', password: 'Password@123' });
  assert(badAdminRes.status === 401 && !badAdminRes.body.success, 'Admin cannot log in with Password@123 (strictly blocked)');

  // Test Student Login
  const studentRes = await post('/api/v1/auth/student/login', { email: 'student1@gmail.com', password: 'Password@123', force_logout: true, device_id: 'test_dev_stud_' + Date.now() });
  assert(studentRes.status === 200 && studentRes.body.success, 'Student login succeeded with "Password@123"');
  assert(studentRes.body.data.access_token, 'Student access token returned');

  console.log('\n🎉 ALL LOGIN VERIFICATIONS PASSED SUCCESSFULLY!\n');
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
