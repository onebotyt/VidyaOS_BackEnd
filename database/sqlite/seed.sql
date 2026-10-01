-- SQLite Seed Data: seed.sql
-- Master data for local testing

-- 1. System Admin (admin / AdminPassword123!)
INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
VALUES (1, 'admin', 'admin@college.local', '$2b$12$9nhYlP5dXFySfIuNlao5kO16/jAF69G0XIrwpZBJWh6CK.xLCfFma', 0, 'ACTIVE');

INSERT OR IGNORE INTO user_roles (user_id, role)
VALUES (1, 'SYSTEM_ADMIN');

-- 2. Faculty User (prof.sharma / Teacher123!)
INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
VALUES (2, 'prof.sharma', 'prof.sharma@college.local', '$2b$12$u1XpfEpXkbs6mzBiPnJmD.tB8NAnshSU5gHPTVUsqo6Kk5iYTUXvC', 0, 'ACTIVE');

INSERT OR IGNORE INTO user_roles (user_id, role)
VALUES (2, 'TEACHER');

INSERT OR IGNORE INTO teachers (id, user_id, employee_id, full_name, phone)
VALUES (1, 2, 'EMP-IT-001', 'Prof. Ramesh Sharma', '9876543210');

-- 3. Student User (2024IT001 / Student123!)
INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
VALUES (3, '2024IT001', 'rahul.sharma@student.local', '$2b$12$Eo/IdByc2kGGJUvwR4aA..ddrzbQ1lG/0KhcyGUQ0i/DYvIja7bIO', 0, 'ACTIVE');

INSERT OR IGNORE INTO user_roles (user_id, role)
VALUES (3, 'STUDENT');

INSERT OR IGNORE INTO students (id, user_id, official_enrollment_no, full_name, entry_mode)
VALUES (1, 3, '2024IT001', 'Rahul Sharma', 'teacher_provisioned');

-- 4. Master Departments
INSERT OR IGNORE INTO departments (id, name, code, is_active) VALUES
(1, 'Information Technology', 'IT', 1),
(2, 'Computer Engineering', 'CE', 1),
(3, 'Mechanical Engineering', 'ME', 1),
(4, 'Civil Engineering', 'CL', 1),
(5, 'Electrical Engineering', 'EE', 1);

-- 5. Master Branches
INSERT OR IGNORE INTO branches (id, department_id, name, code, is_active) VALUES
(1, 1, 'B.Tech - Information Technology', 'BTECH', 1),
(2, 1, 'Diploma - Information Technology', 'DIP', 1),
(3, 2, 'B.Tech - Computer Engineering', 'BTECH', 1),
(4, 2, 'Diploma - Computer Engineering', 'DIP', 1),
(5, 3, 'B.Tech - Mechanical Engineering', 'BTECH', 1),
(6, 4, 'B.Tech - Civil Engineering', 'BTECH', 1),
(7, 5, 'B.Tech - Electrical Engineering', 'BTECH', 1);

-- 6. Academic Year
INSERT OR IGNORE INTO academic_years (id, label, start_date, end_date, is_current) VALUES
(1, '2026-27', '2026-07-01', '2027-06-30', 1);

-- 7. IT Year 2 Sem 4 Core Subjects
INSERT OR IGNORE INTO subjects (id, department_id, branch_id, year, semester, name, code, is_active) VALUES
(1, 1, 1, 2, 4, 'Database Management Systems', 'IT401', 1),
(2, 1, 1, 2, 4, 'Operating Systems', 'IT402', 1),
(3, 1, 1, 2, 4, 'Computer Networks', 'IT403', 1),
(4, 1, 1, 2, 4, 'Software Engineering', 'IT404', 1),
(5, 1, 1, 2, 4, 'Design and Analysis of Algorithms', 'IT405', 1);

-- 8. Teacher Dynamic Assignments
-- Prof Sharma: Subject Teacher for IT401, Class Teacher for IT Year 2 Sem 4, HOD for IT
INSERT OR IGNORE INTO teacher_assignments (id, teacher_id, assignment_type, subject_id, department_id, branch_id, year, semester, academic_year_id, session_type_scope, assigned_by)
VALUES 
(1, 1, 'SUBJECT_TEACHER', 1, 1, 1, 2, 4, 1, 'THEORY', 1),
(2, 1, 'CLASS_TEACHER', NULL, 1, 1, 2, 4, 1, 'ALL', 1),
(3, 1, 'HOD', NULL, 1, 1, 2, 4, 1, 'ALL', 1);

-- 8b. Official Digital Attendance Register (auto-created from assignment)
INSERT OR IGNORE INTO attendance_registers (id, teacher_id, name, subject_id, assignment_id, department_id, branch_id, year, semester, academic_year_id, session_type_scope, is_official, is_active)
VALUES
(1, 1, 'Database Management Systems THEORY — 2026-27', 1, 1, 1, 1, 2, 4, 1, 'THEORY', 1, 1);

-- 9. Student Enrollment in IT Year 2 Sem 4, Roll 1
INSERT OR IGNORE INTO enrollments (id, student_id, department_id, branch_id, year, semester, academic_year_id, class_roll_no, status)
VALUES (1, 1, 1, 1, 2, 4, 1, 1, 'ENROLLED');

-- 10. Hardware Device (ESP32 Terminal in Lab 3)
INSERT OR IGNORE INTO devices (id, device_uid, name, department_id, branch_id, year, semester, academic_year_id, secret_hash, is_active)
VALUES (1, 'ESP32_LAB3_01', 'IT Lab 3 Entrance Terminal', 1, 1, 2, 4, 1, 'default_secret', 1);

-- 11. Biometric Slot 1 mapped to Rahul Sharma
INSERT OR IGNORE INTO fingerprint_slots (id, device_id, slot_id, student_id, is_active)
VALUES (1, 1, 1, 1, 1);

-- 12. System Configuration
INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
('default_attendance_threshold_percent', '75', 'Minimum attendance percentage required for examination eligibility'),
('institution_name', 'Government Polytechnic College', 'Official college or university name displayed on reports'),
('institution_code', 'GP-UBTER-101', 'Institutional accreditation code'),
('self_attendance_default_timer_minutes', '15', 'Default expiration timer for PIN and QR soft self-attendance sessions'),
('allow_student_self_registration', 'true', 'Global toggle for fallback student self-registration portal');
