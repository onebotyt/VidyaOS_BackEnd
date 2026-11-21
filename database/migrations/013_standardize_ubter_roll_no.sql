-- Migration 013: Standardize Enrollment No to UBTER Roll No
-- Adds ubter_roll_no to students table with seamless fallback to official_enrollment_no

ALTER TABLE students ADD COLUMN IF NOT EXISTS ubter_roll_no VARCHAR(100) NULL AFTER class_roll_no;

UPDATE students 
SET ubter_roll_no = official_enrollment_no 
WHERE ubter_roll_no IS NULL AND official_enrollment_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_ubter_roll_no ON students (ubter_roll_no);
