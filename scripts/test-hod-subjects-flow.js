/**
 * Automated test script for HOD Subjects page and API enhancements
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

async function run() {
  console.log('=== STARTING HOD SUBJECTS WORKFLOW TESTS ===\n');

  // 1. Log in as IT HOD
  console.log('[Step 1] Logging in as IT HOD (hod@gmail.com)...');
  const loginRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('IT HOD login failed: ' + JSON.stringify(loginData));
  const cseToken = loginData.data.access_token;
  console.log('✓ IT HOD login success.\n');

  // 2. Test enriched GET /api/v1/hod/subjects
  console.log('[Step 2] Testing enriched GET /api/v1/hod/subjects...');
  const subRes = await fetch(`${BASE_URL}/hod/subjects`, {
    headers: { Authorization: `Bearer ${cseToken}` }
  });
  const subData = await subRes.json();
  if (!subData.success) throw new Error('GET /subjects failed: ' + JSON.stringify(subData));
  console.log(`✓ Fetched ${subData.data.length} subjects.`);
  
  const sample = subData.data[0];
  console.log('Sample subject with assignments:', {
    code: sample.code,
    name: sample.name,
    branch_name: sample.branch_name,
    year: sample.year,
    semester: sample.semester,
    assignments_count: sample.assignments?.length,
    assigned_teachers: sample.assignments?.map(a => `${a.session_type_scope}: ${a.teacher_name}`),
    finalized_sessions: sample.total_finalized_sessions
  });
  if (!Array.isArray(sample.assignments)) throw new Error('Expected assignments array on subject');
  console.log('✓ Subjects returned with enriched assignments and session counts.\n');

  // 3. Test creating a new subject
  console.log('[Step 3] Creating new subject CS504 (Cloud Computing)...');
  const testCode = 'CS' + (500 + Math.floor(Math.random() * 400));
  const createRes = await fetch(`${BASE_URL}/hod/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cseToken}`
    },
    body: JSON.stringify({
      code: testCode,
      name: 'Cloud Computing & Distributed Systems',
      branch_id: 1,
      year: 3,
      semester: 5
    })
  });
  const createData = await createRes.json();
  if (!createData.success) throw new Error('Create subject failed: ' + JSON.stringify(createData));
  const newSubId = createData.data.id;
  console.log(`✓ Subject created with ID: ${newSubId}\n`);

  // 4. Test updating the subject
  console.log('[Step 4] Updating subject name via PUT /api/v1/hod/subjects/:id...');
  const updateRes = await fetch(`${BASE_URL}/hod/subjects/${newSubId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cseToken}`
    },
    body: JSON.stringify({
      name: 'Cloud Computing and DevOps',
      year: 3,
      semester: 6
    })
  });
  const updateData = await updateRes.json();
  if (!updateData.success) throw new Error('Update subject failed: ' + JSON.stringify(updateData));
  console.log('✓ Subject updated successfully.\n');

  // 5. Test assigning a faculty member to this subject
  console.log('[Step 5] Assigning faculty to new subject...');
  const assignRes = await fetch(`${BASE_URL}/hod/assignments/subject-teacher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cseToken}`
    },
    body: JSON.stringify({
      teacher_id: 2,
      subject_id: newSubId,
      session_type_scope: 'THEORY',
      branch_id: 4,
      year: 3,
      semester: 6
    })
  });
  const assignData = await assignRes.json();
  if (!assignData.success) throw new Error('Assign faculty failed: ' + JSON.stringify(assignData));
  console.log('✓ Faculty assigned to new subject.\n');

  // 6. Verify GET /subjects now reflects this assignment
  console.log('[Step 6] Verifying assignment is reflected in GET /subjects...');
  const subRes2 = await fetch(`${BASE_URL}/hod/subjects`, {
    headers: { Authorization: `Bearer ${cseToken}` }
  });
  const subData2 = await subRes2.json();
  const foundSub = subData2.data.find(s => s.id === newSubId);
  if (!foundSub) throw new Error('Created subject not found in list');
  if (foundSub.name !== 'Cloud Computing and DevOps') throw new Error('Subject name should be updated');
  if (!foundSub.assignments.some(a => a.teacher_name.includes('Rajesh Sharma'))) {
    throw new Error('Assigned teacher should appear in subject assignments');
  }
  console.log('✓ New subject correctly shows assigned faculty in list.\n');

  // 7. Test dummy subject creation and deletion
  const dummyCode = 'DUM' + Math.floor(Math.random() * 900 + 100);
  console.log(`[Step 7] Testing create and delete for dummy subject ${dummyCode}...`);
  const dummyRes = await fetch(`${BASE_URL}/hod/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cseToken}`
    },
    body: JSON.stringify({
      code: dummyCode,
      name: 'Temporary Elective',
      branch_id: 4,
      year: 3,
      semester: 6
    })
  });
  const dummyData = await dummyRes.json();
  if (!dummyData.success) throw new Error('Create dummy failed: ' + JSON.stringify(dummyData));
  const dummyId = dummyData.data.id;

  const delRes = await fetch(`${BASE_URL}/hod/subjects/${dummyId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cseToken}` }
  });
  const delData = await delRes.json();
  if (!delData.success) throw new Error('Delete dummy subject failed: ' + JSON.stringify(delData));
  console.log('✓ Dummy subject deleted/deactivated successfully.\n');

  // 8. Test DOM elements and UI logic in JSDOM
  console.log('[Step 8] Testing hod-subjects.html DOM and Modals with JSDOM...');
  const htmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-subjects.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Verify dead links are gone
  if (htmlContent.includes('/faculty/hod-assignments.html')) {
    throw new Error('FAILED: hod-subjects.html should not contain dead link to /faculty/hod-assignments.html');
  }
  console.log('✓ Dead link to hod-assignments.html removed.');

  const dom = new JSDOM(htmlContent, {
    runScripts: 'dangerously',
    url: 'http://localhost:3000/faculty/hod-subjects.html',
    beforeParse(win) {
      win.guardRoute = () => true;
      win.fetchApi = async () => ({ success: true, data: [] });
      win.showToast = () => {};
      win.user = { id: 2, full_name: 'Dr. Rajesh Sharma (HOD)', role: 'TEACHER' };
      win.getCurrentUser = () => win.user;
      win.getAuthToken = () => cseToken;
    }
  });
  const { window } = dom;
  const { document } = window;

  window.branches = [{ id: 4, name: 'Information Technology', code: 'IT' }];
  window.teachers = [{ id: 2, full_name: 'Dr. Rajesh Sharma (HOD)', gmail: 'hod@gmail.com' }];
  window.allSubjects = subData2.data;

  // Test rendering subjects table
  window.renderSubjects(window.allSubjects);
  const table = document.querySelector('.custom-table');
  if (!table) throw new Error('Custom table should be rendered');
  const rows = table.querySelectorAll('tbody tr');
  console.log(`✓ Table rendered with ${rows.length} subject rows.`);

  // Test openCreateModal
  window.openCreateModal();
  const createModal = document.getElementById('create-modal');
  if (!createModal.classList.contains('open')) throw new Error('Create modal should open');
  console.log('✓ Create Subject modal opens correctly.');
  window.closeCreateModal();

  // Test openEditModal
  window.openEditModal(newSubId);
  const editModal = document.getElementById('edit-modal');
  if (!editModal.classList.contains('open')) throw new Error('Edit modal should open');
  const editCode = document.getElementById('edit-code').value;
  if (editCode !== testCode) throw new Error(`Edit modal should pre-populate code ${testCode}, got ${editCode}`);
  console.log('✓ Edit Subject modal opens correctly with pre-filled values.');

  // Step 9: Clean up created test subject and associated records to avoid DB pollution
  console.log('\n[Step 9] Cleaning up test subject and associated records...');
  const { query: dbQuery } = require('../src/config/db');
  await dbQuery(`DELETE FROM attendance_registers WHERE subject_id = ?`, [newSubId]);
  await dbQuery(`DELETE FROM teacher_assignments WHERE subject_id = ?`, [newSubId]);
  await dbQuery(`DELETE FROM subjects WHERE id = ?`, [newSubId]);
  console.log('✓ Test subject, assignments, and registers cleaned up successfully.');

  console.log('\n==============================================');
  console.log(' ALL HOD SUBJECTS WORKFLOW TESTS PASSED! 🎉');
  console.log('==============================================');
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
