-- =============================================================================
-- Migration 005: Make enrollments.class_roll_no nullable (MySQL 8.x / InnoDB)
-- Reason: Self-registering students do not have a classroom roll number yet.
--         Roll number is assigned by the Class Teacher upon approval.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE enrollments
  MODIFY COLUMN class_roll_no INT NULL;
