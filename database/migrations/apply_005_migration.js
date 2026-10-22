/**
 * Apply Migration 005: Make enrollments.class_roll_no nullable
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../backend/college_attendance.sqlite');

console.log('Applying Migration 005: enrollments.class_roll_no → nullable...');

const db = new DatabaseSync(dbPath);

// Check if already applied
const colInfo = db.prepare("PRAGMA table_info(enrollments)").all();
const rollCol = colInfo.find(c => c.name === 'class_roll_no');

if (rollCol && rollCol.notnull === 0) {
  console.log('✓ Migration 005 already applied — class_roll_no is already nullable. Skipping.');
  process.exit(0);
}

// Run the recreation in one exec block
db.exec(`
  PRAGMA foreign_keys = OFF;

  CREATE TABLE enrollments_v2 (
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

  INSERT INTO enrollments_v2
    SELECT id, student_id, department_id, branch_id, year, semester, academic_year_id,
           class_roll_no, status, created_at, updated_at
    FROM enrollments;

  DROP TABLE enrollments;

  ALTER TABLE enrollments_v2 RENAME TO enrollments;

  PRAGMA foreign_keys = ON;
`);

// Verify
const newColInfo = db.prepare("PRAGMA table_info(enrollments)").all();
const newRollCol = newColInfo.find(c => c.name === 'class_roll_no');
if (newRollCol && newRollCol.notnull === 0) {
  console.log('✓ Migration 005 applied successfully — class_roll_no is now nullable.');
  const count = db.prepare("SELECT COUNT(*) as c FROM enrollments").get().c;
  console.log(`  ✓ Enrollments preserved: ${count} rows`);
} else {
  console.error('✗ Migration 005 failed verification');
  process.exit(1);
}
