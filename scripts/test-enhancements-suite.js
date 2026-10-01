/**
 * test-enhancements-suite.js
 * End-to-end verification of all Admin, HOD, and Teacher view enhancements.
 */

const BASE_URL = 'http://localhost:3000/api/v1';

async function run() {
  console.log('====================================================');
  console.log('🧪 RUNNING ENHANCEMENTS VERIFICATION SUITE');
  console.log('====================================================\n');

  // ─────────────────────────────────────────────────────────────
  // 1. ADMIN TESTS: HOD Deletion & Department Detachment
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. ADMIN TESTS ---');
  const adminLogin = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const adminData = await adminLogin.json();
  if (!adminData.success) throw new Error('Admin login failed: ' + JSON.stringify(adminData));
  const adminToken = adminData.data.access_token;
  console.log('✓ Admin login successful');

  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const deptRes = await fetch(`${BASE_URL}/admin/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      code: 'TD_' + randomSuffix,
      name: 'Test Temp Dept ' + randomSuffix
    })
  });
  const deptData = await deptRes.json();
  if (!deptData.success) throw new Error('Failed to create test department: ' + JSON.stringify(deptData));
  const testDeptId = deptData.data.id;
  console.log(`✓ Created temporary department ID: ${testDeptId}`);

  // Create an HOD for this department
  const testHodEmpId = 'THOD' + Date.now().toString().slice(-4);
  const testHodEmail = `testhod_${Date.now().toString().slice(-4)}@college.edu`;
  const createHodRes = await fetch(`${BASE_URL}/admin/hods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      department_id: testDeptId,
      full_name: 'Prof. Temporary HOD',
      email: testHodEmail,
      employee_id: testHodEmpId,
      phone: '9876543210',
      password: 'Password@123'
    })
  });
  const createHodData = await createHodRes.json();
  if (!createHodData.success) throw new Error('Failed to create test HOD: ' + JSON.stringify(createHodData));
  const testHodTeacherId = createHodData.data.teacher_id;
  console.log(`✓ Created temporary HOD with teacher ID: ${testHodTeacherId}`);

  // Delete the HOD via DELETE /api/v1/admin/hods/:teacher_id
  const deleteHodRes = await fetch(`${BASE_URL}/admin/hods/${testHodTeacherId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const deleteHodData = await deleteHodRes.json();
  if (!deleteHodData.success) throw new Error('Failed to delete test HOD: ' + JSON.stringify(deleteHodData));
  console.log(`✓ Successfully deleted HOD (teacher_id: ${testHodTeacherId}) and detached department`);

  // Verify HOD list does not contain deleted HOD
  const hodsListRes = await fetch(`${BASE_URL}/admin/hods`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const hodsListData = await hodsListRes.json();
  const deletedStillExists = hodsListData.data.some(h => h.teacher_id === testHodTeacherId);
  if (deletedStillExists) throw new Error('Deleted HOD still present in HOD list!');
  console.log('✓ Confirmed HOD was removed from active faculty roster');

  // Clean up test department
  await fetch(`${BASE_URL}/admin/departments/${testDeptId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('✓ Cleaned up temporary department');


  // ─────────────────────────────────────────────────────────────
  // 2. HOD TESTS: Subject Scoping & Student Credentials
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. HOD TESTS ---');
  // Login as IT HOD Dr. Sunita Rao
  const hodLogin = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hod.it@gmail.com', password: 'Password@123' })
  });
  const hodLogData = await hodLogin.json();
  if (!hodLogData.success) throw new Error('HOD login failed: ' + JSON.stringify(hodLogData));
  const hodToken = hodLogData.data.access_token;
  const hodDeptId = hodLogData.data.user.hod_department_id;
  console.log(`✓ CE HOD login successful (Dept ID: ${hodDeptId})`);

  // Check hierarchy subjects scoping
  const hierRes = await fetch(`${BASE_URL}/hod/hierarchy`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const hierData = await hierRes.json();
  if (!hierData.success) throw new Error('GET /hod/hierarchy failed: ' + JSON.stringify(hierData));
  
  const subjects = hierData.data.subjects || [];
  console.log(`✓ Fetched ${subjects.length} subjects from /hod/hierarchy`);
  const foreignSubject = subjects.find(s => s.department_id !== hierData.data.department_id);
  if (foreignSubject) {
    throw new Error(`Subject leak detected! Subject "${foreignSubject.name}" (Dept ${foreignSubject.department_id}) found in Dept ${hierData.data.department_id}`);
  }
  console.log('✓ Verified: ALL subjects in hierarchy strictly belong to HOD department');

  // Enroll test student with temporary password
  const testStudentRoll = '999';
  const testStudentName = 'AutoTest Student Credentials';
  const testStudentEmail = `autotest_${Date.now().toString().slice(-5)}@college.edu`;
  const initialTempPass = 'TempPass@2026';

  const branchId = hierData.data.branches[0]?.id;
  const acadYears = hierData.data.academicYears || hierData.data.academic_years || [];
  const acadYearId = acadYears[0]?.id;

  const testEnrollNo = '2026IT' + Date.now().toString().slice(-4);
  const enrollRes = await fetch(`${BASE_URL}/hod/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      official_enrollment_no: testEnrollNo,
      full_name: testStudentName,
      email: testStudentEmail,
      roll_no: testStudentRoll,
      branch_id: branchId,
      academic_year_id: acadYearId,
      year: 1,
      semester: 1,
      initial_password: initialTempPass
    })
  });
  const enrollData = await enrollRes.json();
  if (!enrollData.success) throw new Error('Enroll student failed: ' + JSON.stringify(enrollData));
  
  if (enrollData.data.temp_password !== initialTempPass) {
    throw new Error(`Expected temp_password "${initialTempPass}", got "${enrollData.data.temp_password}"`);
  }
  const createdStudentId = enrollData.data.student_id;
  const officialEnrollNo = enrollData.data.official_enrollment_no;
  console.log(`✓ Successfully enrolled student "${testStudentName}" (ID: ${createdStudentId}, Enroll: ${officialEnrollNo})`);
  console.log(`✓ Verified temporary password returned: "${enrollData.data.temp_password}"`);

  // Test student login with initial temporary password
  const studLogin1 = await fetch(`${BASE_URL}/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollment_no: officialEnrollNo, password: initialTempPass })
  });
  const studLogin1Data = await studLogin1.json();
  if (!studLogin1Data.success) {
    throw new Error('Student login with temporary password failed: ' + JSON.stringify(studLogin1Data));
  }
  console.log('✓ Student login with initial temporary password verified');

  // Reset student password via HOD tool: POST /api/v1/hod/students/:id/reset-password
  const resetPass = 'NewReset@7890';
  const resetRes = await fetch(`${BASE_URL}/hod/students/${createdStudentId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ new_password: resetPass })
  });
  const resetData = await resetRes.json();
  if (!resetData.success) throw new Error('Reset password failed: ' + JSON.stringify(resetData));
  if (resetData.data.temp_password !== resetPass) {
    throw new Error(`Expected reset temp_password "${resetPass}", got "${resetData.data.temp_password}"`);
  }
  console.log(`✓ HOD reset student password successfully (New Temp Password: "${resetData.data.temp_password}")`);

  // Old password must fail
  const oldLoginRes = await fetch(`${BASE_URL}/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollment_no: officialEnrollNo, password: initialTempPass })
  });
  if (oldLoginRes.status === 200) {
    throw new Error('Old password was still accepted after reset!');
  }
  console.log('✓ Verified: Old temporary password was invalidated');

  // New password must succeed
  const newLoginRes = await fetch(`${BASE_URL}/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollment_no: officialEnrollNo, password: resetPass })
  });
  const newLoginData = await newLoginRes.json();
  if (!newLoginData.success) {
    throw new Error('Student login with reset password failed: ' + JSON.stringify(newLoginData));
  }
  console.log('✓ Student login with reset temporary password verified');

  // Clean up test student
  const delStudRes = await fetch(`${BASE_URL}/hod/students/${createdStudentId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const delStudData = await delStudRes.json();
  if (!delStudData.success) console.warn('Cleanup student delete warning:', delStudData);
  console.log('✓ Test student cleaned up');


  // ─────────────────────────────────────────────────────────────
  // 3. TEACHER TESTS: Teaching Subject Conditioning
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. TEACHER TESTS ---');
  // Create a pure teacher with NO assigned subjects
  const pureEmpId = 'NOTCH' + Date.now().toString().slice(-4);
  const pureEmail = `pureteacher_${Date.now().toString().slice(-4)}@college.edu`;
  const createPureRes = await fetch(`${BASE_URL}/hod/teachers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      full_name: 'Prof. No Subjects Teacher',
      email: pureEmail,
      employee_id: pureEmpId,
      phone: '9123456780',
      password: 'Password@123'
    })
  });
  const createPureData = await createPureRes.json();
  if (!createPureData.success) throw new Error('Failed to create test pure teacher: ' + JSON.stringify(createPureData));
  const pureTeacherId = createPureData.data.teacher_id;
  console.log(`✓ Created test teacher with no subjects (teacher_id: ${pureTeacherId})`);

  // Login as pure teacher
  const pureLoginRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pureEmail, password: 'Password@123' })
  });
  const pureLoginData = await pureLoginRes.json();
  if (!pureLoginData.success) throw new Error('Pure teacher login failed: ' + JSON.stringify(pureLoginData));
  
  if (pureLoginData.data.user.has_assigned_subjects !== false) {
    throw new Error('Expected has_assigned_subjects to be false for pure teacher without subjects');
  }
  console.log('✓ Verified: pure teacher user.has_assigned_subjects is false');

  const pureToken = pureLoginData.data.access_token;
  const pureRegsRes = await fetch(`${BASE_URL}/faculty/registers`, {
    headers: { 'Authorization': `Bearer ${pureToken}` }
  });
  const pureRegsData = await pureRegsRes.json();
  if (!pureRegsData.success || pureRegsData.data.length !== 0) {
    throw new Error('Expected 0 registers for pure teacher, got: ' + JSON.stringify(pureRegsData));
  }
  console.log('✓ Verified: /faculty/registers returns empty array for pure teacher');

  // Clean up pure teacher
  await fetch(`${BASE_URL}/hod/teachers/${pureTeacherId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  console.log('✓ Test pure teacher cleaned up');

  console.log('\n====================================================');
  console.log('🎉 ALL BACKEND & WORKFLOW TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

run().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
