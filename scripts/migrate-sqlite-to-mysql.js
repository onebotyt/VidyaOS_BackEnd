const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { query, withTransaction } = require('../src/config/db');

const sqlitePath = 'E:/uiap/Attendance-System-Simplified/backend/college_attendance.sqlite';
const sqliteDb = new DatabaseSync(sqlitePath);

async function migrate() {
  console.log('--- Starting SQLite to MySQL Migration for VidyaOS ---');
  await query('SET FOREIGN_KEY_CHECKS = 0');

  // List of tables to migrate in order
  const tables = [
    'system_settings',
    'academic_years',
    'departments',
    'users',
    'user_roles',
    'teachers',
    'subjects',
    'teacher_assignments',
    'students',
    'enrollments',
    'attendance_registers',
    'attendance_sessions',
    'attendance_session_students',
    'register_attendance',
    'student_self_attendance',
    'teaching_groups',
    'teaching_group_members',
    'classroom_posts',
    'timetable_slots',
    'assessments',
    'assessment_submissions',
    'devices',
    'leave_applications',
    'notifications',
    'audit_logs'
  ];

  for (const table of tables) {
    try {
      // Check if table exists in SQLite
      const hasTable = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
      if (!hasTable) {
        console.log(`Skipping ${table}: Not in SQLite.`);
        continue;
      }

      // Read rows from SQLite
      const rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) {
        console.log(`Table ${table} has 0 rows in SQLite.`);
        continue;
      }

      // Check columns in MySQL
      const mysqlColsRaw = await query(
        `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
        [table]
      );
      const mysqlCols = new Set(mysqlColsRaw.map(c => c.COLUMN_NAME));

      // Clear existing records in MySQL table
      await query(`TRUNCATE TABLE ${table}`).catch(() => query(`DELETE FROM ${table}`));

      // Prepare insert
      const sample = rows[0];
      const validCols = Object.keys(sample).filter(col => mysqlCols.has(col));

      if (!validCols.length) {
        console.log(`Table ${table}: No overlapping columns between SQLite and MySQL.`);
        continue;
      }

      const colNames = validCols.map(c => `\`${c}\``).join(', ');
      const placeholders = validCols.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${colNames}) VALUES (${placeholders})`;

      let inserted = 0;
      for (const row of rows) {
        if (table === 'attendance_sessions' && !row.start_time) {
          row.start_time = row.session_date ? `${row.session_date} 09:00:00` : (row.created_at || '2026-10-01 09:00:00');
        }
        const values = validCols.map(col => {
          let val = row[col];
          if (val === undefined) return null;
          // Clean timestamps / booleans
          if (typeof val === 'bigint') val = Number(val);
          return val;
        });
        await query(sql, values);
        inserted++;
      }
      console.log(`✓ Migrated ${inserted} rows into ${table}`);
    } catch (err) {
      console.error(`Error migrating ${table}:`, err.message);
    }
  }

  // Ensure enrollments has student_id matched and class_roll_no on students
  try {
    await query(`
      UPDATE students s
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      SET s.class_roll_no = e.class_roll_no
      WHERE s.class_roll_no IS NULL AND e.class_roll_no IS NOT NULL
    `);
  } catch (_) {}

  await query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('--- Migration Finished Successfully! ---');
  process.exit(0);
}

migrate().catch(e => {
  console.error('Migration Fatal Error:', e);
  process.exit(1);
});
