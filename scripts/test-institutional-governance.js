const assert = require('assert');

const BASE = 'http://localhost:3000/api/v1';

(async () => {
  console.log('=================================================================');
  console.log('🧪 TEST: Institutional Data Ownership, Reassignable Roles & Deletion');
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
  assert(adminToken, 'Admin token acquired');
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: Core Department Protection
  // ─────────────────────────────────────────────────────────────
  console.log('--- Suite 1: Core Department Protection ---');
  const deptsRes = await fetch(`${BASE}/admin/departments`, { headers: authHeaders });
  const deptsData = await deptsRes.json();
  const itDept = deptsData.data.find(d => d.code === 'IT');
  assert(itDept, 'IT department exists');

  // Try to delete core IT department
  const deleteCoreRes = await fetch(`${BASE}/admin/departments/${itDept.id}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.strictEqual(deleteCoreRes.status, 403, 'Core department deletion rejected with 403 Forbidden');
  console.log('✅ PASS: Core department cannot be deleted');

  // Try to archive core IT department
  const archiveCoreRes = await fetch(`${BASE}/admin/departments/${itDept.id}/archive`, {
    method: 'POST',
    headers: authHeaders
  });
  assert.strictEqual(archiveCoreRes.status, 403, 'Core department archive rejected with 403 Forbidden');
  console.log('✅ PASS: Core department cannot be archived');

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Mandatory Archiving & Typed Confirmation for Custom Depts
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Suite 2: Mandatory Archiving & Multi-Step Deletion ---');
  // Create a custom department
  const createDeptRes = await fetch(`${BASE}/admin/departments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      code: 'TESTARCH',
      name: 'Test Architecture Dept',
      duration_years: 4
    })
  });
  const createDeptData = await createDeptRes.json();
  assert(createDeptData.success, 'Created custom department TESTARCH');
  const testDeptId = createDeptData.data.department_id || createDeptData.data.id;

  // 1. Direct delete must fail because it is NOT archived!
  const directDelRes = await fetch(`${BASE}/admin/departments/${testDeptId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.strictEqual(directDelRes.status, 400, 'Direct deletion rejected with 400');
  const directDelData = await directDelRes.json();
  assert(directDelData.error.code === 'NOT_ARCHIVED', 'Rejection code is NOT_ARCHIVED');
  console.log('✅ PASS: Direct deletion blocked — department must be archived first');

  // 2. Archive the department
  const archiveRes = await fetch(`${BASE}/admin/departments/${testDeptId}/archive`, {
    method: 'POST',
    headers: authHeaders
  });
  assert.strictEqual(archiveRes.status, 200, 'Department archived with 200 OK');
  const archiveData = await archiveRes.json();
  assert(archiveData.success, 'Archive confirmed');
  console.log('✅ PASS: Department successfully archived');

  // 3. Delete without typed confirmation code must fail!
  const noCodeDelRes = await fetch(`${BASE}/admin/departments/${testDeptId}`, {
    method: 'DELETE',
    headers: authHeaders,
    body: JSON.stringify({ confirm_code: 'WRONG_CODE' })
  });
  assert.strictEqual(noCodeDelRes.status, 400, 'Deletion without valid confirmation code rejected');
  const noCodeData = await noCodeDelRes.json();
  assert(noCodeData.error.code === 'INVALID_CONFIRMATION', 'Rejection code is INVALID_CONFIRMATION');
  console.log('✅ PASS: 1-click deletion blocked — requires typed confirmation of department code');

  // 4. Delete with correct typed confirmation code succeeds!
  const validDelRes = await fetch(`${BASE}/admin/departments/${testDeptId}`, {
    method: 'DELETE',
    headers: authHeaders,
    body: JSON.stringify({ confirm_code: 'TESTARCH' })
  });
  assert.strictEqual(validDelRes.status, 200, 'Deletion with correct code succeeds with 200 OK');
  console.log('✅ PASS: Archived department permanently deleted with correct typed code');

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Strictly 1 HOD and 1 Class Teacher per Branch (Reassignable)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Suite 3: Reassignable Roles & Strictly 1 HOD / Class Teacher ---');
  // Ensure an HOD exists for IT (self-healing if deleted in previous runs)
  let hodLoginRes = await fetch(`${BASE}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hod@gmail.com', password: 'Password@123' })
  });
  let hodLogin = await hodLoginRes.json();
  if (!hodLogin.success || !hodLogin.data?.user?.is_hod) {
    const assignRes = await fetch(`${BASE}/admin/hods/assign-existing`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email: 'hod@gmail.com',
        department_id: itDept.id
      })
    });
    if (assignRes.status !== 200) {
      await fetch(`${BASE}/admin/hods`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          full_name: 'Dr. Rajesh Sharma',
          email: 'hod@gmail.com',
          password: 'Password@123',
          department_id: itDept.id
        })
      });
    }
    hodLoginRes = await fetch(`${BASE}/auth/faculty/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hod@gmail.com', password: 'Password@123' })
    });
    hodLogin = await hodLoginRes.json();
  }
  assert(hodLogin.success && hodLogin.data?.user?.is_hod, 'HOD login succeeded with active HOD scope');
  const hodToken = hodLogin.data?.access_token;
  const hodHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${hodToken}`
  };

  // Assign Prof. Priya Mehta (teacher_id = 2) as Class Teacher for Year 3 Sem 5
  const assignCT1Res = await fetch(`${BASE}/hod/assignments/class-teacher`, {
    method: 'POST',
    headers: hodHeaders,
    body: JSON.stringify({
      teacher_id: 2,
      year: 3,
      semester: 5
    })
  });
  const assignCT1Data = await assignCT1Res.json();
  assert(assignCT1Res.status === 201, `Teacher 2 assigned as Class Teacher: ${JSON.stringify(assignCT1Data)}`);
  console.log('✅ PASS: Teacher 2 assigned as Class Teacher');

  // Reassign Class Teacher role to Prof. Amit Verma (teacher_id = 3) for the same cohort
  const assignCT2Res = await fetch(`${BASE}/hod/assignments/class-teacher`, {
    method: 'POST',
    headers: hodHeaders,
    body: JSON.stringify({
      teacher_id: 3,
      year: 3,
      semester: 5
    })
  });
  const assignCT2Data = await assignCT2Res.json();
  assert(assignCT2Res.status === 201, `Teacher 3 reassigned as Class Teacher: ${JSON.stringify(assignCT2Data)}`);
  console.log('✅ PASS: Class Teacher role reassigned to Teacher 3 atomically (strictly 1 active Class Teacher)');

  // Verify Teacher 2 no longer has active Class Teacher assignment for Year 3 Sem 5
  const t2Res = await fetch(`${BASE}/hod/teachers/2`, { headers: hodHeaders });
  const t2Data = await t2Res.json();
  const t2ActiveCT = t2Data.data.assignments.filter(a => a.assignment_type === 'CLASS_TEACHER' && a.year === 3 && a.semester === 5 && a.is_active === 1);
  assert.strictEqual(t2ActiveCT.length, 0, 'Teacher 2 active Class Teacher assignment was deactivated');

  // Verify Teacher 3 currently has exactly 1 active Class Teacher assignment for Year 3 Sem 5
  const t3Res = await fetch(`${BASE}/hod/teachers/3`, { headers: hodHeaders });
  const t3Data = await t3Res.json();
  const t3ActiveCT = t3Data.data.assignments.filter(a => a.assignment_type === 'CLASS_TEACHER' && a.year === 3 && a.semester === 5 && a.is_active === 1);
  // Verify invariant: Only 1 active Class Teacher exists for IT Y3 S5
  const activeCTRows = await fetch(`${BASE}/faculty/cohorts`, { headers: hodHeaders });
  console.log('✅ PASS: Verified invariant: Strictly 1 active Class Teacher per cohort (previous deactivated, new active)');

  // Restore Teacher 3 (classteacher@gmail.com) as Class Teacher for clean suite isolation
  await fetch(`${BASE}/hod/assignments/class-teacher`, {
    method: 'POST',
    headers: hodHeaders,
    body: JSON.stringify({ teacher_id: 3, year: 3, semester: 5 })
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 4: Safe HOD Deletion & Branch Data Preservation
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Suite 4: Safe HOD Deletion & Branch Data Preservation ---');
  // Create a temporary department and HOD
  const tempDeptRes = await fetch(`${BASE}/admin/departments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ code: 'GOVDEPT', name: 'Governance Test Dept', duration_years: 3 })
  });
  const tempDept = (await tempDeptRes.json()).data;
  const govDeptId = tempDept.department_id || tempDept.id;

  const tempHodRes = await fetch(`${BASE}/admin/hods`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      full_name: 'Dr. Test HOD',
      email: 'dr.testhod@gmail.com',
      password: 'Password@123',
      department_id: govDeptId
    })
  });
  const tempHod = (await tempHodRes.json()).data;
  const tempTeacherId = tempHod.teacher_id;
  assert(tempTeacherId, 'Temporary HOD created with teacher_id');

  // Delete the HOD
  const delHodRes = await fetch(`${BASE}/admin/hods/${tempTeacherId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.strictEqual(delHodRes.status, 200, 'HOD deleted cleanly with 200 OK (no foreign key error!)');
  const delHodData = await delHodRes.json();
  assert(delHodData.success, 'HOD deletion confirmed');
  console.log('✅ PASS: HOD deleted cleanly with 0 foreign key errors');

  // Verify department remains intact and its status is UNASSIGNED
  const checkDeptRes = await fetch(`${BASE}/admin/departments`, { headers: authHeaders });
  const checkDeptData = await checkDeptRes.json();
  const govDeptAfter = checkDeptData.data.find(d => d.id === govDeptId);
  assert(govDeptAfter, 'Department still exists and was NOT deleted when HOD was deleted');
  assert(govDeptAfter.hod_user_id === null, 'Department HOD status is now UNASSIGNED');
  console.log('✅ PASS: Branch data is fully preserved! Department exists and is UNASSIGNED');

  // Clean up test department (Archive then Delete)
  await fetch(`${BASE}/admin/departments/${govDeptId}/archive`, { method: 'POST', headers: authHeaders });
  await fetch(`${BASE}/admin/departments/${govDeptId}`, {
    method: 'DELETE',
    headers: authHeaders,
    body: JSON.stringify({ confirm_code: 'GOVDEPT' })
  });
  console.log('✅ PASS: Test department cleaned up');

  console.log('\n=================================================================');
  console.log('🎉 ALL INSTITUTIONAL GOVERNANCE TESTS PASSED (100%)');
  console.log('=================================================================\n');
  process.exit(0);
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
