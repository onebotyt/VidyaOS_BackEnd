const BASE_URL = 'http://localhost:3000/api/v1';

async function testAll() {
  console.log('=== SYSTEM INTEGRATION VERIFICATION ===\n');

  // 1. Admin Login
  console.log('1. Testing Admin Login...');
  const adminRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const adminData = await adminRes.json();
  if (!adminRes.ok) throw new Error('Admin login failed: ' + JSON.stringify(adminData));
  const adminToken = adminData.data.access_token;
  console.log('   ✓ Admin logged in:', adminData.data.user.full_name, '| Roles:', adminData.data.user.roles);

  // 1b. Admin Get HODs
  const hodsRes = await fetch(`${BASE_URL}/admin/hods`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const hodsData = await hodsRes.json();
  console.log('   ✓ HODs listed by Admin:', hodsData.data.length, 'departments administered.');

  // 2. HOD IT Login (Dr. Girdhar Dhami / bdhami015@gmail.com)
  console.log('\n2. Testing HOD IT Login (Dr. Girdhar Dhami)...');
  const hodRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bdhami015@gmail.com', password: 'Demo@1234' })
  });
  const hodData = await hodRes.json();
  if (!hodRes.ok) throw new Error('HOD login failed: ' + JSON.stringify(hodData));
  const hodToken = hodData.data.access_token;
  console.log('   ✓ HOD logged in:', hodData.data.user.full_name, '| Dept:', hodData.data.user.hod_department_name, '| is_hod:', hodData.data.user.is_hod);

  // 2b. HOD Hierarchy & Teachers
  const hierRes = await fetch(`${BASE_URL}/hod/hierarchy`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const hierData = await hierRes.json();
  console.log('   ✓ HOD Department:', hierData.data.department_name, '| Branches:', hierData.data.branches.length);

  const tRes = await fetch(`${BASE_URL}/hod/teachers`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const tData = await tRes.json();
  console.log('   ✓ Department Teachers:', tData.data.length);

  // 3. Class Teacher Login (Prof. Priya Mehta)
  console.log('\n3. Testing Class Teacher Login (Prof. Priya Mehta)...');
  const ctRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'priya.mehta@college.edu', password: 'Demo@1234' })
  });
  const ctData = await ctRes.json();
  if (!ctRes.ok) throw new Error('Class Teacher login failed: ' + JSON.stringify(ctData));
  const ctToken = ctData.data.access_token;
  console.log('   ✓ Class Teacher logged in:', ctData.data.user.full_name, '| is_class_teacher:', ctData.data.user.is_class_teacher);

  // 3b. Class Teacher Cohort
  const cohortsRes = await fetch(`${BASE_URL}/faculty/cohorts`, {
    headers: { Authorization: `Bearer ${ctToken}` }
  });
  const cohortsData = await cohortsRes.json();
  console.log('   ✓ Assigned Cohorts:', cohortsData.data.length);

  // 4. Student Login (2024IT001)
  console.log('\n4. Testing Student Login (2024IT001)...');
  const studRes = await fetch(`${BASE_URL}/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollment_no: '2024IT001', password: 'Student@2024' })
  });
  const studData = await studRes.json();
  if (!studRes.ok) throw new Error('Student login failed: ' + JSON.stringify(studData));
  const studToken = studData.data.access_token;
  console.log('   ✓ Student logged in:', studData.data.user.full_name, '| Enrollment:', studData.data.user.official_enrollment_no);

  // 4b. Student Profile & Attendance Stats
  const meRes = await fetch(`${BASE_URL}/students/me`, {
    headers: { Authorization: `Bearer ${studToken}` }
  });
  const meData = await meRes.json();
  console.log('   ✓ Student Profile loaded:', meData.data.full_name, '| Roll:', meData.data.class_roll_no, '| Dept:', meData.data.department_name);

  const statsRes = await fetch(`${BASE_URL}/students/me/attendance/stats`, {
    headers: { Authorization: `Bearer ${studToken}` }
  });
  const statsData = await statsRes.json();
  console.log('   ✓ Student Stats loaded: Attendance:', statsData.data.current_percentage + '%', '| Conducted:', statsData.data.total_conducted, '| Attended:', statsData.data.total_attended);

  console.log('\n=== ALL TESTS PASSED WITH ZERO ERRORS ===');
}

testAll().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
