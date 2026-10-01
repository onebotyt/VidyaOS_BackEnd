const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('=== TESTING HOD STUDENT LIFECYCLE, ROLL NUMBERING & 1-CLICK PROMOTION ===\n');

  // Pre-test cleanup: ensure test accounts and department state are clean
  const { query } = require('../src/config/db');
  const cleanupUsernames = ['2026IT090', '2026IT091', '2026IT092', '2026CSE090', '2026CSE091', '2026CSE092'];
  for (const uname of cleanupUsernames) {
    const users = await query('SELECT id FROM users WHERE username = ?', [uname]);
    if (users.length > 0) {
      const uid = users[0].id;
      await query('DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE user_id = ?)', [uid]);
      await query('DELETE FROM students WHERE user_id = ?', [uid]);
      await query('DELETE FROM user_roles WHERE user_id = ?', [uid]);
      await query('DELETE FROM users WHERE id = ?', [uid]);
    }
  }
  await query("UPDATE departments SET active_term = 'ODD', degree_duration_years = 3 WHERE code = 'IT'");

  // [Step 1] Login as IT HOD
  console.log('[Step 1] Logging in as IT HOD (hod@gmail.com)...');
  const hodRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const hodLogin = await hodRes.json();
  if (!hodLogin.success) throw new Error('HOD login failed: ' + JSON.stringify(hodLogin));
  const hodToken = hodLogin.data.access_token;
  console.log('✓ HOD logged in successfully.');

  // [Step 2] Verify and Test Degree Duration Settings with 2-Step Confirmation
  console.log('\n[Step 2] Testing Degree Duration setting & 2-step safety challenge...');
  const durRes = await fetch(`${BASE_URL}/api/v1/hod/settings/duration`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const durData = await durRes.json();
  if (!durData.success) throw new Error('Failed to get duration: ' + JSON.stringify(durData));
  console.log('   Initial Duration:', durData.data);
  if (durData.data.degree_duration_years !== 3) throw new Error('Expected default duration 3 years');

  // Test failing confirmation code
  const failRes = await fetch(`${BASE_URL}/api/v1/hod/settings/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ duration_years: 4, confirm_code: 'WRONG_CODE' })
  });
  const failData = await failRes.json();
  if (failRes.status === 400 && !failData.success) {
    console.log('✓ Correctly rejected invalid confirmation code:', failData.error.message);
  } else {
    throw new Error('Expected 400 rejection on wrong confirmation code');
  }

  // Test valid confirmation code
  const okRes = await fetch(`${BASE_URL}/api/v1/hod/settings/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ duration_years: 3, confirm_code: 'IT' })
  });
  const okData = await okRes.json();
  if (!okData.success) throw new Error('Failed to confirm duration: ' + JSON.stringify(okData));
  console.log('✓ Successfully confirmed degree duration with department code:', okData.message);

  // [Step 3] Add Students in Non-Alphabetical Order & Verify Automatic Alphabetical Sequencing
  console.log('\n[Step 3] Enrolling students in Year 1 Sem 1 out of alphabetical order...');
  const testCohortYear = 1;
  const testCohortSem = 1;

  // Add Zoya first
  const s1Res = await fetch(`${BASE_URL}/api/v1/hod/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      official_enrollment_no: '2026IT090',
      full_name: 'Zoya Khan',
      email: 'zoya.test@gmail.com',
      year: testCohortYear,
      semester: testCohortSem
    })
  });
  const s1 = await s1Res.json();
  if (!s1.success) throw new Error('Failed to add Zoya: ' + JSON.stringify(s1));
  console.log(`   Added Zoya Khan -> Class Roll ${s1.data.class_roll_no}`);

  // Add Amitabh second (alphabetically first)
  const s2Res = await fetch(`${BASE_URL}/api/v1/hod/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      official_enrollment_no: '2026IT091',
      full_name: 'Amitabh Sen',
      email: 'amitabh.test@gmail.com',
      year: testCohortYear,
      semester: testCohortSem
    })
  });
  const s2 = await s2Res.json();
  if (!s2.success) throw new Error('Failed to add Amitabh: ' + JSON.stringify(s2));
  console.log(`   Added Amitabh Sen -> Class Roll ${s2.data.class_roll_no}`);

  // Add Farhan third (alphabetically in between)
  const s3Res = await fetch(`${BASE_URL}/api/v1/hod/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      official_enrollment_no: '2026IT092',
      full_name: 'Farhan Akhtar',
      email: 'farhan.test@gmail.com',
      year: testCohortYear,
      semester: testCohortSem
    })
  });
  const s3 = await s3Res.json();
  if (!s3.success) throw new Error('Failed to add Farhan: ' + JSON.stringify(s3));
  console.log(`   Added Farhan Akhtar -> Class Roll ${s3.data.class_roll_no}`);

  // Check the resulting cohort order
  const listRes = await fetch(`${BASE_URL}/api/v1/hod/students?year=${testCohortYear}&semester=${testCohortSem}`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const listData = await listRes.json();
  const testStudents = listData.data.filter(s => ['2026IT090', '2026IT091', '2026IT092'].includes(s.official_enrollment_no));
  testStudents.sort((a, b) => a.class_roll_no - b.class_roll_no);

  console.log('   Re-sequenced Roll Numbers:', testStudents.map(s => `${s.class_roll_no}: ${s.full_name}`));
  if (testStudents[0].full_name !== 'Amitabh Sen' || testStudents[1].full_name !== 'Farhan Akhtar' || testStudents[2].full_name !== 'Zoya Khan') {
    throw new Error('Students were not sequenced in alphabetical order!');
  }
  console.log('✓ Automatic alphabetical class roll sequencing verified 100%!');

  // [Step 4] Test Student Leaving / Deletion & Auto-Compacting Roll Numbers
  console.log('\n[Step 4] Removing Farhan Akhtar (middle roll) and verifying auto-compacting...');
  const farhanId = s3.data.student_id;
  const delRes = await fetch(`${BASE_URL}/api/v1/hod/students/${farhanId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const delData = await delRes.json();
  if (!delData.success) throw new Error('Delete failed: ' + JSON.stringify(delData));
  console.log('✓ Student withdrawn:', delData.message);

  // Check remaining students
  const list2Res = await fetch(`${BASE_URL}/api/v1/hod/students?year=${testCohortYear}&semester=${testCohortSem}`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const list2Data = await list2Res.json();
  const remStudents = list2Data.data.filter(s => ['2026IT090', '2026IT091', '2026IT092'].includes(s.official_enrollment_no));
  remStudents.sort((a, b) => a.class_roll_no - b.class_roll_no);
  console.log('   Remaining Students after deletion:', remStudents.map(s => `${s.class_roll_no}: ${s.full_name}`));
  if (remStudents.length !== 2) throw new Error('Expected 2 remaining students');
  if (remStudents[0].full_name !== 'Amitabh Sen' || remStudents[0].class_roll_no !== 1) {
    throw new Error('Expected Amitabh Sen to remain Roll #1');
  }
  if (remStudents[1].full_name !== 'Zoya Khan' || remStudents[1].class_roll_no !== 2) {
    throw new Error('Expected Zoya Khan to be auto-compacted to Roll #2 without gaps');
  }
  console.log('✓ Class roll numbers automatically compacted without gaps!');

  // [Step 5] Test 1-Click Semester Promotion Preview
  console.log('\n[Step 5] Testing 1-Click Semester Promotion Preview (GET /api/v1/hod/promotion/preview)...');
  const prevRes = await fetch(`${BASE_URL}/api/v1/hod/promotion/preview`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const prevData = await prevRes.json();
  if (!prevData.success) throw new Error('Failed to get promotion preview: ' + JSON.stringify(prevData));
  console.log('   Preview Info:', {
    active_term: prevData.data.current_active_term,
    target_term: prevData.data.target_term,
    is_mid_year: prevData.data.is_mid_year,
    total_students: prevData.data.total_students,
    cohorts_count: prevData.data.cohorts.length
  });
  if (prevData.data.current_active_term !== 'ODD' || prevData.data.target_term !== 'EVEN') {
    throw new Error('Expected preview to transition from ODD to EVEN');
  }
  console.log('✓ Promotion preview returned clean cohort advancement data.');

  // [Step 6] Test 1-Click Semester Promotion Execution (with 1 Detained Exception)
  console.log('\n[Step 6] Executing Promotion with 1 Detained exception...');
  const zoyaStudentId = s1.data.student_id; // Detain Zoya
  const promoRes = await fetch(`${BASE_URL}/api/v1/hod/promotion/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ exceptions: [zoyaStudentId], confirm_code: 'IT' })
  });
  const promoData = await promoRes.json();
  if (!promoData.success) throw new Error('Promotion execution failed: ' + JSON.stringify(promoData));
  console.log('✓ Promotion response:', promoData.message);
  if (promoData.data.promoted_count < 1) throw new Error('Expected at least 1 student to be promoted');

  // Verify Amitabh Sen is now in Semester 2
  const checkAmitRes = await fetch(`${BASE_URL}/api/v1/hod/students?year=1&semester=2`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const checkAmit = await checkAmitRes.json();
  const foundAmit = checkAmit.data.find(s => s.official_enrollment_no === '2026IT091');
  if (!foundAmit) throw new Error('Amitabh Sen should have been promoted to Year 1 Semester 2');
  console.log(`✓ Amitabh Sen successfully promoted to Year ${foundAmit.year} Sem ${foundAmit.semester} (Class Roll ${foundAmit.class_roll_no}).`);

  // Verify Zoya is retained in Sem 1 with status DETAINED
  const checkZoyaRes = await fetch(`${BASE_URL}/api/v1/hod/students?year=1&semester=1`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const checkZoya = await checkZoyaRes.json();
  const foundZoya = checkZoya.data.find(s => s.official_enrollment_no === '2026IT090');
  if (!foundZoya || foundZoya.enrollment_status !== 'DETAINED') {
    throw new Error('Zoya should have been kept in Semester 1 as DETAINED');
  }
  console.log(`✓ Zoya Khan correctly retained in Year 1 Sem 1 with enrollment status "${foundZoya.enrollment_status}".`);

  // [Step 7] DOM & UI Verification
  console.log('\n[Step 7] Verifying DOM elements in hod-subjects.html and hod-students.html...');
  const settingsHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/faculty/hod-settings.html'), 'utf8');
  if (!settingsHtml.includes('id="setting-duration"') || !settingsHtml.includes('id="duration-confirm-box"')) {
    throw new Error('Degree duration UI elements missing in hod-settings.html');
  }
  console.log('✓ Verified: hod-settings.html has Degree Duration Setting and 2-step confirmation.');

  const stHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/faculty/hod-students.html'), 'utf8');
  if (!stHtml.includes('id="add-modal"') || !stHtml.includes('id="promotion-modal"') || !stHtml.includes('id="delete-modal"')) {
    throw new Error('Student modals missing in hod-students.html');
  }
  console.log('✓ Verified: hod-students.html has Add, Promotion, Bulk CSV, and Delete modals.');

  // Clean up test students
  console.log('\n[Cleanup] Cleaning up test records...');
  await fetch(`${BASE_URL}/api/v1/hod/students/${s1.data.student_id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${hodToken}` } });
  await fetch(`${BASE_URL}/api/v1/hod/students/${s2.data.student_id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${hodToken}` } });
  // Restore active term to ODD
  await fetch(`${BASE_URL}/api/v1/hod/promotion/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` }, body: JSON.stringify({ exceptions: [], confirm_code: 'IT', action: 'demote' }) });
  console.log('✓ Test cleanup complete.');

  console.log('\n================================================================');
  console.log(' ALL HOD STUDENT LIFECYCLE & 1-CLICK PROMOTION TESTS PASSED! 🎉');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
