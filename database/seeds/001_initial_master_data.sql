-- =============================================================================
-- Seed Data: 001_initial_master_data.sql
-- Project: UIAP College Biometric Attendance System (v1.0 Authoritative Baseline)
-- Target DBMS: MySQL 8.x
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Initial System Admin Account
-- Default password: AdminPassword123! (bcrypt hash)
-- -----------------------------------------------------------------------------
INSERT INTO users (id, username, email, password_hash, must_change_password, status)
VALUES (1, 'admin', 'admin@college.local', '$2b$12$dQm6B2PzUuKsmjTqfPXeYeXQ4d6U8Z3q.J0wY6v9cK7aL3mNoPqRs', FALSE, 'ACTIVE')
ON DUPLICATE KEY UPDATE username=VALUES(username);

INSERT INTO user_roles (user_id, role)
VALUES (1, 'SYSTEM_ADMIN')
ON DUPLICATE KEY UPDATE role=VALUES(role);

-- -----------------------------------------------------------------------------
-- 2. Master Academic Departments
-- -----------------------------------------------------------------------------
INSERT INTO departments (id, name, code, is_active) VALUES
(1, 'Information Technology', 'IT', TRUE),
(2, 'Computer Engineering', 'CE', TRUE),
(3, 'Mechanical Engineering', 'ME', TRUE),
(4, 'Civil Engineering', 'CL', TRUE),
(5, 'Electrical Engineering', 'EE', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 3. Master Academic Branches
-- -----------------------------------------------------------------------------
INSERT INTO branches (id, department_id, name, code, is_active) VALUES
(1, 1, 'B.Tech - Information Technology', 'BTECH', TRUE),
(2, 1, 'Diploma - Information Technology', 'DIP', TRUE),
(3, 2, 'B.Tech - Computer Engineering', 'BTECH', TRUE),
(4, 2, 'Diploma - Computer Engineering', 'DIP', TRUE),
(5, 3, 'B.Tech - Mechanical Engineering', 'BTECH', TRUE),
(6, 4, 'B.Tech - Civil Engineering', 'BTECH', TRUE),
(7, 5, 'B.Tech - Electrical Engineering', 'BTECH', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 4. Active Academic Year
-- -----------------------------------------------------------------------------
INSERT INTO academic_years (id, label, start_date, end_date, is_current) VALUES
(1, '2026-27', '2026-07-01', '2027-06-30', TRUE)
ON DUPLICATE KEY UPDATE is_current=VALUES(is_current);

-- -----------------------------------------------------------------------------
-- 5. Core Subjects for IT (Year 2, Semester 4)
-- -----------------------------------------------------------------------------
INSERT INTO subjects (id, department_id, branch_id, year, semester, name, code, is_active) VALUES
(1, 1, 1, 2, 4, 'Database Management Systems', 'IT401', TRUE),
(2, 1, 1, 2, 4, 'Operating Systems', 'IT402', TRUE),
(3, 1, 1, 2, 4, 'Computer Networks', 'IT403', TRUE),
(4, 1, 1, 2, 4, 'Software Engineering', 'IT404', TRUE),
(5, 1, 1, 2, 4, 'Design and Analysis of Algorithms', 'IT405', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 6. Initial System Configuration Settings
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('default_attendance_threshold_percent', '75', 'Minimum attendance percentage required for examination eligibility'),
('institution_name', 'Universal Institute of Technology', 'Official college or university name displayed on reports'),
('institution_code', 'UIT-101', 'Institutional accreditation code'),
('self_attendance_default_timer_minutes', '15', 'Default expiration timer for PIN and QR soft self-attendance sessions'),
('allow_student_self_registration', 'true', 'Global toggle for fallback student self-registration portal')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);
