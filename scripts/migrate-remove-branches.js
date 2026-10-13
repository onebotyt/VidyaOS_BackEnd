/**
 * MIGRATION: Remove Branches — Collapse branch_id into department_id
 * 
 * Phase 0 of Teaching Group Architecture Redesign
 * 
 * Since branches have always been 1:1 with departments, this migration:
 * 1. Verifies the 1:1 mapping
 * 2. Recreates all tables that had branch_id WITHOUT that column
 * 3. Drops the branches table
 * 4. Updates schema.sql
 * 
 * Run: node backend/scripts/migrate-remove-branches.js
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '../college_attendance.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('PRAGMA journal_mode = WAL;');

function log(msg) { console.log(`  ${msg}`); }
function header(msg) { console.log(`\n${'═'.repeat(60)}\n  ${msg}\n${'═'.repeat(60)}`); }

// ============================================================
// STEP 1: Verify 1:1 branch-department mapping
// ============================================================
header('STEP 1: Verify Branch ↔ Department 1:1 Mapping');

const branches = db.prepare('SELECT id, department_id, name, code FROM branches').all();
log(`Found ${branches.length} branches`);

const depts = db.prepare('SELECT id, name, code FROM departments').all();
log(`Found ${depts.length} departments`);

// Check each branch maps to exactly its department
let mappingOk = true;
for (const b of branches) {
  if (b.id !== b.department_id) {
    // Non-trivial mapping — check if department_id is valid
    const dept = depts.find(d => d.id === b.department_id);
    if (!dept) {
      console.error(`ERROR: Branch ${b.id} (${b.code}) references non-existent department_id=${b.department_id}`);
      mappingOk = false;
    } else {
      log(`Branch ${b.id} (${b.code}) → Department ${dept.id} (${dept.code}) [non-trivial but valid]`);
    }
  } else {
    log(`Branch ${b.id} (${b.code}) → Department ${b.department_id} ✓ (1:1)`);
  }
}

if (!mappingOk) {
  console.error('\n❌ Branch mapping verification FAILED. Aborting migration.');
  process.exit(1);
}
log('\n✅ All branches map 1:1 to departments. Safe to proceed.\n');

// Build branch_id → department_id lookup
const branchToDept = {};
for (const b of branches) {
  branchToDept[b.id] = b.department_id;
}

// ============================================================
// STEP 2: Recreate tables WITHOUT branch_id
// ============================================================
header('STEP 2: Recreating Tables Without branch_id');

db.exec('BEGIN TRANSACTION;');

try {
  // Drop all views FIRST — they reference tables we're about to recreate
  log('Dropping dependent views...');
  db.exec('DROP VIEW IF EXISTS assignments;');
  db.exec('DROP VIEW IF EXISTS assignment_submissions;');
  db.exec('DROP VIEW IF EXISTS exams;');
  db.exec('DROP VIEW IF EXISTS exam_scores;');
  db.exec('DROP VIEW IF EXISTS attendance_session_pins;');
  db.exec('DROP VIEW IF EXISTS attendance_session_qr;');
  log('  ✓ All dependent views dropped');

  // --- attendance_registers ---
  log('Migrating attendance_registers...');
  db.exec(`
    CREATE TABLE attendance_registers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id),
      assignment_id INTEGER REFERENCES teacher_assignments(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id),
      year INTEGER,
      semester INTEGER,
      academic_year_id INTEGER REFERENCES academic_years(id),
      session_type_scope TEXT NOT NULL DEFAULT 'THEORY',
      is_official INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO attendance_registers_new
      (id, teacher_id, name, subject_id, assignment_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, created_at, updated_at)
    SELECT id, teacher_id, name, subject_id, assignment_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, created_at, updated_at
    FROM attendance_registers;
  `);
  db.exec('DROP TABLE attendance_registers;');
  db.exec('ALTER TABLE attendance_registers_new RENAME TO attendance_registers;');
  log('  ✓ attendance_registers migrated');

  // --- attendance_sessions ---
  log('Migrating attendance_sessions...');
  db.exec(`
    CREATE TABLE attendance_sessions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      register_id INTEGER NOT NULL REFERENCES attendance_registers(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      session_type TEXT NOT NULL DEFAULT 'THEORY',
      label TEXT,
      session_date DATE NOT NULL,
      start_time DATETIME,
      end_time DATETIME,
      state TEXT NOT NULL DEFAULT 'DRAFT',
      auto_close_at DATETIME,
      verification_pin TEXT,
      verification_qr_hash TEXT,
      verification_expires_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO attendance_sessions_new
      (id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, end_time, state, auto_close_at, verification_pin, verification_qr_hash, verification_expires_at, created_at, updated_at)
    SELECT id, register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, end_time, state, auto_close_at, verification_pin, verification_qr_hash, verification_expires_at, created_at, updated_at
    FROM attendance_sessions;
  `);
  db.exec('DROP TABLE attendance_sessions;');
  db.exec('ALTER TABLE attendance_sessions_new RENAME TO attendance_sessions;');
  log('  ✓ attendance_sessions migrated');

  // --- devices ---
  log('Migrating devices...');
  db.exec(`
    CREATE TABLE devices_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_uid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      secret_hash TEXT NOT NULL,
      certificate_fingerprint TEXT,
      assigned_years TEXT,
      assigned_semesters TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_heartbeat_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO devices_new
      (id, device_uid, name, department_id, year, semester, academic_year_id, secret_hash, certificate_fingerprint, assigned_years, assigned_semesters, is_active, last_heartbeat_at, created_at, updated_at)
    SELECT id, device_uid, name, department_id, year, semester, academic_year_id, secret_hash, certificate_fingerprint, assigned_years, assigned_semesters, is_active, last_heartbeat_at, created_at, updated_at
    FROM devices;
  `);
  db.exec('DROP TABLE devices;');
  db.exec('ALTER TABLE devices_new RENAME TO devices;');
  log('  ✓ devices migrated');

  // --- enrollments ---
  log('Migrating enrollments...');
  db.exec(`
    CREATE TABLE enrollments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      class_roll_no INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'ENROLLED',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO enrollments_new
      (id, student_id, department_id, year, semester, academic_year_id, class_roll_no, status, created_at, updated_at)
    SELECT id, student_id, department_id, year, semester, academic_year_id, class_roll_no, status, created_at, updated_at
    FROM enrollments;
  `);
  db.exec('DROP TABLE enrollments;');
  db.exec('ALTER TABLE enrollments_new RENAME TO enrollments;');
  log('  ✓ enrollments migrated');

  // --- subjects ---
  log('Migrating subjects...');
  db.exec(`
    CREATE TABLE subjects_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      has_practical INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      syllabus_scheme TEXT DEFAULT '2026-27',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(department_id, year, semester, code)
    );
  `);
  db.exec(`
    INSERT INTO subjects_new
      (id, department_id, year, semester, name, code, has_practical, is_active, created_at, updated_at)
    SELECT id, department_id, year, semester, name, code, has_practical, is_active, created_at, updated_at
    FROM subjects;
  `);
  db.exec('DROP TABLE subjects;');
  db.exec('ALTER TABLE subjects_new RENAME TO subjects;');
  log('  ✓ subjects migrated');

  // --- teacher_assignments ---
  log('Migrating teacher_assignments...');
  db.exec(`
    CREATE TABLE teacher_assignments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      assignment_type TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id),
      session_type_scope TEXT NOT NULL DEFAULT 'ALL',
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      assigned_by INTEGER NOT NULL REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO teacher_assignments_new
      (id, teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active, created_at, updated_at)
    SELECT id, teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by, is_active, created_at, updated_at
    FROM teacher_assignments;
  `);
  db.exec('DROP TABLE teacher_assignments;');
  db.exec('ALTER TABLE teacher_assignments_new RENAME TO teacher_assignments;');
  log('  ✓ teacher_assignments migrated');

  // --- timetable_slots ---
  log('Migrating timetable_slots...');
  db.exec(`
    CREATE TABLE timetable_slots_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      subject_id INTEGER REFERENCES subjects(id),
      teacher_id INTEGER REFERENCES teachers(id),
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room TEXT,
      session_type TEXT NOT NULL DEFAULT 'THEORY',
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO timetable_slots_new
      (id, department_id, year, semester, academic_year_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, session_type, created_by, created_at, updated_at)
    SELECT id, department_id, year, semester, academic_year_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, session_type, created_by, created_at, updated_at
    FROM timetable_slots;
  `);
  db.exec('DROP TABLE timetable_slots;');
  db.exec('ALTER TABLE timetable_slots_new RENAME TO timetable_slots;');
  log('  ✓ timetable_slots migrated');

  // --- assessments ---
  log('Migrating assessments...');
  db.exec(`
    CREATE TABLE assessments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      subject_id INTEGER REFERENCES subjects(id),
      department_id INTEGER NOT NULL REFERENCES departments(id),
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      type TEXT NOT NULL DEFAULT 'ASSIGNMENT',
      title TEXT NOT NULL,
      description TEXT,
      attachment_path TEXT,
      attachment_name TEXT,
      due_date DATETIME,
      max_marks REAL NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    INSERT INTO assessments_new
      (id, teacher_id, subject_id, department_id, year, semester, academic_year_id, type, title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at)
    SELECT id, teacher_id, subject_id, department_id, year, semester, academic_year_id, type, title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
    FROM assessments;
  `);
  db.exec('DROP TABLE assessments;');
  db.exec('ALTER TABLE assessments_new RENAME TO assessments;');
  log('  ✓ assessments migrated');

  // ============================================================
  // STEP 3: Drop branches table
  // ============================================================
  header('STEP 3: Dropping branches Table');
  db.exec('DROP TABLE IF EXISTS branches;');
  log('✓ branches table dropped');

  // ============================================================
  // STEP 4: Recreate backward-compat views
  // ============================================================
  header('STEP 4: Recreating Compatibility Views');
  
  db.exec(`DROP VIEW IF EXISTS assignments;`);
  db.exec(`DROP VIEW IF EXISTS assignment_submissions;`);
  db.exec(`DROP VIEW IF EXISTS exams;`);
  db.exec(`DROP VIEW IF EXISTS exam_scores;`);
  db.exec(`DROP VIEW IF EXISTS attendance_session_pins;`);
  db.exec(`DROP VIEW IF EXISTS attendance_session_qr;`);
  
  db.exec(`
    CREATE VIEW IF NOT EXISTS assignments AS
    SELECT id, teacher_id, subject_id, department_id, year, semester, academic_year_id,
           title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
    FROM assessments
    WHERE type = 'ASSIGNMENT';
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS assignment_submissions AS
    SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
           submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
    FROM assessment_submissions;
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS exams AS
    SELECT id, teacher_id, subject_id, department_id, year, semester, academic_year_id,
           title AS name, due_date AS exam_date, max_marks, created_at, updated_at
    FROM assessments
    WHERE type = 'EXAM';
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS exam_scores AS
    SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
           graded_by AS entered_by, created_at, updated_at
    FROM assessment_submissions;
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS attendance_session_pins AS
    SELECT id AS session_id, verification_pin AS pin_code, verification_expires_at AS expires_at, created_at
    FROM attendance_sessions
    WHERE verification_pin IS NOT NULL;
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS attendance_session_qr AS
    SELECT id AS session_id, verification_qr_hash AS token_hash, verification_expires_at AS expires_at, created_at
    FROM attendance_sessions
    WHERE verification_qr_hash IS NOT NULL;
  `);
  log('✓ All compatibility views recreated');

  // ============================================================
  // STEP 5: Recreate indexes
  // ============================================================
  header('STEP 5: Recreating Indexes');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timetable_cohort ON timetable_slots(department_id, year, semester, academic_year_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assessments_cohort ON assessments(department_id, year, semester, academic_year_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_assessment_submissions_student ON assessment_submissions(student_id);`);
  log('✓ All indexes recreated');

  db.exec('COMMIT;');

  // ============================================================
  // STEP 6: Verify
  // ============================================================
  header('STEP 6: Verification');
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tableNames = tables.map(t => t.name);
  
  if (tableNames.includes('branches')) {
    console.error('❌ FAIL: branches table still exists!');
    process.exit(1);
  }
  log('✓ branches table does not exist');

  // Verify no branch_id columns remain
  const tablesWithBranch = [];
  for (const t of tables) {
    if (t.name.startsWith('sqlite_') || t.name === 'branches') continue;
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
    const branchCol = cols.find(c => c.name === 'branch_id');
    if (branchCol) tablesWithBranch.push(t.name);
  }
  
  if (tablesWithBranch.length > 0) {
    console.error(`❌ FAIL: branch_id column still exists in: ${tablesWithBranch.join(', ')}`);
    process.exit(1);
  }
  log('✓ No branch_id columns remain in any table');

  // Verify data integrity
  const regCount = db.prepare('SELECT COUNT(*) as c FROM attendance_registers').get().c;
  const sessCount = db.prepare('SELECT COUNT(*) as c FROM attendance_sessions').get().c;
  const enrollCount = db.prepare('SELECT COUNT(*) as c FROM enrollments').get().c;
  const subCount = db.prepare('SELECT COUNT(*) as c FROM subjects').get().c;
  const devCount = db.prepare('SELECT COUNT(*) as c FROM devices').get().c;
  const assCount = db.prepare('SELECT COUNT(*) as c FROM assessments').get().c;
  
  log(`✓ Data integrity: ${regCount} registers, ${sessCount} sessions, ${enrollCount} enrollments, ${subCount} subjects, ${devCount} devices, ${assCount} assessments`);

  header('✅ MIGRATION COMPLETE — Branches Eliminated');
  console.log('  All branch_id references removed from database.');
  console.log('  Tables recreated without branch_id columns.');
  console.log('  branches table dropped.');
  console.log('  Data fully preserved.\n');

} catch (err) {
  console.error('\n❌ MIGRATION FAILED — Rolling back');
  console.error(err);
  try { db.exec('ROLLBACK;'); } catch (e) {}
  process.exit(1);
} finally {
  db.close();
}
