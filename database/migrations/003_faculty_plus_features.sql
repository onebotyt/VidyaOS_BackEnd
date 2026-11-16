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
