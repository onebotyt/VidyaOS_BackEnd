/**
 * Regression & Verification Test:
 * Teacher and Student Registration Open/Close Gateways Flow
 * 
 * Verifies:
 * 1. HOD / Faculty can query teacher registration status
 * 2. HOD / Faculty can toggle teacher registration (OPEN / CLOSED)
 * 3. When teacher registration is OPEN, /api/v1/auth/registration-gates shows open
 * 4. When teacher registration is CLOSED, /api/v1/auth/registration-gates shows closed
 * 5. HOD / Faculty can query cohort student registration status
 * 6. HOD / Faculty can toggle cohort student registration (OPEN / CLOSED)
 * 7. HOD / Faculty can toggle department-wide student registration (OPEN / CLOSED)
 * 8. When student registration is OPEN, public /auth/student/registration/status shows open
 * 9. When student registration is CLOSED, public /auth/student/registration/status shows closed
 * 10. Frontend students.html DOM contains the dedicated gateway hub and all toggle controls
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Testing Teacher & Student Registration Gateways Flow');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Login as HOD (IT Dept)
  console.log('► 1. Authenticating as HOD (IT)...');
  const loginRes = await request('/auth/faculty/login', {
    method: 'POST',
    body: { email: 'hod@gmail.com', password: 'Password@123' }
  });
  assert.strictEqual(loginRes.status, 200, 'HOD login should succeed');
  const token = loginRes.body.data.access_token;
  assert(token, 'Access token should be returned');
  console.log('  ✓ HOD authenticated successfully.');

  const authHeaders = { Authorization: `Bearer ${token}` };

  // 2. Query Teacher Registration Status
  console.log('\n► 2. Querying Teacher Registration Status...');
  const tStatRes = await request('/hod/faculty-registration-status', { headers: authHeaders });
  assert.strictEqual(tStatRes.status, 200, 'Faculty registration status query should return 200');
  assert(typeof tStatRes.body.data?.is_open === 'boolean', 'is_open boolean should be returned');
  const initialTeacherOpen = tStatRes.body.data.is_open;
  console.log(`  ✓ Current teacher registration status: ${initialTeacherOpen ? 'OPEN' : 'CLOSED'}`);

  // 3. Toggle Teacher Registration to OPEN
  console.log('\n► 3. Toggling Teacher Registration to OPEN...');
  const tToggleOpen = await request('/hod/faculty-registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { open: true }
  });
  assert.strictEqual(tToggleOpen.status, 200, 'Faculty registration toggle should return 200');
  assert.strictEqual(tToggleOpen.body.data?.is_open, true, 'is_open should be true');
  console.log('  ✓ Teacher registration toggled to OPEN.');

  // 4. Verify public registration gates reflect OPEN
  console.log('\n► 4. Verifying Public Registration Gates reflect Teacher Registration OPEN...');
  const pubGatesOpen = await request('/auth/registration-gates');
  assert.strictEqual(pubGatesOpen.status, 200, 'Public gates query should return 200');
  const itDeptOpen = pubGatesOpen.body.data?.departments?.find(d => d.code === 'IT');
  assert(itDeptOpen, 'IT department should be in public gates list');
  assert.strictEqual(itDeptOpen.faculty_registration_open, true, 'IT faculty registration should be OPEN in public gates');
  console.log('  ✓ Public registration gates confirmed: IT faculty registration is OPEN.');

  // 5. Toggle Teacher Registration to CLOSED
  console.log('\n► 5. Toggling Teacher Registration to CLOSED...');
  const tToggleClose = await request('/hod/faculty-registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { open: false }
  });
  assert.strictEqual(tToggleClose.status, 200, 'Faculty registration toggle to false should return 200');
  assert.strictEqual(tToggleClose.body.data?.is_open, false, 'is_open should be false');

  const pubGatesClosed = await request('/auth/registration-gates');
  const itDeptClosed = pubGatesClosed.body.data?.departments?.find(d => d.code === 'IT');
  assert.strictEqual(itDeptClosed.faculty_registration_open, false, 'IT faculty registration should be CLOSED in public gates');
  console.log('  ✓ Teacher registration toggled to CLOSED and verified via public gates.');

  // Restore to OPEN so users can test freely
  await request('/hod/faculty-registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { open: true }
  });
  console.log('  ✓ Teacher registration left in OPEN state for live use.');

  // 6. Query Student Cohort Registration Status
  console.log('\n► 6. Querying Student Cohort Registration Status...');
  const deptId = itDeptOpen.id;
  const sStatRes = await request(`/faculty/cohorts/registration-status?department_id=${deptId}&year=1&semester=1`, {
    headers: authHeaders
  });
  assert.strictEqual(sStatRes.status, 200, 'Cohort registration status query should return 200');
  console.log(`  ✓ Current cohort registration is_open: ${sStatRes.body.data?.is_open}`);

  // 7. Toggle Student Registration for Cohort to OPEN
  console.log('\n► 7. Toggling Student Registration for IT Sem 1 to OPEN...');
  const sToggleOpen = await request('/faculty/cohorts/registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { department_id: deptId, year: 1, semester: 1, open: true }
  });
  assert.strictEqual(sToggleOpen.status, 200, 'Cohort registration toggle to true should return 200');
  assert.strictEqual(sToggleOpen.body.data?.is_open, true, 'Cohort registration is_open should be true');

  // Verify public student registration status
  const pubStudentOpen = await request(`/auth/student/registration/status?department_id=${deptId}&semester=1`);
  assert.strictEqual(pubStudentOpen.status, 200, 'Public student registration status should return 200');
  assert.strictEqual(pubStudentOpen.body.data?.is_open, true, 'Public student registration should report is_open: true');
  console.log('  ✓ Public student registration status confirmed: IT Sem 1 is OPEN.');

  // 8. Toggle Student Registration for Cohort to CLOSED
  console.log('\n► 8. Toggling Student Registration for IT Sem 1 to CLOSED...');
  const sToggleClose = await request('/faculty/cohorts/registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { department_id: deptId, year: 1, semester: 1, open: false }
  });
  assert.strictEqual(sToggleClose.status, 200, 'Cohort registration toggle to false should return 200');
  assert.strictEqual(sToggleClose.body.data?.is_open, false, 'Cohort registration is_open should be false');

  const pubStudentClosed = await request(`/auth/student/registration/status?department_id=${deptId}&semester=1`);
  assert.strictEqual(pubStudentClosed.body.data?.is_open, false, 'Public student registration should report is_open: false');
  console.log('  ✓ Public student registration status confirmed: IT Sem 1 is CLOSED.');

  // 9. Department-wide Student Registration Toggle
  console.log('\n► 9. Testing Department-Wide Student Registration Toggle...');
  const deptWideToggle = await request('/faculty/cohorts/registration-toggle', {
    method: 'POST',
    headers: authHeaders,
    body: { department_id: deptId, department_wide: true, open: true }
  });
  assert.strictEqual(deptWideToggle.status, 200, 'Department-wide toggle should return 200');
  assert.strictEqual(deptWideToggle.body.data?.is_open, true, 'Department-wide is_open should be true');

  // Verify that semester 1 and semester 2 both report open
  const pubSem1 = await request(`/auth/student/registration/status?department_id=${deptId}&semester=1`);
  const pubSem2 = await request(`/auth/student/registration/status?department_id=${deptId}&semester=2`);
  assert.strictEqual(pubSem1.body.data?.is_open, true, 'Sem 1 should be open via department-wide toggle');
  assert.strictEqual(pubSem2.body.data?.is_open, true, 'Sem 2 should be open via department-wide toggle');
  console.log('  ✓ Department-wide student registration toggle opens all cohorts successfully.');

  // 10. DOM Elements Verification across students.html, hod-teachers.html, hod-students.html
  console.log('\n► 10. Verifying DOM Elements in frontend pages...');
  const pages = [
    'frontend/faculty/students.html',
    'frontend/faculty/hod-teachers.html',
    'frontend/faculty/hod-students.html'
  ];

  for (const pageRel of pages) {
    const filePath = path.resolve(__dirname, '..', '..', pageRel);
    assert(fs.existsSync(filePath), `${pageRel} must exist`);
    const html = fs.readFileSync(filePath, 'utf8');

    // Gateway hub
    assert(html.includes('id="registration-control-hub"'), `${pageRel} must include #registration-control-hub`);
    assert(html.includes('id="quick-teacher-reg-badge"'), `${pageRel} must include #quick-teacher-reg-badge`);
    assert(html.includes('id="quick-teacher-reg-toggle-btn"'), `${pageRel} must include #quick-teacher-reg-toggle-btn`);
    assert(html.includes('id="quick-student-reg-badge"'), `${pageRel} must include #quick-student-reg-badge`);
    assert(html.includes('id="quick-student-reg-toggle-btn"'), `${pageRel} must include #quick-student-reg-toggle-btn`);
    assert(html.includes('id="quick-dept-student-reg-toggle-btn"'), `${pageRel} must include #quick-dept-student-reg-toggle-btn`);

    // Tab 1 Teacher elements
    assert(html.includes('id="hod-faculty-reg-btn"'), `${pageRel} must preserve #hod-faculty-reg-btn`);
    assert(html.includes('id="hod-reg-indicator"'), `${pageRel} must preserve #hod-reg-indicator`);
    assert(html.includes('id="hod-reg-text"'), `${pageRel} must preserve #hod-reg-text`);

    // Tab 2 Roster elements
    assert(html.includes('id="tab-roster-reg-status"'), `${pageRel} must include #tab-roster-reg-status`);
    assert(html.includes('id="tab-roster-reg-toggle-btn"'), `${pageRel} must include #tab-roster-reg-toggle-btn`);
    assert(html.includes('id="tab-roster-dept-reg-toggle-btn"'), `${pageRel} must include #tab-roster-dept-reg-toggle-btn`);

    // Tab 3 Pending elements
    assert(html.includes('id="reg-toggle-card"'), `${pageRel} must preserve #reg-toggle-card`);
    assert(html.includes('id="reg-toggle-status"'), `${pageRel} must preserve #reg-toggle-status`);
    assert(html.includes('id="reg-toggle-btn"'), `${pageRel} must preserve #reg-toggle-btn`);

    // apiFetch fallback
    assert(html.includes('window.apiFetch'), `${pageRel} must include window.apiFetch definition`);

    console.log(`  ✓ ${pageRel}: All 14 required registration DOM elements & scripts verified.`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ALL REGISTRATION GATEWAY TESTS PASSED (10/10) ✓');
  console.log('═══════════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
