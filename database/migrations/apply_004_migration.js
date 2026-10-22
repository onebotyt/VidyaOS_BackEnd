const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function migrateDb(dbFilePath) {
  if (!fs.existsSync(dbFilePath)) {
    console.log(`[SKIP] DB file not found: ${dbFilePath}`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`Applying Migration 004 to: ${dbFilePath}`);
  console.log(`======================================================`);

  const db = new DatabaseSync(dbFilePath);
  db.exec('PRAGMA foreign_keys = OFF;');

  const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  const tableNames = tables.filter(t => t.type === 'table').map(t => t.name);

  if (!tableNames.includes('attendance_sessions')) {
    console.log(`  [SKIP] ${dbFilePath} has not been initialized with base schema.`);
    return;
  }

  // 1. Add verification columns to attendance_sessions
  console.log('[1/7] Adding verification columns to attendance_sessions...');
  const sessionCols = db.prepare("PRAGMA table_info(attendance_sessions)").all().map(c => c.name);
  if (!sessionCols.includes('verification_pin')) {
    db.exec("ALTER TABLE attendance_sessions ADD COLUMN verification_pin TEXT;");
  }
  if (!sessionCols.includes('verification_qr_hash')) {
    db.exec("ALTER TABLE attendance_sessions ADD COLUMN verification_qr_hash TEXT;");
  }
  if (!sessionCols.includes('verification_expires_at')) {
    db.exec("ALTER TABLE attendance_sessions ADD COLUMN verification_expires_at DATETIME;");
  }

  // Migrate any existing pins/qr
  if (tableNames.includes('attendance_session_pins')) {
    try {
      db.exec(`
        UPDATE attendance_sessions 
        SET verification_pin = (
          SELECT pin_code FROM attendance_session_pins 
          WHERE attendance_session_pins.session_id = attendance_sessions.id 
          ORDER BY id DESC LIMIT 1
        ),
        verification_expires_at = (
          SELECT expires_at FROM attendance_session_pins 
          WHERE attendance_session_pins.session_id = attendance_sessions.id 
          ORDER BY id DESC LIMIT 1
        )
        WHERE id IN (SELECT session_id FROM attendance_session_pins);
      `);
      console.log('  ✓ Migrated attendance_session_pins into attendance_sessions');
    } catch (err) {
      console.log('  Notice: Could not migrate pins:', err.message);
    }
  }

  if (tableNames.includes('attendance_session_qr')) {
    try {
      db.exec(`
        UPDATE attendance_sessions 
        SET verification_qr_hash = (
          SELECT token_hash FROM attendance_session_qr 
          WHERE attendance_session_qr.session_id = attendance_sessions.id 
          ORDER BY id DESC LIMIT 1
        )
        WHERE id IN (SELECT session_id FROM attendance_session_qr);
      `);
      console.log('  ✓ Migrated attendance_session_qr into attendance_sessions');
    } catch (err) {
      console.log('  Notice: Could not migrate qr tokens:', err.message);
    }
  }

  // 2. Create Unified Assessments & Submissions Tables
  console.log('[2/7] Creating unified assessments & assessment_submissions tables...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      subject_id INTEGER REFERENCES subjects(id),
      department_id INTEGER NOT NULL REFERENCES departments(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
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

    CREATE INDEX IF NOT EXISTS idx_assessments_cohort ON assessments(department_id, branch_id, year, semester, academic_year_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(type);

    CREATE TABLE IF NOT EXISTS assessment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id),
      file_path TEXT,
      original_filename TEXT,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      marks_obtained REAL,
      feedback TEXT,
      graded_at DATETIME,
      graded_by INTEGER REFERENCES users(id),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assessment_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_assessment_submissions_student ON assessment_submissions(student_id);
  `);

  // 3. Migrate assignments & submissions
  console.log('[3/7] Migrating assignments & assignment_submissions...');
  if (tableNames.includes('assignments')) {
    const assignments = db.prepare("SELECT * FROM assignments").all();
    const insertAssess = db.prepare(`
      INSERT OR REPLACE INTO assessments 
      (id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id, type, title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNMENT', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    assignments.forEach(a => {
      insertAssess.run(
        a.id, a.teacher_id, a.subject_id, a.department_id, a.branch_id, a.year, a.semester, a.academic_year_id,
        a.title, a.description, a.attachment_path, a.attachment_name, a.due_date, a.max_marks,
        a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString()
      );
    });
    console.log(`  ✓ Migrated ${assignments.length} assignments into assessments`);
  }

  if (tableNames.includes('assignment_submissions')) {
    const subs = db.prepare("SELECT * FROM assignment_submissions").all();
    const insertSub = db.prepare(`
      INSERT OR REPLACE INTO assessment_submissions 
      (id, assessment_id, student_id, file_path, original_filename, submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    subs.forEach(s => {
      insertSub.run(
        s.id, s.assignment_id, s.student_id, s.file_path, s.original_filename, s.submitted_at,
        s.status || 'SUBMITTED', s.marks_obtained, s.feedback, s.graded_at, s.graded_by,
        s.created_at || s.submitted_at || new Date().toISOString(), s.updated_at || new Date().toISOString()
      );
    });
    console.log(`  ✓ Migrated ${subs.length} submissions into assessment_submissions`);
  }

  // 4. Migrate exams & exam_scores
  console.log('[4/7] Migrating exams & exam_scores...');
  let maxAssessId = db.prepare("SELECT COALESCE(MAX(id), 0) as maxId FROM assessments").get().maxId;
  const examIdMap = new Map();

  if (tableNames.includes('exams')) {
    const exams = db.prepare("SELECT * FROM exams").all();
    const insertExam = db.prepare(`
      INSERT INTO assessments 
      (id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id, type, title, due_date, max_marks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EXAM', ?, ?, ?, ?, ?)
    `);
    exams.forEach(e => {
      maxAssessId++;
      examIdMap.set(e.id, maxAssessId);
      insertExam.run(
        maxAssessId, e.teacher_id, e.subject_id, e.department_id, e.branch_id, e.year, e.semester, e.academic_year_id,
        e.name, e.exam_date, e.max_marks, e.created_at || new Date().toISOString(), e.updated_at || new Date().toISOString()
      );
    });
    console.log(`  ✓ Migrated ${exams.length} exams into assessments`);
  }

  if (tableNames.includes('exam_scores')) {
    const scores = db.prepare("SELECT * FROM exam_scores").all();
    const insertScore = db.prepare(`
      INSERT OR REPLACE INTO assessment_submissions 
      (assessment_id, student_id, marks_obtained, feedback, graded_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'GRADED', ?, ?)
    `);
    scores.forEach(sc => {
      const newAssessId = examIdMap.get(sc.exam_id) || sc.exam_id;
      insertScore.run(
        newAssessId, sc.student_id, sc.marks_obtained, sc.remarks, sc.entered_by,
        sc.created_at || new Date().toISOString(), sc.updated_at || new Date().toISOString()
      );
    });
    console.log(`  ✓ Migrated ${scores.length} scores into assessment_submissions`);
  }

  // 5. Migrate attendance corrections into audit_logs
  console.log('[5/7] Migrating attendance corrections into audit_logs...');
  if (tableNames.includes('register_attendance_corrections')) {
    try {
      const corrections = db.prepare("SELECT * FROM register_attendance_corrections").all();
      const insertAudit = db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
        VALUES (?, 'ATTENDANCE_CORRECTION', 'register_attendance', ?, ?, ?)
      `);
      corrections.forEach(c => {
        const details = JSON.stringify({ previous_status: c.previous_status, new_status: c.new_status, reason: c.reason });
        insertAudit.run(c.corrected_by, String(c.register_record_id), details, c.created_at || new Date().toISOString());
      });
      console.log(`  ✓ Migrated ${corrections.length} corrections into audit_logs`);
    } catch (err) {
      console.log('  Notice: Could not migrate corrections:', err.message);
    }
  }

  // 6. Drop legacy tables
  console.log('[6/7] Dropping legacy tables...');
  const tablesToDrop = [
    'attendance_session_pins',
    'attendance_session_qr',
    'assignment_submissions',
    'assignments',
    'exam_scores',
    'exams',
    'register_attendance_corrections',
    'device_events',
    'cohort_registration_settings'
  ];

  tablesToDrop.forEach(tbl => {
    if (tableNames.includes(tbl)) {
      db.exec(`DROP TABLE IF EXISTS ${tbl};`);
      console.log(`  ✓ Dropped legacy table: ${tbl}`);
    }
  });

  // 7. Create Compatibility Views
  console.log('[7/7] Creating SQL Compatibility Views...');
  db.exec(`
    DROP VIEW IF EXISTS assignments;
    CREATE VIEW assignments AS
    SELECT id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id,
           title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
    FROM assessments
    WHERE type = 'ASSIGNMENT';

    DROP VIEW IF EXISTS assignment_submissions;
    CREATE VIEW assignment_submissions AS
    SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
           submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
    FROM assessment_submissions;

    DROP VIEW IF EXISTS exams;
    CREATE VIEW exams AS
    SELECT id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id,
           title AS name, due_date AS exam_date, max_marks, created_at, updated_at
    FROM assessments
    WHERE type = 'EXAM';

    DROP VIEW IF EXISTS exam_scores;
    CREATE VIEW exam_scores AS
    SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
           graded_by AS entered_by, created_at, updated_at
    FROM assessment_submissions;

    DROP VIEW IF EXISTS attendance_session_pins;
    CREATE VIEW attendance_session_pins AS
    SELECT id AS session_id, verification_pin AS pin_code, verification_expires_at AS expires_at, created_at
    FROM attendance_sessions
    WHERE verification_pin IS NOT NULL;

    DROP VIEW IF EXISTS attendance_session_qr;
    CREATE VIEW attendance_session_qr AS
    SELECT id AS session_id, verification_qr_hash AS token_hash, verification_expires_at AS expires_at, created_at
    FROM attendance_sessions
    WHERE verification_qr_hash IS NOT NULL;
  `);

  console.log('  ✓ Compatibility views created successfully.');
  console.log('🎉 Migration 004 applied successfully!\n');
}

// Run migration on both SQLite locations
migrateDb(path.resolve(__dirname, '../../backend/college_attendance.sqlite'));
migrateDb(path.resolve(__dirname, '../../college_attendance.sqlite'));
