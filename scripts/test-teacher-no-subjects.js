const http = require('http');

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Teacher No Subjects Test Suite ---');
  
  // 1. Teacher login
  const teacherLogin = await request('http://localhost:3000/api/v1/auth/faculty/login', { method: 'POST' }, {
    username: 'teacher@gmail.com',
    password: 'Password@123'
  });
  console.log('1. Teacher login status:', teacherLogin.status);
  if (!teacherLogin.data.success) {
    throw new Error('Teacher login failed: ' + JSON.stringify(teacherLogin.data));
  }
  const teacherToken = teacherLogin.data.data.access_token;
  const teacherUser = teacherLogin.data.data.user;
  console.log('Teacher has_assigned_subjects:', teacherUser.has_assigned_subjects);
  console.log('Teacher is_hod:', teacherUser.is_hod);
  if (teacherUser.has_assigned_subjects !== false) {
    throw new Error('Expected teacher has_assigned_subjects to be false');
  }

  // 2. Fetch registers for teacher
  const regsRes = await request('http://localhost:3000/api/v1/faculty/registers', {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  console.log('2. Teacher registers count:', regsRes.data.data.length);
  if (regsRes.data.data.length !== 0) {
    throw new Error('Expected teacher registers length to be 0');
  }

  // 3. Fetch my-classes for teacher
  const classesRes = await request('http://localhost:3000/api/v1/faculty/my-classes', {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  console.log('3. Teacher my-classes count:', classesRes.data.data.length);
  if (classesRes.data.data.length !== 0) {
    throw new Error('Expected teacher my-classes to be empty');
  }

  // 4. Fetch analytics for teacher
  const analyticsRes = await request('http://localhost:3000/api/v1/reports/analytics', {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  console.log('4. Teacher analytics classes count:', analyticsRes.data.data.classes.length);
  if (analyticsRes.data.data.classes.length !== 0) {
    throw new Error('Expected teacher analytics classes to be 0');
  }

  // 5. HOD login & assign subject
  const hodLogin = await request('http://localhost:3000/api/v1/auth/faculty/login', { method: 'POST' }, {
    username: 'hod@gmail.com',
    password: 'Password@123'
  });
  console.log('5. HOD login status:', hodLogin.status);
  const hodToken = hodLogin.data.data.access_token;

  // Find Computer Networks (id: 3) or similar subject
  const assignRes = await request('http://localhost:3000/api/v1/hod/assignments/subject-teacher', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hodToken}` }
  }, {
    teacher_id: 3,
    subject_id: 3,
    branch_id: 1,
    year: 3,
    semester: 5,
    session_type_scope: 'THEORY'
  });
  console.log('6. HOD assign subject response status:', assignRes.status, assignRes.data);
  const newAssignmentId = assignRes.data.data?.assignment_id || assignRes.data.data?.id;

  // Check teacher registers now
  const regsAfterAssign = await request('http://localhost:3000/api/v1/faculty/registers', {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  console.log('7. Teacher registers count after assignment:', regsAfterAssign.data.data.length);
  if (regsAfterAssign.data.data.length !== 1) {
    throw new Error('Expected teacher registers length to be 1 after assignment');
  }

  // 8. HOD unassigns subject using DELETE /api/v1/hod/assignments/:id
  const deleteRes = await request(`http://localhost:3000/api/v1/hod/assignments/${newAssignmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  console.log('8. HOD unassign response status:', deleteRes.status, deleteRes.data);

  // 9. Teacher registers count after unassign
  const regsAfterUnassign = await request('http://localhost:3000/api/v1/faculty/registers', {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  console.log('9. Teacher registers count after unassign:', regsAfterUnassign.data.data.length);
  if (regsAfterUnassign.data.data.length !== 0) {
    throw new Error('Expected teacher registers length to be 0 after unassign');
  }

  console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
