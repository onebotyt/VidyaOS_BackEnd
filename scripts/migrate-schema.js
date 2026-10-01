/**
 * Schema Migration Script
 * Applies architecture updates to live SQLite database:
 *   1. departments.hod_user_id (optional HOD reference)
 *   2. teachers.department_id (home department)
 *   3. teachers.employee_id  → nullable (was NOT NULL)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, '../college_attendance.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = OFF;');

console.log('=== Schema Migration: Simplified Hierarchy ===');
console.log('Database:', dbPath);

// Step 1: Add hod_user_id to departments
const deptCols = db.prepare('PRAGMA table_info(departments)').all();
if (!deptCols.some(c => c.name === 'hod_user_id')) {
  db.exec('ALTER TABLE departments ADD COLUMN hod_user_id INTEGER REFERENCES users(id);');
  console.log('[OK] departments.hod_user_id column added');
} else {
  console.log('[SKIP] departments.hod_user_id already exists');
}

// Step 2: Add department_id to teachers
const teacherCols = db.prepare('PRAGMA table_info(teachers)').all();
if (!teacherCols.some(c => c.name === 'department_id')) {
  db.exec('ALTER TABLE teachers ADD COLUMN department_id INTEGER REFERENCES departments(id);');
  console.log('[OK] teachers.department_id column added');
} else {
  console.log('[SKIP] teachers.department_id already exists');
}

// Step 3: Make employee_id nullable - must recreate table in SQLite
const empIdCol = teacherCols.find(c => c.name === 'employee_id');
const empIdNotNull = empIdCol ? empIdCol.notnull : 0;
console.log('teachers.employee_id current notnull:', empIdNotNull);

if (empIdNotNull === 1) {
  console.log('Recreating teachers table to make employee_id nullable...');
  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec(`CREATE TABLE teachers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      employee_id TEXT UNIQUE,
      department_id INTEGER REFERENCES departments(id),
      full_name TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    db.exec(`INSERT INTO teachers_new (id, user_id, employee_id, full_name, phone, created_at, updated_at)
    SELECT id, user_id, employee_id, full_name, phone, created_at, updated_at FROM teachers;`);
    db.exec('DROP TABLE teachers;');
    db.exec('ALTER TABLE teachers_new RENAME TO teachers;');
    db.exec('COMMIT;');
    console.log('[OK] teachers table recreated with nullable employee_id');
  } catch (e) {
    db.exec('ROLLBACK;');
    console.error('[FAIL]', e.message);
    process.exit(1);
  }
} else {
  console.log('[SKIP] employee_id is already nullable');
}

// Verification
console.log('\n=== Verification ===');
const finalDeptCols = db.prepare('PRAGMA table_info(departments)').all();
const finalTeacherCols = db.prepare('PRAGMA table_info(teachers)').all();
console.log('departments:', finalDeptCols.map(c => c.name).join(', '));
console.log('teachers:', finalTeacherCols.map(c => `${c.name}(nn=${c.notnull})`).join(', '));
const teacherCount = db.prepare('SELECT COUNT(*) as cnt FROM teachers').get();
console.log('Existing teachers preserved:', teacherCount.cnt);

db.exec('PRAGMA foreign_keys = ON;');
console.log('\n=== Migration complete ===');
