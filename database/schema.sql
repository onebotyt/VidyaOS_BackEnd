-- =============================================================================
-- VidyaOS Institutional Campus OS — MySQL 8.x / MariaDB Authoritative Schema
-- Engine: InnoDB | Character Set: utf8mb4 | Collation: utf8mb4_unicode_ci
-- =============================================================================

-- =============================================================================
-- Migration: 001_initial_schema.sql
-- Project: UIAP College Biometric Attendance System (v1.0 Authoritative Baseline)
-- Target DBMS: MySQL 8.x
-- Engine: InnoDB
-- Character Set: utf8mb4
-- Collation: utf8mb4_unicode_ci
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- Clean Drop (Ordered for safe re-runs in development / migrations)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS device_events;
DROP TABLE IF EXISTS fingerprint_slots;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS student_self_attendance;
DROP TABLE IF EXISTS register_attendance;
DROP TABLE IF EXISTS esp32_presence;
DROP TABLE IF EXISTS attendance_session_qr;
DROP TABLE IF EXISTS attendance_session_pins;
DROP TABLE IF EXISTS attendance_session_students;
DROP TABLE IF EXISTS attendance_sessions;
DROP TABLE IF EXISTS cohort_registration_settings;
DROP TABLE IF EXISTS teacher_assignments;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS system_settings;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 1. SYSTEM CONFIGURATION & SETTINGS
-- =============================================================================

CREATE TABLE system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_system_settings_key UNIQUE (setting_key),
  CONSTRAINT chk_settings_key CHECK (LENGTH(TRIM(setting_key)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. CENTRAL AUTHENTICATION & USERS
-- Architectural Invariant: For students, users.username MUST strictly equal
-- students.official_enrollment_no (e.g. '2024IT047').
-- =============================================================================

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(150) NULL,
  password_hash VARCHAR(255) NULL,
  temp_password_hash VARCHAR(255) NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  google_sub VARCHAR(255) NULL,
  status ENUM('PROVISIONED', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  rejection_reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_google_sub UNIQUE (google_sub),
  CONSTRAINT chk_users_username CHECK (LENGTH(TRIM(username)) > 0),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. SYSTEM ROLES (Clean RBAC - No Academic Scopes in Roles)
-- =============================================================================

CREATE TABLE user_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role ENUM('SYSTEM_ADMIN', 'TEACHER', 'STUDENT') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role),
  INDEX idx_user_roles_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. ACTIVE USER SESSIONS & REFRESH TOKENS
-- =============================================================================

CREATE TABLE user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(45) NULL,
  expires_at DATETIME NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_user_sessions_token UNIQUE (refresh_token_hash),
  INDEX idx_user_sessions_lookup (user_id, is_revoked, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. ACADEMIC MASTER HIERARCHY (Database-Backed & Seeded)
-- =============================================================================

CREATE TABLE departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_departments_name UNIQUE (name),
  CONSTRAINT uq_departments_code UNIQUE (code),
  CONSTRAINT chk_departments_code CHECK (LENGTH(TRIM(code)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_branches_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT uq_branches_dept_code UNIQUE (department_id, code),
  CONSTRAINT chk_branches_code CHECK (LENGTH(TRIM(code)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE academic_years (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_academic_years_label UNIQUE (label),
  CONSTRAINT chk_ay_dates CHECK (end_date > start_date),
  INDEX idx_academic_years_current (is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_subjects_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subjects_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT uq_subjects_cohort_code UNIQUE (department_id, branch_id, year, semester, code),
  CONSTRAINT chk_subjects_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_subjects_semester CHECK (semester BETWEEN 1 AND 8),
  INDEX idx_subjects_cohort (department_id, branch_id, year, semester, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. FACULTY PROFILES & ACADEMIC ASSIGNMENTS (Dynamic Scopes)
-- =============================================================================

CREATE TABLE teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  employee_id VARCHAR(50) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_teachers_user_id UNIQUE (user_id),
  CONSTRAINT uq_teachers_employee_id UNIQUE (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teacher_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  assignment_type ENUM('SUBJECT_TEACHER', 'CLASS_TEACHER', 'HOD') NOT NULL,
  subject_id INT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  assigned_by INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ta_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ta_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ta_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ta_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ta_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ta_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_ta_semester CHECK (semester BETWEEN 1 AND 8),
  CONSTRAINT chk_ta_subject_required CHECK (assignment_type != 'SUBJECT_TEACHER' OR subject_id IS NOT NULL),
  INDEX idx_ta_teacher_lookup (teacher_id, assignment_type, is_active),
  INDEX idx_ta_cohort (department_id, branch_id, year, semester, academic_year_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. STUDENTS & COHORT ENROLLMENTS
-- =============================================================================

CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  official_enrollment_no VARCHAR(50) NOT NULL,
  ubter_roll_no VARCHAR(100) NULL,
  full_name VARCHAR(150) NOT NULL,
  entry_mode ENUM('teacher_provisioned', 'self_registered', 'admin_created') NOT NULL DEFAULT 'teacher_provisioned',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_students_user_id UNIQUE (user_id),
  CONSTRAINT uq_students_official_enrollment_no UNIQUE (official_enrollment_no),
  CONSTRAINT chk_students_enrollment_no CHECK (LENGTH(TRIM(official_enrollment_no)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  class_roll_no INT NOT NULL,
  status ENUM('ENROLLED', 'COMPLETED', 'PROMOTED', 'DROPPED') NOT NULL DEFAULT 'ENROLLED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_enrollments_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrollments_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollments_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollments_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT uq_enrollments_cohort_roll_no UNIQUE (department_id, branch_id, year, semester, academic_year_id, class_roll_no),
  CONSTRAINT uq_enrollments_student_year UNIQUE (student_id, academic_year_id),
  CONSTRAINT chk_enrollments_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_enrollments_semester CHECK (semester BETWEEN 1 AND 8),
  CONSTRAINT chk_enrollments_roll_no CHECK (class_roll_no > 0),
  INDEX idx_enrollments_cohort (department_id, branch_id, year, semester, academic_year_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cohort_registration_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  registration_open BOOLEAN NOT NULL DEFAULT TRUE,
  changed_by INT NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_crs_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_crs_cohort UNIQUE (department_id, branch_id, year, semester, academic_year_id),
  CONSTRAINT chk_crs_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_crs_semester CHECK (semester BETWEEN 1 AND 8)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. ATTENDANCE SESSIONS & ROSTER SNAPSHOTS
-- =============================================================================

CREATE TABLE attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  session_type ENUM('THEORY', 'PRACTICAL', 'TUTORIAL', 'EXTRA') NOT NULL DEFAULT 'THEORY',
  label VARCHAR(100) NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  state ENUM('DRAFT', 'OPEN', 'CLOSED', 'FINALIZED') NOT NULL DEFAULT 'DRAFT',
  auto_close_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT chk_sessions_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_sessions_semester CHECK (semester BETWEEN 1 AND 8),
  CONSTRAINT chk_sessions_end_time CHECK (end_time IS NULL OR end_time >= start_time),
  INDEX idx_sessions_cohort_time (department_id, branch_id, year, semester, academic_year_id, start_time),
  INDEX idx_sessions_teacher_state (teacher_id, state),
  INDEX idx_sessions_subject_state (subject_id, academic_year_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_session_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  enrollment_id INT NOT NULL,
  class_roll_no INT NOT NULL,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ass_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ass_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ass_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE RESTRICT,
  CONSTRAINT uq_ass_session_student UNIQUE (session_id, student_id),
  CONSTRAINT chk_ass_roll_no CHECK (class_roll_no > 0),
  INDEX idx_ass_session_included (session_id, included)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_session_pins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  pin_code VARCHAR(10) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pins_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT chk_pins_format CHECK (LENGTH(pin_code) = 6),
  INDEX idx_pins_lookup (session_id, pin_code, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_session_qr (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  INDEX idx_qr_lookup (session_id, token_hash, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. HARDWARE DEVICES & OPTICAL FINGERPRINT SLOTS
-- =============================================================================

CREATE TABLE devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_uid VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  secret_hash VARCHAR(255) NOT NULL,
  certificate_fingerprint VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_heartbeat_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_devices_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devices_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devices_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT uq_devices_uid UNIQUE (device_uid),
  CONSTRAINT chk_devices_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT chk_devices_semester CHECK (semester BETWEEN 1 AND 8),
  INDEX idx_devices_cohort (department_id, branch_id, year, semester, academic_year_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fingerprint_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  slot_id INT NOT NULL,
  student_id INT NOT NULL,
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_fps_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_fps_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT uq_fps_device_slot UNIQUE (device_id, slot_id),
  CONSTRAINT uq_fps_device_student UNIQUE (device_id, student_id),
  CONSTRAINT chk_fps_slot_range CHECK (slot_id BETWEEN 1 AND 1000),
  INDEX idx_fps_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE device_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  event_type ENUM('HEARTBEAT', 'SCAN_SYNC', 'COMMAND_ACK', 'ERROR') NOT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_de_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_de_device_type_time (device_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 10. THREE INDEPENDENT ATTENDANCE STREAMS
-- =============================================================================

-- Stream 1: Raw Physical Presence Evidence from ESP32
-- Deduplication: Strictly UNIQUE(event_id) for transmission retries.
-- Multiple distinct scans on the same day are retained as physical evidence.
CREATE TABLE esp32_presence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  device_id INT NOT NULL,
  student_id INT NOT NULL,
  scan_time DATETIME NOT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_esp32_p_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE RESTRICT,
  CONSTRAINT fk_esp32_p_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT uq_esp32_p_event_id UNIQUE (event_id),
  INDEX idx_esp32_p_student_time (student_id, scan_time),
  INDEX idx_esp32_p_device_time (device_id, scan_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stream 2: Authoritative Official Teacher Attendance Register
-- Separates attendance_status (PRESENT/ABSENT/LATE) from source (MANUAL/ESP32_SYNC/SELF_REQUEST).
CREATE TABLE register_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  attendance_status ENUM('PRESENT', 'ABSENT', 'LATE') NOT NULL,
  source ENUM('MANUAL', 'ESP32_SYNC', 'SELF_REQUEST') NOT NULL DEFAULT 'MANUAL',
  teacher_notes TEXT NULL,
  marked_by INT NOT NULL,
  marked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ra_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ra_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ra_marked_by FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_ra_session_student UNIQUE (session_id, student_id),
  INDEX idx_ra_student_status (student_id, attendance_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stream 3: Soft Mobile Self-Attendance Verification Requests
CREATE TABLE student_self_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  verification_method ENUM('PIN', 'QR', 'MANUAL_REQUEST') NOT NULL,
  request_status ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT NULL,
  CONSTRAINT fk_ssa_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ssa_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ssa_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ssa_session_student UNIQUE (session_id, student_id),
  INDEX idx_ssa_session_status (session_id, request_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 11. NOTIFICATIONS & IMMUTABLE AUDIT TRAIL
-- =============================================================================

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  link_url VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NULL,
  details_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_user_action (user_id, action, created_at),
  INDEX idx_audit_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- 1. Initial System Admin Account
-- Default password: AdminPassword123!
INSERT INTO users (id, username, email, password_hash, must_change_password, status)
VALUES (1, 'admin', 'admin@college.local', '$2b$12$dQm6B2PzUuKsmjTqfPXeYeXQ4d6U8Z3q.J0wY6v9cK7aL3mNoPqRs', FALSE, 'ACTIVE')
ON DUPLICATE KEY UPDATE username=VALUES(username);

INSERT INTO user_roles (user_id, role)
VALUES (1, 'SYSTEM_ADMIN')
ON DUPLICATE KEY UPDATE role=VALUES(role);

-- 2. Master Academic Departments
INSERT INTO departments (id, name, code, is_active) VALUES
(1, 'Information Technology', 'IT', TRUE),
(2, 'Computer Engineering', 'CE', TRUE),
(3, 'Mechanical Engineering', 'ME', TRUE),
(4, 'Civil Engineering', 'CL', TRUE),
(5, 'Electrical Engineering', 'EE', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- 3. Master Academic Branches
INSERT INTO branches (id, department_id, name, code, is_active) VALUES
(1, 1, 'B.Tech - Information Technology', 'BTECH', TRUE),
(2, 1, 'Diploma - Information Technology', 'DIP', TRUE),
(3, 2, 'B.Tech - Computer Engineering', 'BTECH', TRUE),
(4, 2, 'Diploma - Computer Engineering', 'DIP', TRUE),
(5, 3, 'B.Tech - Mechanical Engineering', 'BTECH', TRUE),
(6, 4, 'B.Tech - Civil Engineering', 'BTECH', TRUE),
(7, 5, 'B.Tech - Electrical Engineering', 'BTECH', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- 4. Current Academic Year
INSERT INTO academic_years (id, label, start_date, end_date, is_current) VALUES
(1, '2026-27', '2026-07-01', '2027-06-30', TRUE)
ON DUPLICATE KEY UPDATE is_current=VALUES(is_current);

-- 5. Seed Core Subjects for IT (Year 2, Semester 4)
INSERT INTO subjects (id, department_id, branch_id, year, semester, name, code, is_active) VALUES
(1, 1, 1, 2, 4, 'Database Management Systems', 'IT401', TRUE),
(2, 1, 1, 2, 4, 'Operating Systems', 'IT402', TRUE),
(3, 1, 1, 2, 4, 'Computer Networks', 'IT403', TRUE),
(4, 1, 1, 2, 4, 'Software Engineering', 'IT404', TRUE),
(5, 1, 1, 2, 4, 'Design and Analysis of Algorithms', 'IT405', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- 6. Initial System Configuration Settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('default_attendance_threshold_percent', '75', 'Minimum attendance percentage required for examination eligibility'),
('institution_name', 'Universal Institute of Technology', 'Official college or university name displayed on reports'),
('institution_code', 'UIT-101', 'Institutional accreditation code'),
('self_attendance_default_timer_minutes', '15', 'Default expiration timer for PIN and QR soft self-attendance sessions'),
('allow_student_self_registration', 'true', 'Global toggle for fallback student self-registration portal')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);


-- =============================================================================
-- Migration: 002_add_attendance_registers.sql
-- Project: College Attendance Web System (v2.0)
-- Target DBMS: MySQL 8.x
-- Description: Introduces attendance_registers, connects sessions to registers,
--              adds has_practical to subjects and session_type_scope to assignments.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Subject has_practical flag
ALTER TABLE subjects 
  ADD COLUMN has_practical BOOLEAN NOT NULL DEFAULT FALSE AFTER code;

-- 2. Teacher assignment session type scope
ALTER TABLE teacher_assignments 
  ADD COLUMN session_type_scope ENUM('THEORY', 'PRACTICAL', 'ALL') NOT NULL DEFAULT 'ALL' AFTER subject_id;

-- 3. Attendance Registers (Digital Attendance Register Book)
CREATE TABLE IF NOT EXISTS attendance_registers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  subject_id INT NULL,
  assignment_id INT NULL,
  department_id INT NULL,
  branch_id INT NULL,
  year INT NULL,
  semester INT NULL,
  academic_year_id INT NULL,
  session_type_scope ENUM('THEORY', 'PRACTICAL', 'ALL') NOT NULL DEFAULT 'THEORY',
  is_official BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_reg_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reg_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reg_assignment FOREIGN KEY (assignment_id) REFERENCES teacher_assignments(id) ON DELETE SET NULL,
  CONSTRAINT fk_reg_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_reg_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT fk_reg_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
  INDEX idx_reg_teacher (teacher_id, is_active),
  INDEX idx_reg_cohort (department_id, branch_id, year, semester, academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Connect attendance_sessions to attendance_registers
ALTER TABLE attendance_sessions 
  ADD COLUMN register_id INT NOT NULL AFTER id,
  ADD COLUMN session_date DATE NOT NULL AFTER label;

ALTER TABLE attendance_sessions
  ADD CONSTRAINT fk_session_register FOREIGN KEY (register_id) REFERENCES attendance_registers(id) ON DELETE CASCADE,
  ADD INDEX idx_register_session_date (register_id, session_date);

SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================================
-- Migration 003: Faculty+ Features (MySQL 8.x / InnoDB)
-- Adds: Leave Applications, Timetable, Assignments (with file submissions),
--       and Exams/Test Scores.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS leave_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  reviewed_by INT NULL,
  review_note TEXT NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_leave_student (student_id),
  INDEX idx_leave_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS timetable_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  subject_id INT NULL,
  teacher_id INT NULL,
  day_of_week INT NOT NULL,
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  room VARCHAR(100) NULL,
  session_type VARCHAR(30) NOT NULL DEFAULT 'THEORY',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tt_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_tt_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
  INDEX idx_timetable_cohort (department_id, branch_id, year, semester, academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  attachment_path VARCHAR(500) NULL,
  attachment_name VARCHAR(255) NULL,
  due_date DATETIME NULL,
  max_marks INT NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assignments_cohort (department_id, branch_id, year, semester, academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  student_id INT NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  marks_obtained DECIMAL(10,2) NULL,
  feedback TEXT NULL,
  graded_at DATETIME NULL,
  graded_by INT NULL,
  UNIQUE KEY uq_assignment_student (assignment_id, student_id),
  INDEX idx_assignment_submissions_assignment (assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  exam_date DATE NULL,
  max_marks INT NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_exams_cohort (department_id, branch_id, year, semester, academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  student_id INT NOT NULL,
  marks_obtained DECIMAL(10,2) NULL,
  remarks TEXT NULL,
  entered_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_student (exam_id, student_id),
  INDEX idx_exam_scores_exam (exam_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================================
-- Migration 004: Database Schema Consolidation & Simplification (MySQL 8.x)
-- Consolidates assessments and assessment_submissions in InnoDB format.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NULL,
  department_id INT NOT NULL,
  branch_id INT NOT NULL,
  year INT NOT NULL,
  semester INT NOT NULL,
  academic_year_id INT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'ASSIGNMENT',
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  attachment_path VARCHAR(500) NULL,
  attachment_name VARCHAR(255) NULL,
  due_date DATETIME NULL,
  max_marks DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assess_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_assess_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  INDEX idx_assessments_cohort (department_id, branch_id, year, semester, academic_year_id),
  INDEX idx_assessments_teacher (teacher_id),
  INDEX idx_assessments_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  student_id INT NOT NULL,
  file_path VARCHAR(500) NULL,
  original_filename VARCHAR(255) NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  marks_obtained DECIMAL(10,2) NULL,
  feedback TEXT NULL,
  graded_at DATETIME NULL,
  graded_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_submission (assessment_id, student_id),
  CONSTRAINT fk_asub_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_asub_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_asub_grader FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assessment_submissions_assessment (assessment_id),
  INDEX idx_assessment_submissions_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================================
-- Migration 005: Make enrollments.class_roll_no nullable (MySQL 8.x / InnoDB)
-- Reason: Self-registering students do not have a classroom roll number yet.
--         Roll number is assigned by the Class Teacher upon approval.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE enrollments
  MODIFY COLUMN class_roll_no INT NULL;


-- =============================================================================
-- Migration 006: Encrypted ESP32 Biometric Templates, Telemetry & Command Queue
-- Target DBMS: MySQL 8.x / MariaDB (InnoDB)
-- Architecture:
--   1. Slot-Agnostic Cloud Template Vault (student_biometric_templates):
--      Stores portable 512-byte AS608 fingerprint templates directly under
--      student_id so replacing an ESP32 hardware unit requires ZERO student
--      re-registration. Sensor slot numbers are managed exclusively by ESP32
--      in its local W25Q32 SPI Flash.
--   2. Remote Command Queue (esp32_command_queue):
--      Queues remote enrollment, template sync, and buzzer/reboot commands
--      dispatched from the HOD ESP32 Management Portal.
--   3. Hardware Telemetry Columns on devices:
--      Tracks 2S 3.7V battery voltage/percentage, W25Q32 offline queue depth,
--      AS608 local template count, Wi-Fi RSSI, and AES-256 secret key.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS student_biometric_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  department_id INT NULL,
  finger_index TINYINT NOT NULL DEFAULT 1,
  template_base64 LONGTEXT NOT NULL,
  template_sha256 VARCHAR(64) NOT NULL,
  quality_score INT NOT NULL DEFAULT 95,
  captured_by_device_uid VARCHAR(100) NULL,
  enrolled_by INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_finger_template (student_id, finger_index),
  INDEX idx_sbt_student (student_id),
  INDEX idx_sbt_dept (department_id),
  CONSTRAINT fk_sbt_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS esp32_command_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  department_id INT NOT NULL,
  command_type VARCHAR(50) NOT NULL,
  student_id INT NULL,
  payload_json LONGTEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  result_message VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_esp32_cmd_device_status (device_id, status),
  INDEX idx_esp32_cmd_dept (department_id),
  CONSTRAINT fk_esp32_cmd_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
