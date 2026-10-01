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
  console.log('=== STARTING SEMESTER PROMOTION & DEMOTION SAFETY TEST ===\n');

  // 1. Login HOD
  const hodToken = await login('hod@gmail.com', 'Password@123');
  console.log('✔ HOD login successful');

  // 2. Test GET preview in PROMOTE mode
  const previewPromote = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/preview?action=promote',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });

  if (previewPromote.status !== 200 || !previewPromote.json?.success) {
    throw new Error(`GET preview promote failed: ${previewPromote.status} ${previewPromote.body}`);
  }
  console.log('✔ GET /api/v1/hod/promotion/preview?action=promote returned 200:');
  console.log(`  Dept: ${previewPromote.json.data.department_code}, Advancing: ${previewPromote.json.data.continuing_count}, Total: ${previewPromote.json.data.total_students}`);

  // 3. Test Accidental Click Safety Gate - missing code
  const noCodeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/execute',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, { action: 'promote' });

  if (noCodeRes.status !== 400) {
    throw new Error(`Expected 400 for missing confirmation code, got ${noCodeRes.status}: ${noCodeRes.body}`);
  }
  console.log('✔ Accidental click prevented: Missing confirmation code correctly rejected with HTTP 400');

  // 4. Test Accidental Click Safety Gate - wrong code
  const wrongCodeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/execute',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, { action: 'promote', confirm_code: 'WRONG' });

  if (wrongCodeRes.status !== 400) {
    throw new Error(`Expected 400 for wrong confirmation code, got ${wrongCodeRes.status}: ${wrongCodeRes.body}`);
  }
  console.log('✔ Accidental click prevented: Incorrect confirmation code correctly rejected with HTTP 400');

  // 5. Test Execute Promotion with Valid Code (department code)
  const deptCode = previewPromote.json.data.department_code || 'IT';
  const executePromoteRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/execute',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, { action: 'promote', confirm_code: deptCode });

  if (executePromoteRes.status !== 200 || !executePromoteRes.json?.success) {
    throw new Error(`Execute promotion failed: ${executePromoteRes.status} ${executePromoteRes.body}`);
  }
  console.log(`✔ Execute promotion with code "${deptCode}" succeeded:`, executePromoteRes.json.data);

  // 6. Test GET preview in DEMOTE mode
  const previewDemote = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/preview?action=demote',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });

  if (previewDemote.status !== 200 || !previewDemote.json?.success) {
    throw new Error(`GET preview demote failed: ${previewDemote.status} ${previewDemote.body}`);
  }
  console.log('✔ GET /api/v1/hod/promotion/preview?action=demote returned 200:');
  console.log(`  Eligible to revert: ${previewDemote.json.data.eligible_count}, Cohorts: ${previewDemote.json.data.cohorts.length}`);

  // 7. Test Execute Demotion / Reversal with Valid Code (case-insensitive)
  const executeDemoteRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/promotion/execute',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    }
  }, { action: 'demote', confirm_code: deptCode.toLowerCase() });

  if (executeDemoteRes.status !== 200 || !executeDemoteRes.json?.success) {
    throw new Error(`Execute demotion failed: ${executeDemoteRes.status} ${executeDemoteRes.body}`);
  }
  console.log(`✔ Execute demotion / reversal with code "${deptCode.toLowerCase()}" succeeded:`, executeDemoteRes.json.data);

  // 8. Verify student roster state
  const studentsRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/hod/students',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });

  if (studentsRes.status !== 200 || !studentsRes.json?.success) {
    throw new Error(`GET students failed: ${studentsRes.status}`);
  }

  const students = studentsRes.json.data;
  console.log(`✔ Verified ${students.length} active students in ${deptCode} department after demotion reversal:`);
  students.forEach(st => {
    console.log(`   - Roll ${st.class_roll_no} | ${st.official_enrollment_no} | ${st.full_name} | Year ${st.year} Sem ${st.semester} | Status: ${st.status}`);
  });

  console.log('\n=== ALL PROMOTION, DEMOTION & SAFETY TESTS PASSED! ===');
}

run().catch(err => {
  console.error('TEST SUITE ERROR:', err);
  process.exit(1);
});
