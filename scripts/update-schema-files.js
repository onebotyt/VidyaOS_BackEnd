const fs = require('fs');

let schema = fs.readFileSync('database/schema.sql', 'utf8');

// 1. Update attendance_sessions
schema = schema.replace(
  '  auto_close_at DATETIME,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);',
  '  auto_close_at DATETIME,\n  verification_pin TEXT,\n  verification_qr_hash TEXT,\n  verification_expires_at DATETIME,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);'
);

// 2. Remove attendance_session_pins and attendance_session_qr tables
schema = schema.replace(/CREATE TABLE attendance_session_pins \([\s\S]*?\);\n\n/g, '');
schema = schema.replace(/CREATE TABLE attendance_session_qr \([\s\S]*?\);\n\n/g, '');

// 3. Remove cohort_registration_settings
schema = schema.replace(/CREATE TABLE cohort_registration_settings \([\s\S]*?\);\n\n/g, '');

// 4. Remove device_events
schema = schema.replace(/CREATE TABLE device_events \([\s\S]*?\);\n\n/g, '');

// 5. Remove register_attendance_corrections
schema = schema.replace(/CREATE TABLE register_attendance_corrections \([\s\S]*?\);\n\n/g, '');

// 6. Replace assignments, assignment_submissions, exams, exam_scores with assessments & assessment_submissions + views
const oldAssessmentBlock = /CREATE TABLE IF NOT EXISTS assignments \([\s\S]*CREATE INDEX IF NOT EXISTS idx_exam_scores_exam ON exam_scores\(exam_id\);/g;

const newAssessmentBlock = `CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_id INTEGER REFERENCES subjects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  type TEXT NOT NULL DEFAULT 'ASSIGNMENT',  -- 'ASSIGNMENT' | 'EXAM' | 'TEST' | 'QUIZ'
  title TEXT NOT NULL,
  description TEXT,
  attachment_path TEXT,
  attachment_name TEXT,
  due_date DATETIME,                       -- due_date for assignments, exam_date for tests/exams
  max_marks REAL NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  file_path TEXT,
  original_filename TEXT,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'SUBMITTED', -- 'SUBMITTED' | 'LATE' | 'GRADED'
  marks_obtained REAL,
  feedback TEXT,                           -- feedback or exam remarks
  graded_at DATETIME,
  graded_by INTEGER REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_student ON leave_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_applications(status);
CREATE INDEX IF NOT EXISTS idx_timetable_cohort ON timetable_slots(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessments_cohort ON assessments(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(type);
CREATE INDEX IF NOT EXISTS idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_submissions_student ON assessment_submissions(student_id);

-- Backward-Compatibility Views for Legacy Queries
CREATE VIEW IF NOT EXISTS assignments AS
SELECT id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id,
       title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
FROM assessments
WHERE type = 'ASSIGNMENT';

CREATE VIEW IF NOT EXISTS assignment_submissions AS
SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
       submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
FROM assessment_submissions;

CREATE VIEW IF NOT EXISTS exams AS
SELECT id, teacher_id, subject_id, department_id, branch_id, year, semester, academic_year_id,
       title AS name, due_date AS exam_date, max_marks, created_at, updated_at
FROM assessments
WHERE type = 'EXAM';

CREATE VIEW IF NOT EXISTS exam_scores AS
SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
       graded_by AS entered_by, created_at, updated_at
FROM assessment_submissions;

CREATE VIEW IF NOT EXISTS attendance_session_pins AS
SELECT id AS session_id, verification_pin AS pin_code, verification_expires_at AS expires_at, created_at
FROM attendance_sessions
WHERE verification_pin IS NOT NULL;

CREATE VIEW IF NOT EXISTS attendance_session_qr AS
SELECT id AS session_id, verification_qr_hash AS token_hash, verification_expires_at AS expires_at, created_at
FROM attendance_sessions
WHERE verification_qr_hash IS NOT NULL;`;

schema = schema.replace(oldAssessmentBlock, newAssessmentBlock);

// Update table count comment at top
schema = schema.replace('-- TABLES (27)', '-- TABLES (22 Unified Tables + Compatibility Views)');

fs.writeFileSync('database/schema.sql', schema, 'utf8');
fs.writeFileSync('database/sqlite/schema.sql', schema, 'utf8');
console.log('Successfully updated database/schema.sql and database/sqlite/schema.sql');
