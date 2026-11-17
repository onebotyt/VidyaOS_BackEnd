-- Migration 010: Student Documents Archive & Permanent Access Table
CREATE TABLE IF NOT EXISTS student_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  department_id INT NULL,
  title VARCHAR(255) NOT NULL,
  document_type VARCHAR(100) NOT NULL DEFAULT 'ACADEMIC_RECORD',
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  uploader_name VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sdoc_student (student_id),
  INDEX idx_sdoc_dept (department_id),
  INDEX idx_sdoc_type (document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
