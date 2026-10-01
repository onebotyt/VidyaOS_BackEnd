const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

const BASE_URL = 'http://localhost:3000';

async function runArchiveTests() {
  console.log('=== TESTING HOD ALUMNI ARCHIVE & PASSOUT COMPLETION LIFECYCLE ===\n');

  // Pre-test cleanup
  const cleanupPRN = '2024ITGRAD01';
  const existingUsers = await query("SELECT id FROM users WHERE username IN ('2024ITGRAD01', '2024CSEGRAD01') OR email = 'rhea.kapoor@student.local'");
  for (const u of existingUsers) {
    const uid = u.id;
    await query('DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE user_id = ?)', [uid]);
    await query('DELETE FROM students WHERE user_id = ?', [uid]);
    await query('DELETE FROM user_roles WHERE user_id = ?', [uid]);
    await query('DELETE FROM users WHERE id = ?', [uid]);
  }
  await query("UPDATE departments SET active_term = 'EVEN', degree_duration_years = 3 WHERE code = 'IT'");

  // [Step 1] Login as IT HOD
  console.log('[Step 1] Logging in as IT HOD (hod@gmail.com)...');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('HOD login failed: ' + JSON.stringify(loginData));
  const hodToken = loginData.data.access_token;
  console.log('✓ HOD logged in successfully.');

  // [Step 2] Enroll a final-year graduating student (Year 3, Semester 6)
  console.log('\n[Step 2] Enrolling final-year graduating student (Year 3, Sem 6)...');
  const addRes = await fetch(`${BASE_URL}/api/v1/hod/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      official_enrollment_no: cleanupPRN,
      full_name: 'Rhea Kapoor',
      email: 'rhea.kapoor@student.local',
      year: 3,
      semester: 6
    })
  });
  const addData = await addRes.json();
  if (!addData.success) throw new Error('Failed to enroll student: ' + JSON.stringify(addData));
  const rheaStudentId = addData.data.student_id;
  console.log(`✓ Enrolled Rhea Kapoor (PRN: ${cleanupPRN}) in Year 3 Sem 6 with Roll ${addData.data.class_roll_no}`);

  // [Step 3] Execute Year-End Promotion to Graduate Final-Year Students
  console.log('\n[Step 3] Executing 1-Click Year-End Promotion (EVEN -> Next ODD)...');
  const promoRes = await fetch(`${BASE_URL}/api/v1/hod/promotion/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ exceptions: [], confirm_code: 'IT' })
  });
  const promoData = await promoRes.json();
  if (!promoData.success) throw new Error('Promotion failed: ' + JSON.stringify(promoData));
  console.log('✓ Promotion completed:', promoData.message);
  console.log('   Stats:', promoData.data);
  if (promoData.data.graduated_count < 1) {
    throw new Error('Expected at least 1 student to graduate in year-end rollover');
  }

  // [Step 4] Verify Database Archival State for Graduated Student
  console.log('\n[Step 4] Verifying database records for graduated student...');
  const stRows = await query(
    `SELECT s.id, s.official_enrollment_no, s.full_name, s.graduation_year,
            e.status as enrollment_status, u.status as user_status
     FROM students s
     JOIN users u ON s.user_id = u.id
     JOIN enrollments e ON s.id = e.student_id
     WHERE s.id = ?`,
    [rheaStudentId]
  );
  if (!stRows.length) throw new Error('Student record not found in database');
  const rhea = stRows[0];
  console.log('   Archived Record:', rhea);
  if (rhea.enrollment_status !== 'COMPLETED') throw new Error(`Expected enrollment_status 'COMPLETED', got '${rhea.enrollment_status}'`);
  if (rhea.user_status !== 'ALUMNI') throw new Error(`Expected user_status 'ALUMNI', got '${rhea.user_status}'`);
  if (!rhea.graduation_year) throw new Error('Expected graduation_year to be populated');
  console.log(`✓ Student successfully archived as ALUMNI with graduation_year ${rhea.graduation_year}!`);

  // [Step 5] Test GET /api/v1/hod/archive/batches
  console.log('\n[Step 5] Testing GET /api/v1/hod/archive/batches...');
  const bRes = await fetch(`${BASE_URL}/api/v1/hod/archive/batches`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const bData = await bRes.json();
  if (!bData.success) throw new Error('Failed to get archive batches: ' + JSON.stringify(bData));
  console.log('   Available Batches:', bData.data);
  if (!bData.data.includes(rhea.graduation_year)) {
    throw new Error(`Expected batch ${rhea.graduation_year} in batch list`);
  }
  console.log('✓ Archive batches endpoint returned correct graduation years.');

  // [Step 6] Test GET /api/v1/hod/archive and Search / Filter
  console.log('\n[Step 6] Testing GET /api/v1/hod/archive with search & batch filters...');
  const archRes = await fetch(`${BASE_URL}/api/v1/hod/archive?batch_year=${rhea.graduation_year}&search=Rhea`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const archData = await archRes.json();
  if (!archData.success) throw new Error('Failed to get archive list: ' + JSON.stringify(archData));
  console.log(`   Archive Records Found: ${archData.data.length}, Total Graduated: ${archData.kpis.total_graduated}`);
  const foundRhea = archData.data.find(s => s.official_enrollment_no === cleanupPRN);
  if (!foundRhea) throw new Error('Rhea Kapoor not found in archive query');
  console.log('   Alumni Details:', {
    name: foundRhea.full_name,
    prn: foundRhea.official_enrollment_no,
    grad_year: foundRhea.graduation_year,
    cohort: `Year ${foundRhea.final_year} Sem ${foundRhea.final_semester}`,
    attendance: `${foundRhea.attendance_percentage}%`,
    status: foundRhea.user_status
  });
  console.log('✓ GET /api/v1/hod/archive returned complete alumni transcript data.');

  // [Step 7] Verify DOM of hod-archive.html
  console.log('\n[Step 7] Verifying DOM elements in hod-archive.html...');
  const htmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-archive.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  const requiredTokens = [
    'id="kpi-total-alumni"',
    'id="kpi-batches-count"',
    'id="kpi-avg-attendance"',
    'id="filter-batch"',
    'id="filter-search"',
    'id="archive-tbody"',
    'id="details-modal"',
    'exportArchiveCSV'
  ];
  for (const token of requiredTokens) {
    if (!htmlContent.includes(token)) {
      throw new Error(`Missing required element or function in hod-archive.html: ${token}`);
    }
  }
  console.log('✓ Verified: hod-archive.html contains all KPI cards, batch selectors, table, modal, and CSV export handlers.');

  // [Step 8] Verify Navigation Links across HOD Pages
  console.log('\n[Step 8] Verifying Archive navigation links across all HOD portal pages...');
  const pages = [
    'frontend/faculty/hod-students.html',
    'frontend/faculty/hod-subjects.html',
    'frontend/faculty/hod-teachers.html',
    'frontend/faculty/hod-reports.html'
  ];
  for (const p of pages) {
    const pContent = fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
    if (!pContent.includes('hod-archive.html')) {
      throw new Error(`Archive link missing in ${p}`);
    }
  }
  console.log('✓ Verified: All 4 HOD portal pages link directly to hod-archive.html.');

  // Cleanup
  console.log('\n[Cleanup] Cleaning up test records...');
  await query('DELETE FROM enrollments WHERE student_id = ?', [rheaStudentId]);
  await query('DELETE FROM students WHERE id = ?', [rheaStudentId]);
  await query('DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [cleanupPRN]);
  await query('DELETE FROM users WHERE username = ?', [cleanupPRN]);
  await query("UPDATE departments SET active_term = 'ODD', degree_duration_years = 3 WHERE code = 'IT'");
  console.log('✓ Test cleanup complete.');

  console.log('\n================================================================');
  console.log(' ALL HOD ALUMNI ARCHIVE & PASSOUT LIFECYCLE TESTS PASSED! 🎉');
  console.log('================================================================');
}

runArchiveTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
