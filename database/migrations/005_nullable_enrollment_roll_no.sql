-- Migration 005: Make enrollments.class_roll_no nullable
-- Reason: Self-registering students don't have a roll number yet.
--         Roll number is assigned by Class Teacher upon approval.
-- SQLite requires a full table recreation to change column constraints.

PRAGMA foreign_keys = OFF;

-- Step 1: Recreate enrollments with nullable class_roll_no
CREATE TABLE IF NOT EXISTS enrollments_v2 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  department_id    INTEGER NOT NULL REFERENCES departments(id),
  branch_id        INTEGER NOT NULL REFERENCES branches(id),
  year             INTEGER NOT NULL,
  semester         INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  class_roll_no    INTEGER NULL,
  status           TEXT NOT NULL DEFAULT 'ENROLLED',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Copy existing data
INSERT INTO enrollments_v2
  SELECT id, student_id, department_id, branch_id, year, semester, academic_year_id, class_roll_no, status, created_at, updated_at
  FROM enrollments;

-- Step 3: Drop old table and rename
DROP TABLE enrollments;
ALTER TABLE enrollments_v2 RENAME TO enrollments;

PRAGMA foreign_keys = ON;
