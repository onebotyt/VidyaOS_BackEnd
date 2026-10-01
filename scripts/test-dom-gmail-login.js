const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING DOM FOR GMAIL LOGIN PAGES ===\n');

// 1. Check faculty.html
const facultyHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/login/faculty.html'), 'utf8');
const hasFacultyGmailLabel = facultyHtml.includes('Gmail Address') || facultyHtml.includes('Institutional Gmail');
const hasFacultyEmailType = facultyHtml.includes('type="email" id="username"');
const hasFacultyPlaceholder = facultyHtml.includes('placeholder="e.g. admin@gmail.com, hod@gmail.com, teacher@gmail.com"');
const hasFacultySubmitEmail = facultyHtml.includes('email: emailVal');

console.log('--- Checking faculty.html ---');
console.log('1. Has Gmail label:', hasFacultyGmailLabel ? '✓ PASS' : '✗ FAIL');
console.log('2. Has email input type for username:', hasFacultyEmailType ? '✓ PASS' : '✗ FAIL');
console.log('3. Has Gmail placeholder:', hasFacultyPlaceholder ? '✓ PASS' : '✗ FAIL');
console.log('4. Submit handler sends email:', hasFacultySubmitEmail ? '✓ PASS' : '✗ FAIL');

if (!hasFacultyGmailLabel || !hasFacultyEmailType || !hasFacultySubmitEmail) {
  console.error('faculty.html DOM validation failed!');
  process.exit(1);
}

// 2. Check student.html
const studentHtml = fs.readFileSync(path.resolve(__dirname, '../../frontend/login/student.html'), 'utf8');
const hasStudentGmailLabel = studentHtml.includes('Student Gmail Address');
const hasStudentEmailType = studentHtml.includes('type="email" id="enrollment_no"');
const hasStudentPlaceholder = studentHtml.includes('placeholder="e.g. student1@gmail.com"');
const hasStudentSubmitEmail = studentHtml.includes('email: emailVal');
const hasNoUpperCase = !studentHtml.includes('.toUpperCase()');

console.log('\n--- Checking student.html ---');
console.log('1. Has Student Gmail Address label:', hasStudentGmailLabel ? '✓ PASS' : '✗ FAIL');
console.log('2. Has email input type:', hasStudentEmailType ? '✓ PASS' : '✗ FAIL');
console.log('3. Has student1@gmail.com placeholder:', hasStudentPlaceholder ? '✓ PASS' : '✗ FAIL');
console.log('4. Submit handler sends email:', hasStudentSubmitEmail ? '✓ PASS' : '✗ FAIL');
console.log('5. Uppercase transform removed from submit:', hasNoUpperCase ? '✓ PASS' : '✗ FAIL');

if (!hasStudentGmailLabel || !hasStudentEmailType || !hasStudentSubmitEmail || !hasNoUpperCase) {
  console.error('student.html DOM validation failed!');
  process.exit(1);
}

console.log('\n=== ALL DOM CHECKS PASSED 100%! ===');
