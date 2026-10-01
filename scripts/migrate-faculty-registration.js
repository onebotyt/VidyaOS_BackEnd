/**
 * Database Migration: Faculty Registration Requests & Common Faculty Manager
 * 
 * Implements redesign.md Sections 7-11:
 * - faculty_registration_requests table for 3-tier approval (HOD, Common Manager, Admin)
 * - common_faculty_manager_assignments table for tracking appointed Common Faculty Managers
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, '../college_attendance.sqlite');
const db = new DatabaseSync(dbPath);

console.log('--- Migrating Faculty Registration & Common Faculty Manager Schema ---');

// 1. Create faculty_registration_requests table
db.exec(`
  CREATE TABLE IF NOT EXISTS faculty_registration_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT,
    employee_id TEXT,
    account_type TEXT NOT NULL CHECK(account_type IN ('FACULTY', 'HOD')),
    department_id INTEGER REFERENCES departments(id),
    approval_type TEXT NOT NULL CHECK(approval_type IN ('DEPT_HOD', 'COMMON_FACULTY_MANAGER', 'ADMIN')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
console.log('✓ faculty_registration_requests table created/verified');

// 2. Create common_faculty_manager_assignments table
db.exec(`
  CREATE TABLE IF NOT EXISTS common_faculty_manager_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deactivated_at DATETIME
  );
`);
console.log('✓ common_faculty_manager_assignments table created/verified');

// 3. Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_frr_status ON faculty_registration_requests(status);
  CREATE INDEX IF NOT EXISTS idx_frr_dept_status ON faculty_registration_requests(department_id, status);
  CREATE INDEX IF NOT EXISTS idx_frr_approval_type ON faculty_registration_requests(approval_type, status);
  CREATE INDEX IF NOT EXISTS idx_cfma_teacher ON common_faculty_manager_assignments(teacher_id, is_active);
`);
console.log('✓ Indexes created successfully');

console.log('--- Migration Complete ---');
