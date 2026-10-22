-- =========================================================
-- Migration 004: Database Schema Consolidation & Simplification
-- Consolidates redundant tables:
-- 1. attendance_session_pins & attendance_session_qr -> attendance_sessions columns
-- 2. assignments & exams -> assessments
-- 3. assignment_submissions & exam_scores -> assessment_submissions
-- 4. register_attendance_corrections -> audit_logs
-- 5. Drops dead/redundant tables: device_events, cohort_registration_settings
-- 6. Adds backward-compatibility VIEWs for legacy readers
-- =========================================================

-- 1. Add session verification tokens directly to attendance_sessions
-- (Handled conditionally in runner script if columns already exist)

-- 2. Create Unified Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
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

CREATE INDEX IF NOT EXISTS idx_assessments_cohort ON assessments(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(type);

-- 3. Create Unified Assessment Submissions Table
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

CREATE INDEX IF NOT EXISTS idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_submissions_student ON assessment_submissions(student_id);
