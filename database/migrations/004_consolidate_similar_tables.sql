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
