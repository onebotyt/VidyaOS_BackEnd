const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.resolve(__dirname, '../college_attendance.sqlite'));

console.log('=== USERS COUNT ===');
const userCount = db.prepare('SELECT count(*) as count FROM users').get();
console.log('Total users:', userCount.count);

console.log('\n=== FACULTY USERS (users + teachers + user_roles) ===');
const faculty = db.prepare(`
  SELECT u.id, u.username, u.email, u.status, t.full_name, t.employee_id, d.name as dept_name,
         GROUP_CONCAT(ur.role) as roles
  FROM users u
  LEFT JOIN teachers t ON u.id = t.user_id
  LEFT JOIN departments d ON t.department_id = d.id
  LEFT JOIN user_roles ur ON u.id = ur.user_id
  WHERE ur.role IN ('TEACHER', 'SYSTEM_ADMIN') OR u.id <= 20
  GROUP BY u.id
  ORDER BY u.id ASC
`).all();
console.table(faculty);

console.log('\n=== HOD ASSIGNMENTS ===');
const hods = db.prepare(`
  SELECT ta.id, ta.teacher_id, t.full_name, d.name as dept_name, ta.assignment_type, ta.is_active
  FROM teacher_assignments ta
  JOIN teachers t ON ta.teacher_id = t.id
  JOIN departments d ON ta.department_id = d.id
  WHERE ta.assignment_type = 'HOD'
`).all();
console.table(hods);

console.log('\n=== STUDENTS SAMPLE (First 10) ===');
const students = db.prepare(`
  SELECT u.id as user_id, u.username, s.id as student_id, s.official_enrollment_no, s.full_name,
         e.class_roll_no, d.name as dept_name, e.year, e.semester
  FROM users u
  JOIN students s ON u.id = s.user_id
  LEFT JOIN enrollments e ON s.id = e.student_id
  LEFT JOIN departments d ON e.department_id = d.id
  ORDER BY u.id ASC
  LIMIT 10
`).all();
console.table(students);

console.log('\n=== STUDENTS TOTAL ===');
const studCount = db.prepare('SELECT count(*) as count FROM students').get();
console.log('Total students in students table:', studCount.count);
