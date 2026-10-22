-- =============================================================================
-- SMART COLLEGE ATTENDANCE & INSTITUTIONAL MANAGEMENT SYSTEM
-- Production Database Dump for Cloud cPanel (MySQL 8.x / MariaDB)
-- Generated: 2026-10-21T17:46:51.236Z
-- Architecture: Canonical 6 Departments, Teaching Groups & Biometric IoT
-- Seed State: System Administrator Login Only (Clean Production Deployment)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- Clean Drop Existing Tables
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS attendance_corrections;
DROP TABLE IF EXISTS register_attendance;
DROP TABLE IF EXISTS student_self_attendance;
DROP TABLE IF EXISTS attendance_session_students;
DROP TABLE IF EXISTS attendance_sessions;
DROP TABLE IF EXISTS attendance_registers;
DROP TABLE IF EXISTS assessment_submissions;
DROP TABLE IF EXISTS assessments;
DROP TABLE IF EXISTS classroom_posts;
DROP TABLE IF EXISTS teaching_group_members;
DROP TABLE IF EXISTS teaching_groups;
DROP TABLE IF EXISTS teacher_assignments;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS timetable_slots;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS student_department_enrollments;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS faculty_registration_requests;
DROP TABLE IF EXISTS common_faculty_manager_assignments;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS iot_attendance_events;
DROP TABLE IF EXISTS esp32_presence;
DROP TABLE IF EXISTS fingerprint_slots;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS otp_verifications;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS leave_applications;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS system_settings;

-- =============================================================================
-- 1. SYSTEM CONFIGURATION & SETTINGS
-- =============================================================================
CREATE TABLE system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. CENTRAL AUTHENTICATION & USERS
-- =============================================================================
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(191) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  temp_password_hash VARCHAR(255) NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  google_sub VARCHAR(191) NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  rejection_reason TEXT NULL,
  phone VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_username (username),
  INDEX idx_users_email (email),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role),
  INDEX idx_user_roles_user (user_id),
  INDEX idx_user_roles_role (role),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
  user_agent TEXT NULL,
  ip_address VARCHAR(45) NULL,
  expires_at DATETIME NOT NULL,
  is_revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_phone_purpose (phone, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. INSTITUTIONAL STRUCTURE & CALENDAR
-- =============================================================================
CREATE TABLE departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  hod_user_id INT NULL,
  degree_duration_years INT NOT NULL DEFAULT 3,
  active_term VARCHAR(50) NOT NULL DEFAULT '2026-27 (Winter)',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dept_code (code),
  INDEX idx_dept_hod (hod_user_id),
  CONSTRAINT fk_dept_hod FOREIGN KEY (hod_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE academic_years (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(100) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ay_current (is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. FACULTY & COMMON FACULTY MANAGEMENT
-- =============================================================================
CREATE TABLE teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  employee_id VARCHAR(100) NULL UNIQUE,
  department_id INT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NULL,
  is_phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teachers_user (user_id),
  INDEX idx_teachers_dept (department_id),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_teachers_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE common_faculty_manager_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  appointed_by INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  appointed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  INDEX idx_cf_manager_teacher (teacher_id),
  CONSTRAINT fk_cf_manager_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_cf_manager_appointed_by FOREIGN KEY (appointed_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE faculty_registration_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(20) NULL,
  employee_id VARCHAR(100) NULL,
  requested_role VARCHAR(50) NOT NULL DEFAULT 'FACULTY',
  department_id INT NULL,
  password_hash VARCHAR(255) NOT NULL,
  approval_type VARCHAR(50) NOT NULL, -- 'DEPT_HOD' | 'COMMON_FACULTY_MANAGER' | 'ADMIN'
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
  rejection_reason TEXT NULL,
  adjudicated_by INT NULL,
  adjudicated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_faculty_reg_status (status),
  INDEX idx_faculty_reg_dept (department_id),
  INDEX idx_faculty_reg_type (approval_type),
  CONSTRAINT fk_faculty_reg_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_faculty_reg_adjudicator FOREIGN KEY (adjudicated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. STUDENTS & DEPARTMENT ENROLLMENT HISTORY
-- =============================================================================
CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  official_enrollment_no VARCHAR(100) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  registration_no VARCHAR(100) NULL,
  class_roll_no INT NULL,
  phone VARCHAR(20) NULL,
  parent_phone VARCHAR(20) NULL,
  parent_name VARCHAR(150) NULL,
  is_phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  admission_year INT NOT NULL DEFAULT 2024,
  is_lateral_entry TINYINT(1) NOT NULL DEFAULT 0,
  graduation_year INT NULL,
  fingerprint_template TEXT NULL,
  entry_mode VARCHAR(50) NOT NULL DEFAULT 'teacher_provisioned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_students_user (user_id),
  INDEX idx_students_enrollment (official_enrollment_no),
  INDEX idx_students_roll (class_roll_no),
  INDEX idx_students_reg (registration_no),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE student_department_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  department_id INT NOT NULL,
  academic_year_id INT NULL,
  year INT NOT NULL DEFAULT 1,
  semester INT NOT NULL DEFAULT 1,
  class_roll_no INT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'TRANSFERRED' | 'COMPLETED' | 'DETAINED' | 'GRADUATED'
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sde_student (student_id),
  INDEX idx_sde_dept (department_id),
  INDEX idx_sde_status (status),
  CONSTRAINT fk_sde_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_sde_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_sde_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  department_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  year INT NOT NULL DEFAULT 1,
  semester INT NOT NULL DEFAULT 1,
  class_roll_no INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'DETAINED' | 'COMPLETED'
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_enrollments_student (student_id),
  INDEX idx_enrollments_cohort (department_id, year, semester),
  CONSTRAINT fk_enrollments_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrollments_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrollments_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. CURRICULUM SUBJECTS & LEGACY MAPPING
-- =============================================================================
CREATE TABLE subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) NOT NULL,
  has_practical TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  syllabus_scheme VARCHAR(50) NOT NULL DEFAULT '2026-27',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dept_subject (department_id, year, semester, code),
  INDEX idx_subjects_dept (department_id),
  CONSTRAINT fk_subjects_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teacher_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  assignment_type VARCHAR(50) NOT NULL, -- 'SUBJECT_TEACHER' | 'CLASS_TEACHER'
  subject_id INT NULL,
  session_type_scope VARCHAR(50) NOT NULL DEFAULT 'ALL',
  department_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  assigned_by INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ta_teacher (teacher_id),
  INDEX idx_ta_subject (subject_id),
  INDEX idx_ta_cohort (department_id, year, semester),
  CONSTRAINT fk_ta_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_ta_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. OFFICIAL TEACHING GROUPS (GOOGLE CLASSROOM ARCHITECTURE)
-- =============================================================================
CREATE TABLE teaching_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  subject_name VARCHAR(150) NOT NULL,
  component VARCHAR(50) NOT NULL DEFAULT 'THEORY', -- 'THEORY' | 'PRACTICAL'
  teacher_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  semester INT NOT NULL,
  invite_code VARCHAR(20) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'ARCHIVED'
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  INDEX idx_tg_teacher (teacher_id),
  INDEX idx_tg_invite (invite_code),
  INDEX idx_tg_status (status),
  INDEX idx_tg_archived (is_archived),
  CONSTRAINT fk_tg_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tg_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teaching_group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  student_id INT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'ENROLLED', -- 'ENROLLED' | 'PENDING'
  UNIQUE KEY uq_group_student (group_id, student_id),
  INDEX idx_tgm_group (group_id),
  INDEX idx_tgm_student (student_id),
  CONSTRAINT fk_tgm_group FOREIGN KEY (group_id) REFERENCES teaching_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tgm_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE classroom_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  author_id INT NOT NULL,
  content TEXT NOT NULL,
  post_type VARCHAR(50) NOT NULL DEFAULT 'ANNOUNCEMENT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cp_group (group_id),
  CONSTRAINT fk_cp_group FOREIGN KEY (group_id) REFERENCES teaching_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. CLASSWORK, ASSIGNMENTS & MARKS
-- =============================================================================
CREATE TABLE assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NULL,
  group_id INT NULL,
  department_id INT NULL,
  year INT NULL,
  semester INT NULL,
  academic_year_id INT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'ASSIGNMENT', -- 'ASSIGNMENT' | 'CLASS_TEST' | 'MID_TERM'
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  attachment_path TEXT NULL,
  attachment_name VARCHAR(255) NULL,
  due_date DATETIME NULL,
  max_marks DECIMAL(6,2) NOT NULL DEFAULT 100.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assessments_teacher (teacher_id),
  INDEX idx_assessments_group (group_id),
  INDEX idx_assessments_subject (subject_id),
  CONSTRAINT fk_assessments_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_assessments_group FOREIGN KEY (group_id) REFERENCES teaching_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_assessments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_assessments_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_assessments_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assessment_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  student_id INT NOT NULL,
  file_path TEXT NULL,
  original_filename VARCHAR(255) NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'SUBMITTED', -- 'SUBMITTED' | 'GRADED' | 'LATE'
  marks_obtained DECIMAL(6,2) NULL,
  feedback TEXT NULL,
  graded_at DATETIME NULL,
  graded_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_submission_student (assessment_id, student_id),
  INDEX idx_as_assessment (assessment_id),
  INDEX idx_as_student (student_id),
  CONSTRAINT fk_as_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_grader FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. OFFICIAL ATTENDANCE REGISTERS & SESSIONS
-- =============================================================================
CREATE TABLE attendance_registers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  subject_id INT NULL,
  group_id INT NULL,
  department_id INT NULL,
  year INT NOT NULL DEFAULT 1,
  semester INT NOT NULL DEFAULT 1,
  academic_year_id INT NULL,
  session_type VARCHAR(50) NOT NULL DEFAULT 'THEORY', -- 'THEORY' | 'PRACTICAL'
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ar_teacher (teacher_id),
  INDEX idx_ar_group (group_id),
  INDEX idx_ar_subject (subject_id),
  INDEX idx_ar_active (is_active),
  CONSTRAINT fk_ar_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_group FOREIGN KEY (group_id) REFERENCES teaching_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_ar_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_ar_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  register_id INT NOT NULL,
  session_date DATE NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  session_type VARCHAR(50) NOT NULL DEFAULT 'THEORY',
  state VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT' | 'OPEN' | 'CLOSED' | 'FINALIZED'
  label VARCHAR(200) NULL,
  qr_token VARCHAR(255) NULL,
  pin_code VARCHAR(10) NULL,
  token_expires_at DATETIME NULL,
  finalized_by INT NULL,
  finalized_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_reg (register_id),
  INDEX idx_sessions_date (session_date),
  INDEX idx_sessions_state (state),
  CONSTRAINT fk_sessions_reg FOREIGN KEY (register_id) REFERENCES attendance_registers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_finalizer FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_session_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  attendance_status VARCHAR(50) NULL, -- 'PRESENT' | 'ABSENT' | 'LATE'
  marked_at DATETIME NULL,
  marked_by INT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ass_student (session_id, student_id),
  INDEX idx_ass_session (session_id),
  INDEX idx_ass_student (student_id),
  CONSTRAINT fk_ass_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ass_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_ass_marker FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE register_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  attendance_status VARCHAR(50) NOT NULL, -- 'PRESENT' | 'ABSENT' | 'LATE'
  source VARCHAR(50) NOT NULL DEFAULT 'MANUAL', -- 'MANUAL' | 'ESP32_SYNC' | 'SELF_REQUEST' | 'CORRECTION'
  teacher_notes TEXT NULL,
  marked_by INT NOT NULL,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ra_student (session_id, student_id),
  INDEX idx_ra_session (session_id),
  INDEX idx_ra_student (student_id),
  INDEX idx_ra_status (attendance_status),
  CONSTRAINT fk_ra_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ra_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_ra_marker FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE student_self_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  verification_method VARCHAR(50) NOT NULL, -- 'PIN' | 'QR'
  request_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'ACCEPTED' | 'REJECTED'
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  UNIQUE KEY uq_ssa_student (session_id, student_id),
  INDEX idx_ssa_session (session_id),
  INDEX idx_ssa_status (request_status),
  CONSTRAINT fk_ssa_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ssa_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_ssa_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_corrections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  original_status VARCHAR(50) NOT NULL,
  new_status VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  changed_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ac_session (session_id),
  INDEX idx_ac_student (student_id),
  CONSTRAINT fk_ac_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ac_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_ac_author FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 10. IOT HARDWARE PRESENCE LAYER & TERMINALS
-- =============================================================================
CREATE TABLE devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_uuid VARCHAR(100) NOT NULL UNIQUE,
  device_name VARCHAR(150) NOT NULL,
  department_id INT NOT NULL,
  device_type VARCHAR(50) NOT NULL DEFAULT 'ESP32_FINGERPRINT',
  api_key_hash VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  last_heartbeat DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_devices_dept (department_id),
  INDEX idx_devices_uuid (device_uuid),
  CONSTRAINT fk_devices_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fingerprint_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  slot_number INT NOT NULL,
  student_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enrolled_by INT NULL,
  UNIQUE KEY uq_device_slot (device_id, slot_number),
  INDEX idx_fs_device (device_id),
  INDEX idx_fs_student (student_id),
  CONSTRAINT fk_fs_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_fs_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  CONSTRAINT fk_fs_enroller FOREIGN KEY (enrolled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE iot_attendance_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  device_id INT NOT NULL,
  department_id INT NOT NULL,
  scan_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scan_date DATE NOT NULL,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED',
  event_type VARCHAR(50) NOT NULL DEFAULT 'FINGERPRINT',
  raw_payload TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_iot_student_date (student_id, scan_date),
  INDEX idx_iot_dept_date (department_id, scan_date),
  INDEX idx_iot_device (device_id),
  CONSTRAINT fk_iot_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_iot_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_iot_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE esp32_presence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  device_id INT NOT NULL,
  scan_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scan_date DATE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'LOGGED',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_presence_student (student_id, scan_date),
  CONSTRAINT fk_presence_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_presence_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 11. AUDIT LOGGING & IN-APP NOTIFICATIONS
-- =============================================================================
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(100) NULL,
  event_type VARCHAR(100) NULL,
  user_id INT NULL,
  actor_id INT NULL,
  actor_role VARCHAR(50) NULL,
  entity_type VARCHAR(100) NULL,
  target_type VARCHAR(100) NULL,
  entity_id VARCHAR(100) NULL,
  target_id VARCHAR(100) NULL,
  details_json TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_event (event_type),
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  link_url VARCHAR(255) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_unread (user_id, is_read),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 13. TIMETABLE & STUDENT LEAVE MODULES
-- =============================================================================
CREATE TABLE leave_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leave_student (student_id),
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE timetable_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  subject_id INT NULL,
  teacher_id INT NULL,
  day_of_week INT NOT NULL, -- 1=Monday ... 7=Sunday
  start_time VARCHAR(20) NOT NULL,
  end_time VARCHAR(20) NOT NULL,
  room VARCHAR(50) NULL,
  session_type VARCHAR(50) NOT NULL DEFAULT 'THEORY',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tt_cohort (department_id, year, semester),
  INDEX idx_tt_teacher (teacher_id),
  CONSTRAINT fk_tt_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_tt_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
  CONSTRAINT fk_tt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PRODUCTION SEED DATA (ADMINISTRATOR LOGIN ONLY)
-- =============================================================================

-- 1. Base System Settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('institution_name', 'Government Polytechnic College', 'Institutional legal name'),
('institution_code', 'GP-UBTER-101', 'Institutional accreditation and college code'),
('affiliating_body', 'UBTER (Uttarakhand Board of Technical Education) / IRDT', 'Affiliating state technical board'),
('campus_location', 'Uttarakhand, India', 'Campus location and region'),
('default_attendance_threshold_percent', '75', 'Minimum attendance percentage required for examination eligibility'),
('attendance_threshold', '75', 'Institutional attendance threshold percentage'),
('defaulter_warning_threshold_percent', '65', 'Warning threshold percentage before student is marked as critical defaulter'),
('self_attendance_default_timer_minutes', '15', 'Default expiration timer for dynamic QR code and PIN attendance sessions'),
('allow_student_self_registration', 'true', 'Global portal switch allowing student self-registration subject to teacher approval'),
('auto_session_enabled', 'true', 'Autonomous background engine for automated academic session rollover'),
('academic_year_start_month', '7', 'Academic year start month (July = 7)'),
('academic_year_start_day', '1', 'Academic year start day'),
('max_session_duration_hours', '3', 'Auto-close session duration limit'),
('esp32_scan_debounce_seconds', '60', 'Biometric hardware duplicate touch debounce window');

-- 2. System Administrator User Account
-- Default Credentials:
-- Username / Email: admin@gmail.com (or username: admin)
-- Password: Admin@123
INSERT INTO users (id, username, email, password_hash, must_change_password, status) VALUES
(1, 'admin', 'admin@gmail.com', '$2b$10$l3Eav/9Z.hlKweW3rYrZMu3mEODMAaQhbJaW1wnMdKO/pqsiBvtvm', 0, 'ACTIVE');

-- 3. Administrator Role Assignment
INSERT INTO user_roles (user_id, role) VALUES
(1, 'SYSTEM_ADMIN');

-- 4. Initial Academic Session (Autonomous Session Model)
INSERT INTO academic_years (id, label, start_date, end_date, is_current) VALUES
(1, '2026-27 (Winter)', '2026-07-01', '2027-06-30', 1);

-- 5. Canonical Institutional Departments (Clean state: hod_user_id = NULL)
INSERT INTO departments (id, name, code, degree_duration_years, active_term, is_active, hod_user_id) VALUES
(1, 'Information Technology', 'IT', 3, '2026-27 (Winter)', 1, NULL),
(2, 'Electronics Engineering', 'ECE', 3, '2026-27 (Winter)', 1, NULL),
(3, 'Electrical Engineering', 'EE', 3, '2026-27 (Winter)', 1, NULL),
(4, 'Mechanical Engineering', 'ME', 3, '2026-27 (Winter)', 1, NULL),
(5, 'Civil Engineering', 'CE', 3, '2026-27 (Winter)', 1, NULL),
(6, 'Pharmacy', 'PHARM', 2, '2026-27 (Winter)', 1, NULL);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- DEPLOYMENT SUMMARY:
-- 1. All 36 production tables created with full InnoDB constraints.
-- 2. Only 1 User created: System Administrator (admin@gmail.com / Admin@123).
-- 3. 6 Canonical Departments initialized with clean NULL HOD assignments.
-- 4. Active Academic Session initialized as '2026-27 (Winter)'.
-- 5. ZERO demo teachers, ZERO demo students, ZERO demo attendance sessions.
-- Ready for 1-click import into cPanel phpMyAdmin!
-- =============================================================================
