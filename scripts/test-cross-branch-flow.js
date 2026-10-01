/**
 * Automated test script for cross-branch subject assignment & HOD report visibility
 */
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');
const path = require('path');

const db = new DatabaseSync(path.resolve(__dirname, '../college_attendance.sqlite'));

const BASE_URL = 'http://localhost:3000/api/v1';

async function run() {
  console.log('=== STARTING CROSS-BRANCH ASSIGNMENT TEST ===\n');

  // 1. Ensure IT Department (id=2), Branch (id=2), Subject (IT501), and IT HOD exist in DB
  const passHash = await bcrypt.hash('Password@123', 10);
  
  db.exec(`
    INSERT OR IGNORE INTO departments (id, name, code, is_active)
    VALUES (2, 'Information Technology', 'IT', 1);

    INSERT OR IGNORE INTO branches (id, department_id, name, code, is_active)
    VALUES (2, 2, 'Information Technology', 'IT', 1);

    INSERT OR REPLACE INTO subjects (id, department_id, branch_id, year, semester, name, code, is_active)
    VALUES (50, 2, 2, 3, 5, 'Web Technologies', 'IT501', 1);

    INSERT OR IGNORE INTO users (id, username, email, password_hash, temp_password_hash, must_change_password, status)
    VALUES (99, 'hod.it@gmail.com', 'hod.it@gmail.com', '${passHash}', '${passHash}', 0, 'ACTIVE');

    INSERT OR IGNORE INTO user_roles (user_id, role)
    VALUES (99, 'TEACHER');

    INSERT OR IGNORE INTO teachers (id, user_id, department_id, full_name, employee_id)
    VALUES (99, 99, 2, 'Dr. Sunita Rao (IT HOD)', 'IT-HOD-01');

    INSERT OR IGNORE INTO teacher_assignments (id, teacher_id, assignment_type, session_type_scope, department_id, branch_id, year, semester, academic_year_id, assigned_by)
    VALUES (99, 99, 'HOD', 'ALL', 2, 2, 1, 1, 1, 1);
  `);
  console.log('✓ IT department, branch, subject, and IT HOD verified in DB.\n');

  // 2. Login as CSE HOD
  console.log('[Step 1] Logging in as CSE HOD (hod@gmail.com)...');
  const loginRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('CSE HOD login failed: ' + JSON.stringify(loginData));
  const cseToken = loginData.data.access_token;
  console.log('✓ CSE HOD login success.\n');

  // 3. Test GET /api/v1/hod/hierarchy
  console.log('[Step 2] Testing GET /api/v1/hod/hierarchy...');
  const hierRes = await fetch(`${BASE_URL}/hod/hierarchy`, {
    headers: { 'Authorization': `Bearer ${cseToken}` }
  });
  const hierData = await hierRes.json();
  console.log('Hierarchy response:', {
    dept_id: hierData.data.department_id,
    user_branch_id: hierData.data.user_branch_id,
    total_branches: hierData.data.branches?.length,
    branches: hierData.data.branches?.map(b => `${b.code} (${b.department_name})`),
    total_subjects: hierData.data.subjects?.length,
    subjects: hierData.data.subjects?.map(s => `${s.code} [Branch: ${s.branch_code}]`)
  });

  if (hierData.data.department_id !== 1) throw new Error('Expected CSE dept 1');
  if (hierData.data.user_branch_id !== 1) throw new Error('Expected default CSE branch 1');
  if (!hierData.data.branches.some(b => b.id === 2)) throw new Error('IT branch should be in branches list');
  if (!hierData.data.subjects.some(s => s.code === 'IT501')) throw new Error('IT501 should be in subjects list');
  console.log('✓ Hierarchy returns all branches, all subjects, and default branch id.\n');

  // 4. Assign CSE Teacher (Prof. Priya Mehta, teacher_id 2) to IT Subject (IT501, id 50, branch 2)
  console.log('[Step 3] Assigning CSE teacher (id=2) to IT subject (IT501, id=50, branch=2)...');
  const assignRes = await fetch(`${BASE_URL}/hod/assignments/subject-teacher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cseToken}`
    },
    body: JSON.stringify({
      teacher_id: 2,
      subject_id: 50,
      session_type_scope: 'THEORY',
      branch_id: 2,
      year: 3,
      semester: 5
    })
  });
  const assignData = await assignRes.json();
  console.log('Assignment response:', assignData);
  if (!assignData.success) throw new Error('Assignment failed: ' + JSON.stringify(assignData));
  console.log('✓ Cross-branch assignment created successfully!\n');

  // 5. Verify database records for register department
  const reg = db.prepare(`SELECT * FROM attendance_registers WHERE id = ?`).get(assignData.data.register_id);
  console.log('Created register in DB:', reg);
  if (reg.department_id !== 2) throw new Error('Register department_id must be 2 (IT)');
  if (reg.branch_id !== 2) throw new Error('Register branch_id must be 2 (IT)');
  console.log('✓ Register properly assigned to IT department & branch.\n');

  // 6. Login as IT HOD (hod.it@gmail.com)
  console.log('[Step 4] Logging in as IT HOD (hod.it@gmail.com)...');
  const itLoginRes = await fetch(`${BASE_URL}/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod.it@gmail.com', password: 'Password@123' })
  });
  const itLoginData = await itLoginRes.json();
  if (!itLoginData.success) throw new Error('IT HOD login failed: ' + JSON.stringify(itLoginData));
  const itToken = itLoginData.data.access_token;
  console.log('✓ IT HOD login success.\n');

  // 7. Verify IT HOD sees this subject assignment in Department Assignments
  console.log('[Step 5] Checking IT Department Assignments (GET /api/v1/hod/assignments)...');
  const asgnRes = await fetch(`${BASE_URL}/hod/assignments`, {
    headers: { 'Authorization': `Bearer ${itToken}` }
  });
  const asgnData = await asgnRes.json();
  console.log('IT HOD assignments count:', asgnData.data?.length);
  const itAssignment = (asgnData.data || []).find(a => a.subject_code === 'IT501');
  if (!itAssignment) throw new Error('IT HOD must see IT501 assignment in Department Assignments');
  console.log('IT Assignment card data:', {
    subject_code: itAssignment.subject_code,
    subject_name: itAssignment.subject_name,
    teacher_name: itAssignment.teacher_name,
    branch_name: itAssignment.branch_name,
    year: itAssignment.year,
    semester: itAssignment.semester,
    session_type_scope: itAssignment.session_type_scope
  });
  if (itAssignment.teacher_name !== 'Prof. Priya Mehta (Class Teacher)') {
    throw new Error('Expected teacher_name to be Prof. Priya Mehta (Class Teacher)');
  }
  console.log('✓ IT HOD successfully sees the CSE teacher teaching IT501 in Department Assignments!\n');

  // 8. Verify CSE HOD sees the assignment on Prof. Priya Mehta's card
  console.log('[Step 6] Checking CSE teacher card details (GET /api/v1/hod/teachers/2)...');
  const teacherRes = await fetch(`${BASE_URL}/hod/teachers/2`, {
    headers: { 'Authorization': `Bearer ${cseToken}` }
  });
  const teacherData = await teacherRes.json();
  const itChip = teacherData.data.assignments.find(a => a.subject_code === 'IT501');
  if (!itChip) throw new Error('CSE HOD should see IT501 assignment chip on teacher card');
  console.log('Teacher assignment chip:', {
    subject_code: itChip.subject_code,
    session_type_scope: itChip.session_type_scope,
    branch_name: itChip.branch_name
  });
  console.log('✓ CSE HOD sees IT501 on teacher card.\n');

  console.log('==============================================');
  console.log(' ALL CROSS-BRANCH WORKFLOW TESTS PASSED! 🎉');
  console.log('==============================================');
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
