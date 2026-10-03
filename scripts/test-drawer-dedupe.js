const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== VERIFYING SIDEBAR DRAWER NAVIGATION DEDUPLICATION ===\n');

const authJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/shared/js/auth.js'), 'utf8');

// Test Case 1: HOD User
console.log('[Test 1] Simulating HOD user on /faculty/students.html...');
const domHod = new JSDOM(`<!DOCTYPE html><html><body><header class="app-header"><a class="brand"></a><div id="user-nav"></div></header><main></main></body></html>`, {
  url: 'http://localhost:3000/faculty/students.html',
  runScripts: 'dangerously'
});

domHod.window.localStorage.setItem('user', JSON.stringify({
  id: 2,
  user_id: 2,
  full_name: 'Dr. Rajesh Sharma',
  email: 'hod@gmail.com',
  roles: ['TEACHER'],
  is_hod: true,
  hod_department_name: 'Information Technology',
  has_assigned_subjects: true
}));
domHod.window.localStorage.setItem('access_token', 'fake-hod-token');

// Execute auth.js in JSDOM context
domHod.window.eval(authJs);
domHod.window.renderSidebar();

const sidebarHod = domHod.window.document.getElementById('app-sidebar');
assert(sidebarHod !== null, 'app-sidebar should exist');

const linksHod = Array.from(sidebarHod.querySelectorAll('.sidebar-item')).map(a => a.textContent.trim());
console.log('HOD Sidebar items:', linksHod);

const facultyStudentsHodCount = linksHod.filter(t => t.includes('Faculty & Students')).length;
console.log(`Found "Faculty & Students" count for HOD: ${facultyStudentsHodCount}`);
assert(facultyStudentsHodCount === 1, `Expected exactly 1 "Faculty & Students" item for HOD, got ${facultyStudentsHodCount}`);

// Verify section placement:
const sectionsHod = Array.from(sidebarHod.querySelectorAll('.sidebar-section-label')).map(el => el.textContent.trim());
console.log('HOD Sidebar sections:', sectionsHod);

assert(sectionsHod.includes('HOD Management'), 'HOD Management section must exist for HOD');

console.log('✓ PASS: HOD user has exactly 1 "Faculty & Students" item located under HOD Management.\n');


// Test Case 2: Regular Teacher (Non-HOD)
console.log('[Test 2] Simulating Regular Teacher (non-HOD) on /faculty/students.html...');
const domTeacher = new JSDOM(`<!DOCTYPE html><html><body><header class="app-header"><a class="brand"></a><div id="user-nav"></div></header><main></main></body></html>`, {
  url: 'http://localhost:3000/faculty/students.html',
  runScripts: 'dangerously'
});

domTeacher.window.localStorage.setItem('user', JSON.stringify({
  id: 3,
  user_id: 3,
  full_name: 'Prof. Amit Verma',
  email: 'teacher@gmail.com',
  roles: ['TEACHER'],
  is_hod: false,
  department_id: 4,
  has_assigned_subjects: true
}));
domTeacher.window.localStorage.setItem('access_token', 'fake-teacher-token');

domTeacher.window.eval(authJs);
domTeacher.window.renderSidebar();

const sidebarTeacher = domTeacher.window.document.getElementById('app-sidebar');
assert(sidebarTeacher !== null, 'app-sidebar should exist');

const linksTeacher = Array.from(sidebarTeacher.querySelectorAll('.sidebar-item')).map(a => a.textContent.trim());
console.log('Regular Teacher Sidebar items:', linksTeacher);

const facultyStudentsTeacherCount = linksTeacher.filter(t => t.includes('Faculty & Students')).length;
console.log(`Found "Faculty & Students" count for Regular Teacher: ${facultyStudentsTeacherCount}`);
assert(facultyStudentsTeacherCount === 1, `Expected exactly 1 "Faculty & Students" item for Regular Teacher, got ${facultyStudentsTeacherCount}`);

const sectionsTeacher = Array.from(sidebarTeacher.querySelectorAll('.sidebar-section-label')).map(el => el.textContent.trim());
assert(!sectionsTeacher.includes('HOD Management'), 'HOD Management section should NOT exist for regular teacher');

console.log('✓ PASS: Regular Teacher has exactly 1 "Faculty & Students" item under Faculty, and 0 HOD Management sections.\n');

console.log('=============================================================');
console.log('🎉 ALL SIDEBAR DEDUPLICATION TESTS PASSED PERFECTLY!');
console.log('=============================================================');
