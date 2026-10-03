const fs = require('fs');
const path = require('path');
const assert = require('assert');

const frontendDir = path.resolve(__dirname, '../../frontend');

// 1. Academic Structure
const acadStr = fs.readFileSync(path.join(frontendDir, 'admin/academic-structure.html'), 'utf8');
assert(!acadStr.includes('Course Duration (Years)'), 'Course Duration (Years) still in academic-structure.html');
console.log('✓ frontend/admin/academic-structure.html checked: No Course Duration form field.');

// 2. Faculty HOD Management Delete Button & Modal
const facStr = fs.readFileSync(path.join(frontendDir, 'admin/faculty.html'), 'utf8');
assert(facStr.includes('openDeleteModal'), 'openDeleteModal missing from faculty.html');
assert(facStr.includes('id="delete-modal"'), 'delete-modal missing from faculty.html');
assert(facStr.includes('submitDeleteHOD'), 'submitDeleteHOD missing from faculty.html');
console.log('✓ frontend/admin/faculty.html checked: Delete HOD button and confirmation modal present.');

// 3. HOD Students Credentials & Reset Modals
const studStr = fs.readFileSync(path.join(frontendDir, 'faculty/hod-students.html'), 'utf8');
assert(studStr.includes('id="cred-modal"'), 'cred-modal missing from hod-students.html');
assert(studStr.includes('id="reset-student-modal"'), 'reset-student-modal missing from hod-students.html');
assert(studStr.includes('id="bulk-result-modal"'), 'bulk-result-modal missing from hod-students.html');
assert(studStr.includes('openResetStudentModal'), 'openResetStudentModal missing from hod-students.html');
console.log('✓ frontend/faculty/hod-students.html checked: Credentials slip, bulk summary, and reset modals present.');

// 4. Dead links & deleted prototype checks
assert(!fs.existsSync(path.join(frontendDir, 'faculty/dashboard-advanced.html')), 'dashboard-advanced.html should be deleted');
console.log('✓ frontend/faculty/dashboard-advanced.html checked: File successfully removed.');

const dashStr = fs.readFileSync(path.join(frontendDir, 'faculty/dashboard.html'), 'utf8');
assert(!dashStr.includes('/faculty/dashboard-advanced.html'), 'Dead link to dashboard-advanced.html found in dashboard.html');
assert(!dashStr.includes('/faculty/hod-assignments.html'), 'Dead link to hod-assignments.html found in dashboard.html');
assert(dashStr.includes('id="no-subjects-banner"'), 'no-subjects-banner missing from dashboard.html');
assert(dashStr.includes('teaching-registers-tile'), 'teaching-registers-tile missing from dashboard.html');
console.log('✓ frontend/faculty/dashboard.html checked: Conditional teaching modules & no-subjects-banner present.');

// 5. HOD Teachers Subject Scoping
const hodTeachStr = fs.readFileSync(path.join(frontendDir, 'faculty/hod-teachers.html'), 'utf8');
assert(hodTeachStr.includes('String(s.department_id) === String(currentDeptId)'), 'Department filter missing in hod-teachers.html');
console.log('✓ frontend/faculty/hod-teachers.html checked: Subject dropdowns strictly scoped to department.');

console.log('\n🎉 ALL FRONTEND DOM AND CONTRACT CHECKS PASSED!');
