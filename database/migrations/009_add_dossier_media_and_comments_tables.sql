-- Migration 009: Add Academic Dossier (Theory, Lab, Student Performance, Assessment Process), Course Files, Faculty Media Assets, and Classroom Comments
-- Supports: theory_class_files, theory_class_documents, lab_class_files, lab_class_documents,
--           student_performance_files, student_performance_documents, assessment_process_files, assessment_process_documents,
--           course_files, course_file_documents, faculty_media_assets, classroom_post_comments

CREATE TABLE IF NOT EXISTS theory_class_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teaching_group_id INT NULL,
  subject_id INT NULL,
  teacher_id INT NOT NULL,
  department_id INT NULL,
  semester INT DEFAULT 1,
  academic_year_id INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
  hod_remarks TEXT NULL,
  audited_by INT NULL,
  audited_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tcf_tg (teaching_group_id),
  KEY idx_tcf_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS theory_class_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  theory_class_id INT NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  notes TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tcd_file_key (theory_class_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_class_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teaching_group_id INT NULL,
  subject_id INT NULL,
  teacher_id INT NOT NULL,
  department_id INT NULL,
  semester INT DEFAULT 1,
  academic_year_id INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
  hod_remarks TEXT NULL,
  audited_by INT NULL,
  audited_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lcf_tg (teaching_group_id),
  KEY idx_lcf_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_class_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_class_id INT NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  notes TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lcd_file_key (lab_class_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_performance_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teaching_group_id INT NULL,
  subject_id INT NULL,
  teacher_id INT NOT NULL,
  department_id INT NULL,
  semester INT DEFAULT 1,
  academic_year_id INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
  hod_remarks TEXT NULL,
  audited_by INT NULL,
  audited_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_spf_tg (teaching_group_id),
  KEY idx_spf_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_performance_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  performance_file_id INT NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  notes TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_spd_file_key (performance_file_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessment_process_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teaching_group_id INT NULL,
  subject_id INT NULL,
  teacher_id INT NOT NULL,
  department_id INT NULL,
  semester INT DEFAULT 1,
  academic_year_id INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
  hod_remarks TEXT NULL,
  audited_by INT NULL,
  audited_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_apf_tg (teaching_group_id),
  KEY idx_apf_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessment_process_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_file_id INT NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  notes TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_apd_file_key (assessment_file_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS course_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teaching_group_id INT NULL,
  subject_id INT NULL,
  teacher_id INT NOT NULL,
  department_id INT NULL,
  semester INT DEFAULT 1,
  academic_year_id INT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
  hod_remarks TEXT NULL,
  audited_by INT NULL,
  audited_at DATETIME NULL,
  copo_matrix JSON NULL,
  course_outcomes JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cf_tg (teaching_group_id),
  KEY idx_cf_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS course_file_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_file_id INT NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  notes TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cfd_file_key (course_file_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS faculty_media_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  faculty_id INT NOT NULL,
  department_id INT NOT NULL DEFAULT 1,
  subject_id INT NULL,
  student_id INT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT NOT NULL,
  category VARCHAR(100) DEFAULT 'LECTURE_NOTES',
  tags VARCHAR(255) NULL,
  is_public_to_students TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_fma_faculty (faculty_id),
  KEY idx_fma_dept (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classroom_post_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  author_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpc_post (post_id),
  KEY idx_cpc_author (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
