-- =========================================================
-- College Attendance System — SQLite Database Schema
-- Generated: 2026-10-21T16:56:11.349Z
-- Architecture: Unified Departments & Branches Catalog
-- =========================================================

-- ─────────────────────────────────────────────────────────
-- TABLES (38)
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
    , group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE, questions TEXT, instructions TEXT);

CREATE TABLE attendance_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        original_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        changed_by INTEGER NOT NULL REFERENCES users(id),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

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
    , period_number INTEGER DEFAULT 1);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  ip_address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, event_type TEXT, actor_id INTEGER, actor_role TEXT, target_type TEXT, target_id TEXT);

CREATE TABLE classroom_post_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES classroom_posts(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
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

CREATE TABLE common_faculty_manager_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deactivated_at DATETIME
  );

CREATE TABLE course_file_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_file_id INTEGER NOT NULL REFERENCES course_files(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          status TEXT NOT NULL DEFAULT 'UPLOADED',
          version INTEGER NOT NULL DEFAULT 1,
          uploaded_by INTEGER NOT NULL REFERENCES users(id),
          verified_by INTEGER REFERENCES users(id),
          verified_at DATETIME,
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(course_file_id, item_key)
        );

CREATE TABLE course_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teaching_group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          department_id INTEGER NOT NULL REFERENCES departments(id),
          academic_year_id INTEGER REFERENCES academic_years(id),
          semester INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT,
          audited_at DATETIME,
          audited_by INTEGER REFERENCES users(id),
          evaluation_scheme TEXT,
          copo_matrix_json TEXT,
          cos_json TEXT,
          advanced_learners_json TEXT,
          slow_learners_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teaching_group_id)
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

CREATE TABLE faculty_media_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          faculty_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
          department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'LECTURE_NOTES',
          tags TEXT,
          is_public_to_students INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE faculty_registration_requests (
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

CREATE TABLE iot_attendance_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        scan_time DATETIME NOT NULL,
        scan_date DATE,
        verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
        event_type TEXT NOT NULL DEFAULT 'FINGERPRINT',
        payload_json TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
, type TEXT DEFAULT 'GENERAL');

CREATE TABLE otp_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        user_id INTEGER,
        verification_token TEXT,
        expires_at DATETIME NOT NULL,
        attempts INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE student_department_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        academic_year_id INTEGER REFERENCES academic_years(id),
        year INTEGER NOT NULL DEFAULT 1,
        semester INTEGER NOT NULL DEFAULT 1,
        class_roll_no INTEGER,
        start_date DATE NOT NULL,
        end_date DATE,
        status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'TRANSFERRED' | 'COMPLETED'
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
, fingerprint_template TEXT, admission_year INTEGER NOT NULL DEFAULT 2024, is_lateral_entry INTEGER NOT NULL DEFAULT 0, graduation_year INTEGER, registration_no TEXT, class_roll_no INTEGER, phone TEXT, parent_phone TEXT, parent_name TEXT, is_phone_verified INTEGER DEFAULT 0);

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
    , is_phone_verified INTEGER DEFAULT 0);

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
    , deleted_at DATETIME, subject_code TEXT);

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
, device_id TEXT, last_active_at DATETIME);

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
, phone TEXT);

-- ─────────────────────────────────────────────────────────
-- INDICES (46)
-- ─────────────────────────────────────────────────────────

CREATE INDEX idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);

CREATE INDEX idx_assessment_submissions_student ON assessment_submissions(student_id);

CREATE INDEX idx_assessments_cohort ON assessments(department_id, year, semester, academic_year_id);

CREATE INDEX idx_assessments_teacher ON assessments(teacher_id);

CREATE INDEX idx_assessments_type ON assessments(type);

CREATE INDEX idx_att_corr_session ON attendance_corrections(session_id);

CREATE INDEX idx_att_corr_student ON attendance_corrections(student_id);

CREATE INDEX idx_audit_action ON audit_logs(action);

CREATE INDEX idx_audit_actor ON audit_logs(actor_id);

CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE INDEX idx_audit_event_type ON audit_logs(event_type);

CREATE INDEX idx_audit_user ON audit_logs(user_id);

CREATE INDEX idx_cfma_teacher ON common_faculty_manager_assignments(teacher_id, is_active);

CREATE INDEX idx_course_file_docs ON course_file_documents(course_file_id, item_key);

CREATE INDEX idx_course_files_dept ON course_files(department_id);

CREATE INDEX idx_course_files_teacher ON course_files(teacher_id);

CREATE INDEX idx_cp_group_created ON classroom_posts(group_id, created_at);

CREATE INDEX idx_cpc_post ON classroom_post_comments(post_id);

CREATE INDEX idx_frr_approval_type ON faculty_registration_requests(approval_type, status);

CREATE INDEX idx_frr_dept_status ON faculty_registration_requests(department_id, status);

CREATE INDEX idx_frr_status ON faculty_registration_requests(status);

CREATE INDEX idx_iot_events_dept ON iot_attendance_events(department_id);

CREATE INDEX idx_iot_events_device ON iot_attendance_events(device_id);

CREATE INDEX idx_iot_events_student_date ON iot_attendance_events(student_id, scan_date);

CREATE INDEX idx_leave_status ON leave_applications(status);

CREATE INDEX idx_leave_student ON leave_applications(student_id);

CREATE INDEX idx_media_category ON faculty_media_assets(category);

CREATE INDEX idx_media_dept ON faculty_media_assets(department_id);

CREATE INDEX idx_media_faculty ON faculty_media_assets(faculty_id);

CREATE INDEX idx_media_student ON faculty_media_assets(student_id);

CREATE INDEX idx_media_subject ON faculty_media_assets(subject_id);

CREATE INDEX idx_media_type ON faculty_media_assets(file_type);

CREATE INDEX idx_notifications_created ON notifications(created_at);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);

CREATE INDEX idx_otp_identifier_purpose ON otp_verifications(identifier, purpose);

CREATE INDEX idx_otp_token ON otp_verifications(verification_token);

CREATE INDEX idx_sde_dept ON student_department_enrollments(department_id);

CREATE INDEX idx_sde_student ON student_department_enrollments(student_id);

CREATE INDEX idx_students_class_roll ON students(class_roll_no);

CREATE INDEX idx_students_phone ON students(phone);

CREATE INDEX idx_students_reg_no ON students(registration_no);

CREATE INDEX idx_tg_invite_code ON teaching_groups(invite_code);

CREATE INDEX idx_tg_teacher_status ON teaching_groups(teacher_id, status);

CREATE INDEX idx_tgm_group_student ON teaching_group_members(group_id, student_id);

CREATE INDEX idx_timetable_cohort ON timetable_slots(department_id, year, semester, academic_year_id);

CREATE INDEX idx_users_phone ON users(phone);

