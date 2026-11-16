-- =============================================================================
-- Migration 007: Ensure auto_close_at exists on attendance_sessions (MySQL 8.x)
-- =============================================================================

SET NAMES utf8mb4;

-- Check and add auto_close_at if not present
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_sessions'
    AND COLUMN_NAME = 'auto_close_at'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE attendance_sessions ADD COLUMN auto_close_at DATETIME NULL AFTER state',
  'SELECT "Column auto_close_at already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
