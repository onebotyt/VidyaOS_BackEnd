/**
 * Test script for verifying hod-teachers.html DOM structure and direct subject assignment
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

async function testDom() {
  console.log('=== TESTING HOD-TEACHERS.HTML DOM & DIRECT SUBJECT ASSIGNMENT ===\n');

  const htmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-teachers.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // 1. Structure Assertions
  console.log('[Step 1] Verifying branch dropdown is removed and direct subject selection is present in #reassign-modal...');
  const reassignBranchIdx = htmlContent.indexOf('id="reassign-branch"');
  const reassignSubjectIdx = htmlContent.indexOf('id="reassign-subject"');
  const reassignScopeIdx = htmlContent.indexOf('id="reassign-scope"');
  const reassignYearIdx = htmlContent.indexOf('id="reassign-year"');
  const reassignSemIdx = htmlContent.indexOf('id="reassign-sem"');

  if (reassignBranchIdx !== -1) throw new Error('FAILED: #reassign-branch should NOT be present (Department and Branch are unified)!');
  if (reassignSubjectIdx === -1) throw new Error('Missing #reassign-subject');
  if (reassignSubjectIdx >= reassignScopeIdx) {
    throw new Error('FAILED: #reassign-subject must appear before #reassign-scope in DOM!');
  }
  console.log('✓ In #reassign-modal: Direct subject selection present, redundant branch dropdown eliminated.');

  console.log('\n[Step 2] Verifying branch dropdown is removed and direct subject selection is present in #create-modal...');
  const tBranchIdx = htmlContent.indexOf('id="t-branch"');
  const tSubjectIdx = htmlContent.indexOf('id="t-subject"');
  if (tBranchIdx !== -1) throw new Error('FAILED: #t-branch should NOT be present (Department and Branch are unified)!');
  if (tSubjectIdx === -1) throw new Error('Missing #t-subject');
  console.log('✓ In #create-modal: Direct subject selection present, redundant branch dropdown eliminated.');

  // 2. Interactive JSDOM Simulation
  console.log('\n[Step 3] Simulating interactive direct subject selection logic with JSDOM...');

  const dom = new JSDOM(htmlContent, {
    runScripts: 'dangerously',
    url: 'http://localhost:3000/faculty/hod-teachers.html'
  });

  const { window } = dom;
  const { document } = window;

  // Mock global user and API data
  window.user = { id: 2, full_name: 'Dr. Rajesh Sharma (HOD)', role: 'TEACHER', has_assigned_subjects: true };
  window.getCurrentUser = () => window.user;
  window.getAuthToken = () => 'test-token';
  window.esc = s => String(s || '');
  window.showToast = (msg, type) => console.log(`   [Toast] ${type}: ${msg}`);

  // Test data: subjects
  window.subjects = [
    { id: 1, branch_id: 1, department_id: 1, code: 'CS501', name: 'Database Management Systems', year: 3, semester: 5 },
    { id: 2, branch_id: 1, department_id: 1, code: 'CS502', name: 'Operating Systems', year: 3, semester: 5 },
    { id: 3, branch_id: 1, department_id: 1, code: 'CS503', name: 'Computer Networks', year: 3, semester: 5 },
    { id: 4, branch_id: 2, department_id: 2, code: 'IT501', name: 'Web Technologies', year: 3, semester: 5, department_name: 'Information Technology' }
  ];
  window.defaultBranchId = 1;

  // Run population function
  window.populateSubjectDropdowns();

  const rSubject = document.getElementById('reassign-subject');
  const rYear = document.getElementById('reassign-year');
  const rSem = document.getElementById('reassign-sem');

  console.log('   Subject options count:', rSubject.options.length);
  if (rSubject.options.length < 5) throw new Error('Expected placeholder + 4 subject options');

  // Open reassign modal for teacher 2 (Prof. Priya Mehta)
  window.openReassignModal(2, 'Prof. Priya Mehta (Class Teacher)');

  // Select CS502 and verify year and sem auto-population
  console.log('\n[Step 4] Selecting CS502 and verifying auto-fill...');
  rSubject.value = '2';
  window.onReassignSubjectChange('2');

  console.log('   Auto-populated Year:', rYear.value);
  console.log('   Auto-populated Sem:', rSem.value);
  if (String(rYear.value) !== '3') throw new Error('Expected auto-populated year to be 3');
  if (String(rSem.value) !== '5') throw new Error('Expected auto-populated sem to be 5');
  console.log('   ✓ Year 3 and Semester 5 successfully auto-populated when subject selected.');

  console.log('\n=============================================================');
  console.log(' ALL HOD-TEACHERS DOM & DIRECT SUBJECT ASSIGNMENT TESTS PASSED! 🎉');
  console.log('=============================================================');
}

testDom().catch(err => {
  console.error('\n❌ DOM TEST FAILED:', err.message);
  process.exit(1);
});
