const assert = require('assert');

const BASE = 'http://localhost:3000/api/v1';

(async () => {
  console.log('=================================================================');
  console.log('🧪 TEST: Faculty Search by Gmail & Combined HOD Role Assignment');
  console.log('=================================================================\n');

  // 1. Authenticate as Admin
  const adminLoginRes = await fetch(`${BASE}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const adminLogin = await adminLoginRes.json();
  assert(adminLogin.success, 'Admin login succeeded');
  const adminToken = adminLogin.data?.access_token;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: Search Faculty by Gmail
  // ─────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Search Faculty by Gmail ---');

  // 1a. Search existing faculty: classteacher@gmail.com
  const searchRes = await fetch(`${BASE}/admin/faculty/search?email=classteacher@gmail.com`, { headers: authHeaders });
  assert.strictEqual(searchRes.status, 200, 'Search returned 200 OK');
  const searchData = await searchRes.json();
  assert(searchData.success, 'Search response success flag true');
  const faculty = searchData.data;
  console.log('Found Faculty:', faculty.full_name, '| Roles:', faculty.current_roles);
  assert(faculty.teacher_id, 'Has teacher_id');
  assert(faculty.full_name.includes('Priya Mehta'), 'Correct faculty found');
  assert(faculty.current_roles.includes('Class Teacher'), 'Shows Class Teacher role in roles list');
  assert(faculty.current_roles.includes('Subject Teacher'), 'Shows Subject Teacher role in roles list');
  console.log('✅ PASS: Existing faculty search by Gmail returns profile and active roles');

  // 1b. Search unknown email
  const unknownRes = await fetch(`${BASE}/admin/faculty/search?email=nonexistent@gmail.com`, { headers: authHeaders });
  assert.strictEqual(unknownRes.status, 404, 'Unknown email returns 404 NOT_FOUND');
  console.log('✅ PASS: Unknown email handled cleanly with 404');

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Appoint Existing Faculty as HOD & Grant Combined Powers
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Appoint Existing Faculty as HOD & Grant Combined Powers ---');

  // Appoint Prof. Priya Mehta as HOD of IT (dept 4)
  const assignHODRes = await fetch(`${BASE}/admin/hods/assign-existing`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      teacher_id: faculty.teacher_id,
      department_id: 4
    })
  });
  assert.strictEqual(assignHODRes.status, 200, 'Assign HOD returned 200 OK');
  const assignHODData = await assignHODRes.json();
  assert(assignHODData.success, 'Assign HOD succeeded');
  console.log('✅ PASS: Appointed existing faculty as HOD');

  // 2b. Verify Priya Mehta login has all powers combined
  const priyaLoginRes = await fetch(`${BASE}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'classteacher@gmail.com', password: 'Password@123' })
  });
  const priyaLogin = await priyaLoginRes.json();
  assert(priyaLogin.success, 'Priya login succeeded');
  const priyaUser = priyaLogin.data?.user;
  const priyaToken = priyaLogin.data?.access_token;
  const priyaHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${priyaToken}` };

  assert.strictEqual(priyaUser.is_hod, true, 'is_hod is true');
  assert.strictEqual(priyaUser.is_class_teacher, true, 'is_class_teacher remains true (retained!)');
  assert.strictEqual(priyaUser.has_assigned_subjects, true, 'has_assigned_subjects remains true (retained!)');
  assert.strictEqual(priyaUser.hod_department_id, 4, 'hod_department_id is 4 (IT)');
  console.log('✅ PASS: Faculty login contains combined HOD + Class Teacher + Subject Teacher powers');

  // 2c. Verify access to HOD routes
  const hodDashRes = await fetch(`${BASE}/hod/dashboard`, { headers: priyaHeaders });
  assert.strictEqual(hodDashRes.status, 200, 'Faculty can access /hod/dashboard');
  console.log('✅ PASS: Faculty can access HOD administration endpoints');

  // 2d. Verify access to Class Teacher cohorts
  const ctCohortsRes = await fetch(`${BASE}/faculty/cohorts`, { headers: priyaHeaders });
  assert.strictEqual(ctCohortsRes.status, 200, 'Faculty can access /faculty/cohorts');
  console.log('✅ PASS: Faculty retains access to Class Teacher cohorts');

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Idempotent HOD Deletion & Multi-Role Account Protection
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: Idempotent HOD Deletion & Multi-Role Account Protection ---');

  // 3a. Remove HOD role from Priya Mehta (dynamic faculty.teacher_id)
  const delPriyaRes = await fetch(`${BASE}/admin/hods/${faculty.teacher_id}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(delPriyaRes.status, 200, 'Revoke HOD role returned 200 OK');
  const delPriyaData = await delPriyaRes.json();
  console.log('Revoke Message:', delPriyaData.message);
  assert(delPriyaData.message.includes('removed as HOD'), 'Message notes HOD role was removed');

  // 3b. Verify Priya Mehta still exists as an active teacher and can still log in!
  const priyaLoginAfterRes = await fetch(`${BASE}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'classteacher@gmail.com', password: 'Password@123' })
  });
  const priyaLoginAfter = await priyaLoginAfterRes.json();
  assert(priyaLoginAfter.success, 'Priya Mehta account is NOT deleted and can still log in');
  assert.strictEqual(priyaLoginAfter.data?.user?.is_hod, false, 'is_hod is now false');
  assert.strictEqual(priyaLoginAfter.data?.user?.is_class_teacher, true, 'is_class_teacher is still true');
  console.log('✅ PASS: Multi-role faculty retains teaching profile and classes when HOD role is removed');

  // 3c. Idempotent deletion: deleting again should NOT throw 404 "HOD not found"
  const delAgainRes = await fetch(`${BASE}/admin/hods/${faculty.teacher_id}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(delAgainRes.status, 200, 'Deleting already removed HOD returns 200 idempotently (no 404)');
  console.log('✅ PASS: Idempotent HOD deletion returns 200 cleanly (Zero "HOD not found" errors)');

  console.log('\n=================================================================');
  console.log('🎉 ALL FACULTY SEARCH & COMBINED HOD ROLE TESTS PASSED (100%)');
  console.log('=================================================================');
})();
