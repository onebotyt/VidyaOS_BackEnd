-- =========================================================
-- Migration 003: Faculty+ Features
-- Adds: Leave Applications, Timetable, Assignments (with
-- file submissions), and Exams/Test Scores.
-- =========================================================

CREATE TABLE IF NOT EXISTS leave_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',   -- 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  reviewed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  subject_id INTEGER REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES teachers(id),
  day_of_week INTEGER NOT NULL,             -- 1=Mon ... 7=Sun
  start_time TEXT NOT NULL,                 -- 'HH:MM'
  end_time TEXT NOT NULL,                   -- 'HH:MM'
  room TEXT,
  session_type TEXT NOT NULL DEFAULT 'THEORY',
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_id INTEGER REFERENCES subjects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  title TEXT NOT NULL,
  description TEXT,
  attachment_path TEXT,
  attachment_name TEXT,
  due_date DATETIME,
  max_marks INTEGER NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  file_path TEXT NOT NULL,
  original_filename TEXT,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',  -- 'SUBMITTED' | 'LATE' | 'GRADED'
  marks_obtained REAL,
  feedback TEXT,
  graded_at DATETIME,
  graded_by INTEGER REFERENCES users(id),
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL,                        -- e.g. 'Unit Test 1', 'Mid Semester'
  exam_date DATE,
  max_marks INTEGER NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  marks_obtained REAL,
  remarks TEXT,
  entered_by INTEGER REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_student ON leave_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_applications(status);
CREATE INDEX IF NOT EXISTS idx_timetable_cohort ON timetable_slots(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assignments_cohort ON assignments(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_exams_cohort ON exams(department_id, branch_id, year, semester, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_exam_scores_exam ON exam_scores(exam_id);
