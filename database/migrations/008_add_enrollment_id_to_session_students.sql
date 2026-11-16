-- Migration 008: Add enrollment_id and class_roll_no to attendance_session_students
ALTER TABLE attendance_session_students 
  ADD COLUMN IF NOT EXISTS enrollment_id INT NULL AFTER student_id,
  ADD COLUMN IF NOT EXISTS class_roll_no INT NULL AFTER enrollment_id;
