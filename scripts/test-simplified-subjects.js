/**
 * Test script for verifying simplified hod-subjects.html
 * - No branch select in Add Subject modal (auto-bound to HOD's branch)
 * - No Assigned Faculty, Sessions, or + Assign button in the subjects table
 * - Clean curriculum management: Code, Title, Year, Sem, Edit & Delete
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

async function testSimplifiedSubjects() {
  console.log('=== VERIFYING SIMPLIFIED SUBJECTS WORKFLOW ===\n');

  // 1. Check HTML structure of hod-subjects.html
  console.log('[Step 1] Inspecting hod-subjects.html source code...');
  const htmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-subjects.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  // Assert NO branch select in #create-modal
  if (html.includes('id="s-branch"')) {
    throw new Error('FAILED: #s-branch should be removed from #create-modal!');
  }
  console.log('✓ Verified: Branch dropdown is completely removed from Add Subject modal.');

  // Assert NO Assigned Faculty, Sessions, or + Assign in table
  if (html.includes('<th>Assigned Faculty</th>')) {
    throw new Error('FAILED: <th>Assigned Faculty</th> should be removed!');
  }
  if (html.includes('<th>Sessions</th>')) {
    throw new Error('FAILED: <th>Sessions</th> should be removed!');
  }
  if (html.includes('+ Assign')) {
    throw new Error('FAILED: "+ Assign" button should be removed from subjects table!');
  }
  if (html.includes('id="assign-modal"')) {
    throw new Error('FAILED: #assign-modal should be removed from hod-subjects.html!');
  }
  if (html.includes('openAssignModal')) {
    throw new Error('FAILED: openAssignModal function should be removed from hod-subjects.html!');
  }
  console.log('✓ Verified: Assigned Faculty, Sessions, and + Assign button removed from table and code.');

  // 2. Test Backend: Create subject without branch_id
  console.log('\n[Step 2] Testing backend POST /api/v1/hod/subjects without branch_id...');
  const loginRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('HOD login failed: ' + JSON.stringify(loginData));
  const token = loginData.data.access_token;

  const testCode = 'CS' + (700 + Math.floor(Math.random() * 200));
  const createRes = await fetch(`${BASE_URL}/hod/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      code: testCode,
      name: 'Principles of Programming Languages',
      year: 2,
      semester: 4
    })
  });
  const createData = await createRes.json();
  if (!createData.success) throw new Error('Create subject without branch_id failed: ' + JSON.stringify(createData));
  console.log('Created subject response:', createData.data);
  if (!createData.data.branch_id) {
    throw new Error('Expected branch_id to be auto-bound to HOD department branch');
  }
  console.log(`✓ Backend automatically bound subject to HOD department branch (branch_id=${createData.data.branch_id}).`);

  // 3. Test JSDOM rendering
  console.log('\n[Step 3] Testing JSDOM rendering of hod-subjects.html...');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:3000/faculty/hod-subjects.html'
  });
  const { window } = dom;
  const { document } = window;

  window.user = { id: 2, full_name: 'Dr. Rajesh Sharma (HOD)', role: 'TEACHER' };
  window.getCurrentUser = () => window.user;
  window.getAuthToken = () => token;
  window.showToast = () => {};

  const testSubjects = [
    { id: 1, code: 'IT501', name: 'Database Management Systems', year: 3, semester: 5, branch_name: 'IT' },
    { id: 2, code: 'IT502', name: 'Operating Systems', year: 3, semester: 5, branch_name: 'IT' }
  ];

  window.allSubjects = testSubjects;
  window.renderSubjects(testSubjects);

  const table = document.querySelector('.custom-table');
  if (!table) throw new Error('Table should be rendered');
  const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
  console.log('Rendered table headers:', headers);

  if (headers.includes('Assigned Faculty') || headers.includes('Sessions')) {
    throw new Error('Headers should not contain Assigned Faculty or Sessions');
  }

  const rows = table.querySelectorAll('tbody tr');
  if (rows.length !== 2) throw new Error('Expected 2 rows');

  // Check buttons in row: only Edit and Delete
  const actionBtns = Array.from(rows[0].querySelectorAll('button')).map(b => b.textContent.trim());
  console.log('Row action buttons:', actionBtns);
  if (actionBtns.some(b => b.includes('Assign'))) {
    throw new Error('Action buttons should not contain Assign button');
  }
  console.log('✓ Verified: Table renders only Code, Subject Title, Academic Year, Semester, and Edit/Delete actions.');

  // Clean up created subject
  await fetch(`${BASE_URL}/hod/subjects/${createData.data.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('✓ Test subject cleaned up.');

  console.log('\n==============================================');
  console.log(' ALL SIMPLIFIED SUBJECT TESTS PASSED! 🎉');
  console.log('==============================================');
}

testSimplifiedSubjects().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
