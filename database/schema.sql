-- =========================================================
-- College Attendance System — SQLite Database Schema
-- Generated: 2026-09-21T05:19:01.619Z
-- Architecture: Unified Departments & Branches Catalog
-- =========================================================

-- ─────────────────────────────────────────────────────────
-- TABLES (28)
-- ─────────────────────────────────────────────────────────

CREATE TABLE academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE assessment_submissions (
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

CREATE TABLE "assessments" (
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
    , group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE);

CREATE TABLE "attendance_registers" (
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
    , group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE);

CREATE TABLE attendance_session_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  class_roll_no INTEGER NOT NULL,
  included INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, student_id)
);

CREATE TABLE "attendance_sessions" (
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

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  ip_address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE classroom_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      attachment_path TEXT,
      attachment_name TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, hod_user_id INTEGER REFERENCES users(id), degree_duration_years INTEGER NOT NULL DEFAULT 3, active_term TEXT NOT NULL DEFAULT 'ODD', is_archived INTEGER NOT NULL DEFAULT 0, archived_at DATETIME);

CREATE TABLE "devices" (
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

CREATE TABLE "enrollments" (
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

CREATE TABLE esp32_presence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  scan_time DATETIME NOT NULL,
  payload_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fingerprint_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(device_id, slot_id),
  UNIQUE(device_id, student_id)
);

CREATE TABLE leave_applications (
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

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  link_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE register_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  attendance_status TEXT NOT NULL,   -- 'PRESENT' | 'ABSENT' | 'LATE'
  source TEXT NOT NULL DEFAULT 'MANUAL', -- 'MANUAL' | 'ESP32_SYNC' | 'SELF_REQUEST'
  teacher_notes TEXT,
  marked_by INTEGER NOT NULL REFERENCES users(id),
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, student_id)
);

CREATE TABLE student_self_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  verification_method TEXT NOT NULL,
  request_status TEXT NOT NULL DEFAULT 'PENDING',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by INTEGER REFERENCES users(id),
  UNIQUE(session_id, student_id)
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  official_enrollment_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  entry_mode TEXT NOT NULL DEFAULT 'teacher_provisioned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, fingerprint_template TEXT, admission_year INTEGER NOT NULL DEFAULT 2024, is_lateral_entry INTEGER NOT NULL DEFAULT 0, graduation_year INTEGER, registration_no TEXT, class_roll_no INTEGER);

CREATE TABLE "subjects" (
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

CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_by INTEGER,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "teacher_assignments" (
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

CREATE TABLE "teachers" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      employee_id TEXT UNIQUE,
      department_id INTEGER REFERENCES departments(id),
      full_name TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE teaching_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'ENROLLED', -- 'PENDING' | 'ENROLLED'
      UNIQUE(group_id, student_id)
    );

CREATE TABLE teaching_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      component TEXT NOT NULL DEFAULT 'THEORY', -- 'THEORY' | 'PRACTICAL'
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      semester INTEGER NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'ARCHIVED'
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );

CREATE TABLE "timetable_slots" (
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

CREATE TABLE user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, role)
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at DATETIME NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  temp_password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  google_sub TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  rejection_reason TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────
-- INDICES (10)
-- ─────────────────────────────────────────────────────────

CREATE INDEX idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);

CREATE INDEX idx_assessment_submissions_student ON assessment_submissions(student_id);

CREATE INDEX idx_assessments_cohort ON assessments(department_id, year, semester, academic_year_id);

CREATE INDEX idx_assessments_teacher ON assessments(teacher_id);

CREATE INDEX idx_assessments_type ON assessments(type);

CREATE INDEX idx_leave_status ON leave_applications(status);

CREATE INDEX idx_leave_student ON leave_applications(student_id);

CREATE INDEX idx_students_class_roll ON students(class_roll_no);

CREATE INDEX idx_students_reg_no ON students(registration_no);

CREATE INDEX idx_timetable_cohort ON timetable_slots(department_id, year, semester, academic_year_id);

