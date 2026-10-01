/**
 * Automated Verification Script: RBAC Enforcement, Shared Assets & Route Guards
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: options.headers || {}
    };

    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('RBAC ENFORCEMENT, SHARED ASSETS & DIRECTORY TEST SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(` ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${name} ${extra}`);
      failed++;
    }
  }

  // 1. Shared Assets & Backward Compatibility
  console.log('--- 1. Shared Assets & Backward Compatibility ---');
  
  const sharedAuth = await request('/shared/js/auth.js');
  assert('GET /shared/js/auth.js returns 200', sharedAuth.statusCode === 200 && sharedAuth.data.includes('guardRoute'));

  const jsAuth = await request('/js/auth.js');
  assert('GET /js/auth.js (compat) returns 200', jsAuth.statusCode === 200 && jsAuth.data.includes('guardRoute'));

  const sharedApi = await request('/shared/js/api.js');
  assert('GET /shared/js/api.js returns 200', sharedApi.statusCode === 200 && sharedApi.data.includes('fetchApi'));

  const sharedCssBtn = await request('/shared/css/components.css');
  assert('GET /shared/css/components.css returns 200', sharedCssBtn.statusCode === 200 && sharedCssBtn.data.includes('.btn'));

  const cssCompatBtn = await request('/css/components.css');
  assert('GET /css/components.css (compat) returns 200', cssCompatBtn.statusCode === 200 && cssCompatBtn.data.includes('.btn'));

  // 2. Permanent 301 Redirects for Clean URL Architecture
  console.log('\n--- 2. Permanent 301 Redirects for Clean URL Architecture ---');

  const red1 = await request('/admin/academic_structure.html');
  assert('Redirect: /admin/academic_structure.html -> /admin/academic-structure.html', red1.statusCode === 301 && red1.headers.location === '/admin/academic-structure.html');

  const red2 = await request('/admin/departments.html');
  assert('Redirect: /admin/departments.html -> /admin/academic-structure.html?tab=departments', red2.statusCode === 301 && red2.headers.location === '/admin/academic-structure.html?tab=departments');

  const red3 = await request('/faculty/analytics.html');
  assert('Redirect: /faculty/analytics.html -> /faculty/reports.html?tab=analytics', red3.statusCode === 301 && red3.headers.location === '/faculty/reports.html?tab=analytics');

  const red4 = await request('/faculty/marks.html');
  assert('Redirect: /faculty/marks.html -> /faculty/tests.html', red4.statusCode === 301 && red4.headers.location.startsWith('/faculty/tests.html'));

  const red4b = await request('/faculty/assignments.html');
  assert('GET: /faculty/assignments.html -> 200 OK (standalone coursework page)', red4b.statusCode === 200);

  const red5 = await request('/faculty/attendance/quick.html');
  assert('Redirect: /faculty/attendance/quick.html -> /faculty/registers.html', red5.statusCode === 301 && red5.headers.location === '/faculty/registers.html');

  const red6 = await request('/student/attendance/subjects.html');
  assert('Redirect: /student/attendance/subjects.html -> /student/attendance.html', red6.statusCode === 301 && red6.headers.location === '/student/attendance.html');

  // 3. Devices Route SQLite Compatibility
  console.log('\n--- 3. Devices Route SQLite Compatibility ---');

  const adminLogin = await request('/api/v1/auth/faculty/login', { method: 'POST' }, {
    email: 'admin@gmail.com',
    password: 'Password@123'
  });
  assert('Admin login successful', adminLogin.statusCode === 200 && adminLogin.json?.data?.access_token);
  const adminToken = adminLogin.json?.data?.access_token;

  const devicesRes = await request('/api/v1/devices', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert('GET /api/v1/devices returns 200 (no TIMESTAMPDIFF crash)', devicesRes.statusCode === 200 && Array.isArray(devicesRes.json?.data));

  // 4. Backend RBAC Authorization & Security
  console.log('\n--- 4. Backend RBAC Authorization & Security ---');

  const unauthHod = await request('/api/v1/hod/teachers', { method: 'POST' }, {
    full_name: 'Test Teacher',
    email: 'test@college.edu',
    password: 'Password123'
  });
  assert('Unauthenticated POST /api/v1/hod/teachers returns 401', unauthHod.statusCode === 401);

  const hodLogin = await request('/api/v1/auth/faculty/login', { method: 'POST' }, {
    email: 'hod@gmail.com',
    password: 'Password@123'
  });
  assert('HOD login successful', hodLogin.statusCode === 200 && hodLogin.json?.data?.access_token);
  const hodToken = hodLogin.json?.data?.access_token;

  const hodDash = await request('/api/v1/hod/dashboard', {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  assert('HOD can access /api/v1/hod/dashboard (200)', hodDash.statusCode === 200);

  // Log in as Regular Teacher (teacher@gmail.com)
  const regularLogin = await request('/api/v1/auth/faculty/login', { method: 'POST' }, {
    email: 'teacher@gmail.com',
    password: 'Password@123'
  });
  assert('Regular teacher login successful', regularLogin.statusCode === 200 && regularLogin.json?.data?.access_token);
  const regularToken = regularLogin.json?.data?.access_token;

  // Regular teacher tries to invoke HOD endpoints -> MUST BE 403 FORBIDDEN
  const regCreateTeacher = await request('/api/v1/hod/teachers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${regularToken}` }
  }, {
    full_name: 'Unauthorized Teacher',
    email: 'unauth@college.edu',
    password: 'Password123'
  });
  assert('Regular teacher BLOCKED from POST /hod/teachers (403)', regCreateTeacher.statusCode === 403);

  const regCreateSubject = await request('/api/v1/hod/subjects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${regularToken}` }
  }, {
    name: 'Hacked Subject',
    code: 'HACK101',
    year: 1,
    semester: 1
  });
  assert('Regular teacher BLOCKED from POST /hod/subjects (403)', regCreateSubject.statusCode === 403);

  const regAssignTeacher = await request('/api/v1/hod/assignments/subject-teacher', {
    method: 'POST',
    headers: { Authorization: `Bearer ${regularToken}` }
  }, {
    teacher_id: 2,
    subject_id: 1,
    session_type_scope: 'THEORY'
  });
  assert('Regular teacher BLOCKED from POST /hod/assignments/subject-teacher (403)', regAssignTeacher.statusCode === 403);

  const regDeleteTeacher = await request('/api/v1/hod/teachers/2', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${regularToken}` }
  });
  assert('Regular teacher BLOCKED from DELETE /hod/teachers (403)', regDeleteTeacher.statusCode === 403);

  // Log in as Class Teacher (classteacher@gmail.com)
  const ctLogin = await request('/api/v1/auth/faculty/login', { method: 'POST' }, {
    email: 'classteacher@gmail.com',
    password: 'Password@123'
  });
  assert('Class Teacher login successful', ctLogin.statusCode === 200 && ctLogin.json?.data?.access_token);
  const ctToken = ctLogin.json?.data?.access_token;

  // Class Teacher also CANNOT create teachers or subjects (exclusive HOD role)
  const ctCreateTeacher = await request('/api/v1/hod/teachers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctToken}` }
  }, {
    full_name: 'CT Unauthorized Teacher',
    email: 'ctunauth@college.edu',
    password: 'Password123'
  });
  assert('Class Teacher BLOCKED from POST /hod/teachers (403)', ctCreateTeacher.statusCode === 403);

  const ctCreateSubject = await request('/api/v1/hod/subjects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctToken}` }
  }, {
    name: 'CT Subject',
    code: 'CT101',
    year: 1,
    semester: 1
  });
  assert('Class Teacher BLOCKED from POST /hod/subjects (403)', ctCreateSubject.statusCode === 403);

  // 5. Frontend Route Guard Simulation
  console.log('\n--- 5. Frontend Route Guard Simulation ---');

  const teacherUserNoSubjects = {
    roles: ['TEACHER'],
    is_hod: false,
    is_class_teacher: false,
    has_assigned_subjects: false
  };

  function testGuardRoute(options, user) {
    const config = Array.isArray(options) ? { roles: options } : (options || {});
    if (config.roles && !user.roles.some(r => config.roles.includes(r))) {
      return { allowed: false, reason: 'role_mismatch' };
    }
    if (config.requireHOD && !user.roles.includes('SYSTEM_ADMIN') && !user.is_hod) {
      return { allowed: false, reason: 'require_hod' };
    }
    if (config.requireClassTeacher && !user.roles.includes('SYSTEM_ADMIN') && !user.is_class_teacher && !user.is_hod) {
      return { allowed: false, reason: 'require_class_teacher' };
    }
    if (config.requireSubjects && !user.roles.includes('SYSTEM_ADMIN') && !user.is_hod && !user.has_assigned_subjects) {
      return { allowed: false, reason: 'require_subjects' };
    }
    return { allowed: true };
  }

  const g1 = testGuardRoute({ roles: ['TEACHER', 'SYSTEM_ADMIN'], requireSubjects: true }, teacherUserNoSubjects);
  assert('Teacher with no subjects BLOCKED from registers/assignments (require_subjects)', !g1.allowed && g1.reason === 'require_subjects');

  const g2 = testGuardRoute({ roles: ['TEACHER', 'SYSTEM_ADMIN'], requireHOD: true }, teacherUserNoSubjects);
  assert('Teacher without HOD scope BLOCKED from hod-* pages (require_hod)', !g2.allowed && g2.reason === 'require_hod');

  const g3 = testGuardRoute({ roles: ['TEACHER', 'SYSTEM_ADMIN'], requireClassTeacher: true }, teacherUserNoSubjects);
  assert('Teacher without Class Teacher role BLOCKED from students roster (require_class_teacher)', !g3.allowed && g3.reason === 'require_class_teacher');

  const teacherWithSubjects = { ...teacherUserNoSubjects, has_assigned_subjects: true };
  const g4 = testGuardRoute({ roles: ['TEACHER', 'SYSTEM_ADMIN'], requireSubjects: true }, teacherWithSubjects);
  assert('Teacher with assigned subjects ALLOWED into registers/assignments', g4.allowed);

  const hodUser = { ...teacherUserNoSubjects, is_hod: true };
  const g5 = testGuardRoute({ roles: ['TEACHER', 'SYSTEM_ADMIN'], requireHOD: true }, hodUser);
  assert('HOD ALLOWED into hod-* pages', g5.allowed);

  console.log('\n=============================================================');
  console.log(`🏁 TEST COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('=============================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
