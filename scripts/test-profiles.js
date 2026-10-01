const { query } = require('../src/config/db');
const { generateAccessToken } = require('../src/utils/tokenHelper');

async function testProfiles() {
  console.log('=== VERIFYING USER PROFILES UPGRADE ===\n');

  // 1. Fetch HTML pages
  const pages = [
    '/faculty/profile.html',
    '/student/profile.html',
    '/admin/profile.html'
  ];

  for (const page of pages) {
    const res = await fetch(`http://localhost:3000${page}`);
    if (res.status !== 200) {
      throw new Error(`Failed to load ${page}: status ${res.status}`);
    }
    const html = await res.text();
    console.log(`✓ [HTML] ${page} loaded successfully (${html.length} bytes)`);
    
    if (page === '/faculty/profile.html') {
      if (!html.includes('id="stat-registers"') || !html.includes('id="hero-badges"') || !html.includes('id="assignments-tbody"')) {
        throw new Error('faculty/profile.html missing key metrics or elements');
      }
      console.log('  ✓ faculty/profile.html contains role badges, metrics, and allocations table');
    }
    if (page === '/student/profile.html') {
      if (!html.includes('attendance-health-card') || !html.includes('id="health-pct"') || !html.includes('id="health-exam-standing"')) {
        throw new Error('student/profile.html missing attendance health gauge or eligibility badge');
      }
      console.log('  ✓ student/profile.html contains 75% attendance health gauge & exam eligibility status');
    }
    if (page === '/admin/profile.html') {
      if (!html.includes('id="stat-dept"') || !html.includes('id="admin-profile-form"') || !html.includes('id="admin-pass-form"')) {
        throw new Error('admin/profile.html missing governance stats or admin forms');
      }
      console.log('  ✓ admin/profile.html contains governance metrics strip and admin management forms');
    }
  }

  console.log('\n2. Testing Backend Profile Endpoints...');

  // Faculty User & Token
  const teachers = await query(`
    SELECT u.*, t.id as teacher_id, t.department_id 
    FROM users u 
    JOIN teachers t ON u.id = t.user_id 
    LIMIT 1
  `);
  const teacherUser = teachers && teachers[0];
  if (teacherUser) {
    const teacherToken = generateAccessToken({
      id: teacherUser.id,
      username: teacherUser.username,
      roles: ['TEACHER']
    });
    const fRes = await fetch('http://localhost:3000/api/v1/faculty/profile', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    const fData = await fRes.json();
    if (fRes.status === 200 && fData.success) {
      console.log('✓ GET /api/v1/faculty/profile returned:');
      console.log(`  - Department: ${fData.data.department_name || 'Assigned'} (${fData.data.department_code || 'N/A'})`);
      console.log(`  - Active Registers: ${fData.data.active_registers_count}`);
      console.log(`  - Enrolled Students: ${fData.data.total_students_count}`);
      console.log(`  - Role Flags: is_hod=${fData.data.is_hod}, is_class_teacher=${fData.data.is_class_teacher}`);
      console.log(`  - Assignments Count: ${(fData.data.assignments || []).length}`);
    } else {
      throw new Error(`GET /api/v1/faculty/profile failed: ${JSON.stringify(fData)}`);
    }
  } else {
    console.log('ℹ No teacher user in db, skipped teacher API test');
  }

  // Student User & Token
  const students = await query(`
    SELECT u.*, s.id as student_id, s.official_enrollment_no 
    FROM users u 
    JOIN students s ON u.id = s.user_id 
    LIMIT 1
  `);
  const studentUser = students && students[0];
  if (studentUser) {
    const studentToken = generateAccessToken({
      id: studentUser.id,
      username: studentUser.username,
      roles: ['STUDENT']
    });
    const sRes = await fetch('http://localhost:3000/api/v1/students/me', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const sData = await sRes.json();
    if (sRes.status === 200 && sData.success) {
      console.log('✓ GET /api/v1/students/me returned:');
      console.log(`  - Enrollment No: ${sData.data.official_enrollment_no}`);
      console.log(`  - Class Teacher: ${sData.data.class_teacher_name || 'None Assigned'}`);
      console.log(`  - Attendance %: ${sData.data.attendance_stats ? sData.data.attendance_stats.percentage + '%' : 'N/A'}`);
      console.log(`  - Biometric Tag: ${sData.data.rfid_tag || 'None'}`);
    } else {
      throw new Error(`GET /api/v1/students/me failed: ${JSON.stringify(sData)}`);
    }
  } else {
    console.log('ℹ No student user in db, skipped student API test');
  }

  // Admin User & Token
  const admins = await query(`
    SELECT u.* FROM users u 
    JOIN user_roles ur ON u.id = ur.user_id 
    WHERE ur.role = 'SYSTEM_ADMIN' 
    LIMIT 1
  `);
  const adminUser = admins && admins[0];
  if (adminUser) {
    const adminToken = generateAccessToken({
      id: adminUser.id,
      username: adminUser.username,
      roles: ['SYSTEM_ADMIN']
    });
    const aRes = await fetch('http://localhost:3000/api/v1/admin/profile', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const aData = await aRes.json();
    if (aRes.status === 200 && aData.success) {
      console.log('✓ GET /api/v1/admin/profile returned:');
      console.log(`  - Admin Email: ${aData.data.email}`);
      console.log(`  - Departments Count: ${aData.data.metrics.departments_count}`);
      console.log(`  - Teachers Count: ${aData.data.metrics.teachers_count}`);
      console.log(`  - Students Count: ${aData.data.metrics.students_count}`);
      console.log(`  - Registers Count: ${aData.data.metrics.registers_count}`);
      console.log(`  - ESP32 Devices Count: ${aData.data.metrics.devices_count}`);
    } else {
      throw new Error(`GET /api/v1/admin/profile failed: ${JSON.stringify(aData)}`);
    }

    // Test PUT /api/v1/admin/profile
    const putRes = await fetch('http://localhost:3000/api/v1/admin/profile', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: adminUser.username,
        email: adminUser.email
      })
    });
    const putData = await putRes.json();
    if (putRes.status === 200 && putData.success) {
      console.log('✓ PUT /api/v1/admin/profile succeeded: profile updated safely');
    } else {
      throw new Error(`PUT /api/v1/admin/profile failed: ${JSON.stringify(putData)}`);
    }
  } else {
    console.log('ℹ No admin user in db, skipped admin API test');
  }

  // Test PUT /api/v1/faculty/profile
  if (teacherUser) {
    const teacherToken = generateAccessToken({
      id: teacherUser.id,
      username: teacherUser.username,
      roles: ['TEACHER']
    });
    const fPutRes = await fetch('http://localhost:3000/api/v1/faculty/profile', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        full_name: teacherUser.full_name || 'Prof. Amit Verma',
        phone: '9876543210'
      })
    });
    const fPutData = await fPutRes.json();
    if (fPutRes.status === 200 && fPutData.success) {
      console.log('✓ PUT /api/v1/faculty/profile succeeded: faculty profile updated safely');
    } else {
      throw new Error(`PUT /api/v1/faculty/profile failed: ${JSON.stringify(fPutData)}`);
    }
  }

  console.log('\n======================================================');
  console.log('🎉 ALL USER PROFILES UPGRADE CHECKS PASSED PERFECTLY!');
  console.log('======================================================\n');
}

testProfiles().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
