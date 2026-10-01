const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runDomTests() {
  console.log('--- Starting DOM Verification for Teacher No Subjects Pages ---');

  const facultyDir = path.join(__dirname, '../../frontend/faculty');
  const jsDir = path.join(__dirname, '../../frontend/js');

  // 1. Check dashboard.html
  const dashHtml = fs.readFileSync(path.join(facultyDir, 'dashboard.html'), 'utf8');
  assert(dashHtml.includes('id="no-subjects-banner"'), 'dashboard.html missing no-subjects-banner');
  assert(dashHtml.includes('id="teaching-registers-tile" style="display: none;"'), 'registers tile not initially hidden');
  assert(dashHtml.includes('id="teaching-assignments-tile" style="display: none;"'), 'assignments tile not initially hidden');
  assert(dashHtml.includes('id="teaching-reports-tile" style="display: none;"'), 'reports tile not initially hidden');
  assert(dashHtml.includes('updateTeachingTiles(hasSubjects)'), 'dashboard.html missing synchronous display init');
  assert(!dashHtml.includes("fetchApi('/hod/hierarchy')"), 'dashboard.html must not use fetchApi for hod hierarchy check');
  console.log('✓ Verified: frontend/faculty/dashboard.html tiles hidden initially, no 403 error toast, clean empty banner');

  // 2. Check registers.html
  const regHtml = fs.readFileSync(path.join(facultyDir, 'registers.html'), 'utf8');
  assert(regHtml.includes('id="nav-reg"'), 'registers.html missing nav-reg id');
  assert(regHtml.includes('id="nav-assign"'), 'registers.html missing nav-assign id');
  assert(regHtml.includes('id="nav-reports"'), 'registers.html missing nav-reports id');
  assert(regHtml.includes('No Teaching Registers Allocated Yet'), 'registers.html missing empty state banner');
  console.log('✓ Verified: frontend/faculty/registers.html empty state and nav IDs');

  // 3. Check assignments.html
  const assignHtml = fs.readFileSync(path.join(facultyDir, 'assignments.html'), 'utf8');
  assert(assignHtml.includes('id="nav-reg"'), 'assignments.html missing nav-reg id');
  assert(assignHtml.includes('id="nav-assign"'), 'assignments.html missing nav-assign id');
  assert(assignHtml.includes('id="nav-reports"'), 'assignments.html missing nav-reports id');
  assert(assignHtml.includes('No Teaching Classes Assigned Yet'), 'assignments.html missing empty state banner');
  assert(assignHtml.includes('initPage()'), 'assignments.html missing guarded initPage');
  console.log('✓ Verified: frontend/faculty/assignments.html empty state and guarded tabs');

  // 4. Check reports.html
  const repHtml = fs.readFileSync(path.join(facultyDir, 'reports.html'), 'utf8');
  assert(repHtml.includes('id="nav-reg"'), 'reports.html missing nav-reg id');
  assert(repHtml.includes('id="nav-assign"'), 'reports.html missing nav-assign id');
  assert(repHtml.includes('id="nav-reports"'), 'reports.html missing nav-reports id');
  assert(repHtml.includes('No Teaching Subjects Allocated Yet'), 'reports.html missing empty state banner');
  console.log('✓ Verified: frontend/faculty/reports.html empty state');

  // 5. Check auth.js drawer logic
  const authJs = fs.readFileSync(path.join(jsDir, 'auth.js'), 'utf8');
  assert(authJs.includes('if (user.is_class_teacher)'), 'auth.js should only show cohort when user is actually a class teacher');
  assert(authJs.includes('if (user.has_assigned_subjects)'), 'auth.js should only show subject pages when user has assigned subjects');
  console.log('✓ Verified: frontend/js/auth.js drawer navigation logic');

  // 6. Check hod-teachers.html unassign button
  const hodTeachersHtml = fs.readFileSync(path.join(facultyDir, 'hod-teachers.html'), 'utf8');
  assert(hodTeachersHtml.includes('deleteAssignment('), 'hod-teachers.html missing deleteAssignment caller');
  assert(hodTeachersHtml.includes('async function deleteAssignment('), 'hod-teachers.html missing deleteAssignment definition');
  console.log('✓ Verified: frontend/faculty/hod-teachers.html unassign subject capability');

  console.log('✅ ALL DOM AND FRONTEND CHECKS PASSED!');
}

runDomTests();
