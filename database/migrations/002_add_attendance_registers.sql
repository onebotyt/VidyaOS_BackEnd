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
