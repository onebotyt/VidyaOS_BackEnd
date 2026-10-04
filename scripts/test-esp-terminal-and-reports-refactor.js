/**
 * Comprehensive verification script for:
 * 1. Admin Department Attendance Reports (Aggregated cohort_summary from ESP Attendance, no raw records table)
 * 2. Moving ESP Terminals to HOD (Department HOD management, devices registry, biometric scan records)
 * 3. HOD Devices API (GET, POST, PATCH toggle, DELETE) and strict authorization checks
 * 4. Admin Navbar cleanup (no ESP32 Terminals link) and URL redirects
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';
const ROOT_URL = 'http://localhost:3000';

async function run() {
  console.log('================================================================');
  console.log(' STARTING ESP TERMINALS & DEPARTMENT REPORTS REFACTOR TESTS');
  console.log('================================================================\n');

  async function login(email, password) {
    const res = await fetch(`${BASE_URL}/auth/faculty/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!data.success) throw new Error(`Login failed for ${email}: ` + JSON.stringify(data));
    return data.data.access_token;
  }

  // -------------------------------------------------------------
  // Test 1: Admin Department Report with ESP cohort_summary
  // -------------------------------------------------------------
  console.log('[Test 1] Testing Admin Department Attendance Report (cohort_summary from ESP)...');
  const adminToken = await login('admin@gmail.com', 'Admin@123');
  const adminRes = await fetch(`${BASE_URL}/admin/reports/department?department_id=1`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminData = await adminRes.json();
  if (!adminData.success) throw new Error('Admin report failed: ' + JSON.stringify(adminData));

  console.log('✓ Admin report API returned successfully.');
  console.log('  Department:', adminData.data.department?.name);
  console.log('  KPIs:', adminData.data.kpis);
  console.log('  Cohort summary count:', adminData.data.cohort_summary?.length);

  if (!Array.isArray(adminData.data.cohort_summary) || adminData.data.cohort_summary.length === 0) {
    throw new Error('Expected non-empty cohort_summary array in admin report response');
  }

  const sampleCohort = adminData.data.cohort_summary[0];
  console.log('  Sample cohort summary row:', {
    branch_name: sampleCohort.branch_name,
    year: sampleCohort.year,
    semester: sampleCohort.semester,
    enrolled_students: sampleCohort.enrolled_students,
    present_students: sampleCohort.present_students,
    attendance_percentage: sampleCohort.attendance_percentage,
    status: sampleCohort.status
  });

  if (typeof sampleCohort.attendance_percentage !== 'number') {
    throw new Error('Expected numeric attendance_percentage in cohort_summary');
  }

  // -------------------------------------------------------------
  // Test 2: HOD Devices Management Endpoint (/api/v1/hod/devices)
  // -------------------------------------------------------------
  console.log('\n[Test 2] Testing HOD Devices API (/api/v1/hod/devices)...');
  const hodToken = await login('hod@gmail.com', 'Password@123');

  // List devices
  const listRes = await fetch(`${BASE_URL}/hod/devices`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const listData = await listRes.json();
  if (!listData.success) throw new Error('HOD devices list failed: ' + JSON.stringify(listData));
  console.log(`✓ HOD devices fetched successfully. Found ${listData.data.length} registered terminals in HOD department.`);

  // Register new device as HOD
  const testUid = `ESP32_HOD_TEST_${Date.now().toString().slice(-4)}`;
  console.log(`  Registering test hardware terminal: ${testUid}...`);
  const createRes = await fetch(`${BASE_URL}/hod/devices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_uid: testUid,
      name: 'HOD Test Biometric Gate',
      branch_id: 1,
      year: 2,
      semester: 3,
      academic_year_id: 1,
      secret_token: 'hod-terminal-secret-test'
    })
  });
  const createData = await createRes.json();
  if (!createData.success) throw new Error('HOD device creation failed: ' + JSON.stringify(createData));
  const createdDevice = createData.data;
  console.log('✓ Device registered successfully by HOD:', {
    id: createdDevice.id,
    uid: createdDevice.device_uid,
    name: createdDevice.name,
    dept_id: createdDevice.department_id
  });

  // Verify device is in HOD list
  const listAgainRes = await fetch(`${BASE_URL}/hod/devices`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const listAgainData = await listAgainRes.json();
  const found = listAgainData.data.find(d => d.id === createdDevice.id);
  if (!found) throw new Error(`Created device ${createdDevice.id} not found in HOD devices list`);
  console.log('✓ Created device verified in HOD department listing.');

  // Toggle device status
  const toggleRes = await fetch(`${BASE_URL}/hod/devices/${createdDevice.id}/toggle`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const toggleData = await toggleRes.json();
  if (!toggleData.success) throw new Error('Failed to toggle device status: ' + JSON.stringify(toggleData));
  console.log(`✓ Device status toggled successfully to is_active: ${toggleData.data.is_active}`);

  // Delete test device
  const delRes = await fetch(`${BASE_URL}/hod/devices/${createdDevice.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const delData = await delRes.json();
  if (!delData.success) throw new Error('Failed to delete test device: ' + JSON.stringify(delData));
  console.log('✓ Test hardware terminal cleaned up and deleted successfully.');

  // -------------------------------------------------------------
  // Test 3: Security & Authorization (Non-HOD Teacher Forbidden)
  // -------------------------------------------------------------
  console.log('\n[Test 3] Testing security: regular teacher forbidden from HOD devices API...');
  const teacherToken = await login('teacher@gmail.com', 'Password@123');

  const teachListRes = await fetch(`${BASE_URL}/hod/devices`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  if (teachListRes.status !== 403) {
    throw new Error(`Expected HTTP 403 for non-HOD teacher on GET /hod/devices, got: ${teachListRes.status}`);
  }

  const teachCreateRes = await fetch(`${BASE_URL}/hod/devices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${teacherToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_uid: 'HACK_UID',
      name: 'Unauthorized Terminal',
      branch_id: 1,
      year: 1,
      semester: 1,
      academic_year_id: 1
    })
  });
  if (teachCreateRes.status !== 403) {
    throw new Error(`Expected HTTP 403 for non-HOD teacher on POST /hod/devices, got: ${teachCreateRes.status}`);
  }
  console.log('✓ Non-HOD teacher is strictly forbidden from accessing or creating devices (HTTP 403).');

  // -------------------------------------------------------------
  // Test 4: Verify Admin Navbars & Redirects
  // -------------------------------------------------------------
  console.log('\n[Test 4] Verifying Admin UI Navbars and Redirects...');
  const adminFiles = [
    'frontend/admin/reports.html',
    'frontend/admin/academic-structure.html',
    'frontend/admin/faculty.html',
    'frontend/admin/students.html',
    'frontend/admin/settings.html',
    'frontend/admin/audit.html',
    'frontend/admin/dashboard.html'
  ];

  for (const relPath of adminFiles) {
    const fullPath = path.resolve(__dirname, '../../', relPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    // Check that active navbar does not link to devices.html
    const navMatch = content.match(/<nav[\s\S]*?<\/nav>/i);
    if (navMatch && navMatch[0].includes('devices.html')) {
      throw new Error(`Found unauthorized link to devices.html in <nav> of ${relPath}`);
    }
  }
  console.log('✓ Verified: All Admin navigation bars have removed "ESP32 Terminals" link.');

  // Check admin/reports.html has Department Attendance Summary table
  const reportsHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/admin/reports.html'), 'utf-8');
  if (!reportsHtml.includes('Department Attendance Summary')) {
    throw new Error('admin/reports.html missing Department Attendance Summary section');
  }
  if (!reportsHtml.includes('id="table-wrap"') || !reportsHtml.includes('renderSummaryTable')) {
    throw new Error('admin/reports.html missing #table-wrap or renderSummaryTable');
  }
  console.log('✓ Verified: admin/reports.html includes Department Attendance Summary from ESP attendance.');

  // Check hod-devices.html contains Biometric ESP32 Presence Records and Hardware Kiosks registry
  const hodDevicesHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/faculty/hod-devices.html'), 'utf-8');
  if (!hodDevicesHtml.includes('Biometric ESP32 Presence Records')) {
    throw new Error('faculty/hod-devices.html missing Biometric ESP32 Presence Records table');
  }
  if (!hodDevicesHtml.includes('id="devices-tbody"')) {
    throw new Error('faculty/hod-devices.html missing #devices-tbody for hardware registry');
  }
  if (!hodDevicesHtml.includes('Register Hardware Terminal')) {
    throw new Error('faculty/hod-devices.html missing Register Hardware Terminal button/modal');
  }
  console.log('✓ Verified: faculty/hod-devices.html includes both Hardware Kiosks registry and Biometric ESP32 Presence Records.');

  // Check redirects from /admin/devices.html and /admin/devices
  const redirRes1 = await fetch(`${ROOT_URL}/admin/devices.html`, { redirect: 'manual' });
  console.log(`  /admin/devices.html status: ${redirRes1.status}, location: ${redirRes1.headers.get('location')}`);
  if (redirRes1.status !== 302 && redirRes1.status !== 301) {
    throw new Error(`Expected redirect (301/302) for /admin/devices.html, got: ${redirRes1.status}`);
  }
  if (!redirRes1.headers.get('location').includes('/faculty/hod-devices.html')) {
    throw new Error(`Expected redirect location to /faculty/hod-devices.html, got: ${redirRes1.headers.get('location')}`);
  }

  const redirRes2 = await fetch(`${ROOT_URL}/admin/devices`, { redirect: 'manual' });
  console.log(`  /admin/devices status: ${redirRes2.status}, location: ${redirRes2.headers.get('location')}`);
  if (redirRes2.status !== 302 && redirRes2.status !== 301) {
    throw new Error(`Expected redirect (301/302) for /admin/devices, got: ${redirRes2.status}`);
  }

  console.log('✓ Verified: Legacy device URLs automatically redirect to HOD hardware terminal management.');

  console.log('\n================================================================');
  console.log(' ALL ESP TERMINALS & REPORTS REFACTOR TESTS PASSED! 🎉');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n❌ REFACTOR TEST FAILED:', err);
  process.exit(1);
});
