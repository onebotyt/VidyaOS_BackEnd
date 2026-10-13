/**
 * MIGRATION: Teaching Group Architecture Redesign
 * 
 * Phase 1 of Teaching Group Architecture Redesign
 * 
 * 1. Creates `teaching_groups` table
 * 2. Creates `teaching_group_members` table
 * 3. Creates `classroom_posts` table
 * 4. Adds `group_id` column to `attendance_registers` and `assessments`
 * 5. Migrates existing `attendance_registers` into `teaching_groups` so existing
 *    registers become official Teaching Groups with members populated from cohort enrollments.
 * 
 * Run: node backend/scripts/migrate-teaching-groups.js
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.resolve(__dirname, '../college_attendance.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('PRAGMA journal_mode = WAL;');

function log(msg) { console.log(`  ${msg}`); }
function header(msg) { console.log(`\n${'═'.repeat(60)}\n  ${msg}\n${'═'.repeat(60)}`); }

function generateInviteCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix ? prefix.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X') : '';
  while (code.length < 6) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

try {
  header('STEP 1: Create Teaching Group Tables');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teaching_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      component TEXT NOT NULL DEFAULT 'THEORY', -- 'THEORY' | 'PRACTICAL'
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      semester INTEGER NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'ARCHIVED'
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );
  `);
  log('✓ teaching_groups table created/verified');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teaching_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'ENROLLED', -- 'PENDING' | 'ENROLLED'
      UNIQUE(group_id, student_id)
    );
  `);
  log('✓ teaching_group_members table created/verified');

  db.exec(`
    CREATE TABLE IF NOT EXISTS classroom_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      attachment_path TEXT,
      attachment_name TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  log('✓ classroom_posts table created/verified');

  header('STEP 2: Add group_id to attendance_registers and assessments');

  // Check columns in attendance_registers
  const regCols = db.prepare(`PRAGMA table_info(attendance_registers)`).all().map(c => c.name);
  if (!regCols.includes('group_id')) {
    db.exec(`ALTER TABLE attendance_registers ADD COLUMN group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE;`);
    log('✓ Added group_id column to attendance_registers');
  } else {
    log('✓ attendance_registers already has group_id');
  }

  // Check columns in assessments
  const assCols = db.prepare(`PRAGMA table_info(assessments)`).all().map(c => c.name);
  if (!assCols.includes('group_id')) {
    db.exec(`ALTER TABLE assessments ADD COLUMN group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE;`);
    log('✓ Added group_id column to assessments');
  } else {
    log('✓ assessments already has group_id');
  }

  // Recreate assignments and exams views with group_id
  db.exec(`
    DROP VIEW IF EXISTS assignments;
    CREATE VIEW assignments AS
      SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
             title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
      FROM assessments
      WHERE type = 'ASSIGNMENT';

    DROP VIEW IF EXISTS exams;
    CREATE VIEW exams AS
      SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
             title AS name, due_date AS exam_date, max_marks, created_at, updated_at
      FROM assessments
      WHERE type = 'EXAM';
  `);
  log('✓ Recreated assignments and exams views with group_id');

  header('STEP 3: Migrate Existing Registers to Teaching Groups');

  const registers = db.prepare(`
    SELECT r.id, r.name, r.subject_id, r.teacher_id, r.department_id, r.year, r.semester,
           r.academic_year_id, r.session_type_scope, r.is_active, r.created_at, r.group_id,
           s.name as subject_name
    FROM attendance_registers r
    LEFT JOIN subjects s ON r.subject_id = s.id
    WHERE r.group_id IS NULL
  `).all();

  log(`Found ${registers.length} registers to link with Teaching Groups`);

  for (const reg of registers) {
    const subjectName = reg.subject_name || reg.name;
    const component = reg.session_type_scope || 'THEORY';
    const ayId = reg.academic_year_id || 1;
    const sem = reg.semester || 1;
    let code = generateInviteCode(subjectName);

    // Ensure code uniqueness
    let exists = db.prepare('SELECT id FROM teaching_groups WHERE invite_code = ?').get(code);
    while (exists) {
      code = generateInviteCode();
      exists = db.prepare('SELECT id FROM teaching_groups WHERE invite_code = ?').get(code);
    }

    const insertGroup = db.prepare(`
      INSERT INTO teaching_groups 
        (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reg.name,
      subjectName,
      component,
      reg.teacher_id,
      ayId,
      sem,
      code,
      reg.is_active ? 'ACTIVE' : 'ARCHIVED',
      reg.created_at || new Date().toISOString()
    );

    const groupId = Number(insertGroup.lastInsertRowid);

    // Link register to group
    db.prepare('UPDATE attendance_registers SET group_id = ? WHERE id = ?').run(groupId, reg.id);

    // Link assessments for this subject/teacher/cohort to group
    if (reg.subject_id) {
      db.prepare(`
        UPDATE assessments 
        SET group_id = ? 
        WHERE subject_id = ? AND teacher_id = ? AND group_id IS NULL
      `).run(groupId, reg.subject_id, reg.teacher_id);
    }

    // Populate students in group from enrollments of that department & semester
    if (reg.department_id && reg.year && reg.semester) {
      const enrolledStudents = db.prepare(`
        SELECT student_id 
        FROM enrollments 
        WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ? AND status = 'ENROLLED'
      `).all(reg.department_id, reg.year, reg.semester, ayId);

      let studentCount = 0;
      for (const s of enrolledStudents) {
        db.prepare(`
          INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, joined_at, status)
          VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')
        `).run(groupId, s.student_id);
        studentCount++;
      }
      log(`  ✓ Register #${reg.id} "${reg.name}" → Teaching Group #${groupId} (${code}) with ${studentCount} students`);
    } else {
      log(`  ✓ Register #${reg.id} "${reg.name}" → Teaching Group #${groupId} (${code})`);
    }

    // Add welcome post to stream
    db.prepare(`
      INSERT INTO classroom_posts (group_id, author_id, content, created_at)
      VALUES (?, (SELECT user_id FROM teachers WHERE id = ?), 'Welcome to the Teaching Group for ' || ?, CURRENT_TIMESTAMP)
    `).run(groupId, reg.teacher_id, subjectName);
  }

  header('STEP 4: Verification');
  const groupCount = db.prepare('SELECT COUNT(*) as c FROM teaching_groups').get().c;
  const memberCount = db.prepare('SELECT COUNT(*) as c FROM teaching_group_members').get().c;
  const postCount = db.prepare('SELECT COUNT(*) as c FROM classroom_posts').get().c;
  log(`✓ Verification: ${groupCount} Teaching Groups, ${memberCount} Memberships, ${postCount} Stream Posts`);

  header('✅ MIGRATION COMPLETE — Teaching Groups Ready');

} catch (err) {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
} finally {
  db.close();
}
