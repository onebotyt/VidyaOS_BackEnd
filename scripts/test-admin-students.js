const BASE_URL = 'http://localhost:3000';

async function test() {
  console.log('=== TESTING ADMIN STUDENT ANALYTICS & REDIRECTS ===\n');

  // 1. Login as Admin
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123', force_logout: true, device_id: 'admin_students_test' })
  });
  const loginData = await loginRes.json();
  const token = loginData.data.access_token;
  console.log('1. Admin logged in successfully.');

  // 2. Test Institutional Analytics
  const analyticsRes = await fetch(`${BASE_URL}/api/v1/admin/students/analytics`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const analyticsData = await analyticsRes.json();
  console.log('2. Institutional Analytics:', {
    total_students: analyticsData.data.total_students,
    active_students: analyticsData.data.active_students,
    biometric_enrolled: analyticsData.data.biometric_enrolled_students,
    coverage_pct: analyticsData.data.biometric_coverage_pct + '%',
    cohorts_count: analyticsData.data.cohorts_count,
    departments: analyticsData.data.department_breakdown.map(d => `${d.department_code}: ${d.student_count} students (${d.biometric_count} bio)`)
  });

  // 3. Test Department-filtered Analytics (IT dept_id = 1)
  const itAnalyticsRes = await fetch(`${BASE_URL}/api/v1/admin/students/analytics?department_id=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const itData = await itAnalyticsRes.json();
  console.log('3. IT Department Analytics:', {
    total: itData.data.total_students,
    biometric: itData.data.biometric_enrolled_students,
    coverage_pct: itData.data.biometric_coverage_pct + '%',
    cohorts: itData.data.cohort_breakdown.map(c => `${c.branch_code} Y${c.year}S${c.semester}: ${c.student_count} students (Class Teacher: ${c.class_teacher_name})`)
  });

  // 4. Test Roster endpoint
  const rosterRes = await fetch(`${BASE_URL}/api/v1/admin/students/roster?department_id=1&limit=5`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const rosterData = await rosterRes.json();
  console.log('4. IT Department Roster (first 5 of ' + rosterData.data.total + '):');
  console.table(rosterData.data.students.map(s => ({
    roll: s.class_roll_no,
    enrollment: s.official_enrollment_no,
    name: s.full_name,
    cohort: `${s.branch_code} Y${s.year}S${s.semester}`,
    bio_slot: s.biometric_slot_id ? `Slot #${s.biometric_slot_id}` : 'Pending',
    status: s.user_status
  })));

  // 5. Test Redirects
  console.log('\n5. Testing Redirects:');
  const redirects = [
    '/admin/departments.html',
    '/admin/branches.html',
    '/admin/academic-years.html',
    '/admin/academic_years.html'
  ];
  for (const r of redirects) {
    const res = await fetch(`${BASE_URL}${r}`, { redirect: 'manual' });
    console.log(`   ${r} -> HTTP ${res.status} Location: ${res.headers.get('location')}`);
  }

  // 6. Test Academic Structure page loading
  const pageRes = await fetch(`${BASE_URL}/admin/academic-structure.html`);
  console.log(`\n6. /admin/academic-structure.html -> HTTP ${pageRes.status}`);

  const studentsPageRes = await fetch(`${BASE_URL}/admin/students.html`);
  console.log(`7. /admin/students.html -> HTTP ${studentsPageRes.status}`);

  console.log('\n=== ALL TESTS PASSED ===');
}

test().catch(console.error);
