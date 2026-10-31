/**
 * Dual Database Adapter: SQLite (Local Testing) / MySQL (Deployment)
 * Controlled via DB_CLIENT in .env ('sqlite' | 'mysql')
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config();
const logger = require('../utils/logger');
const { getResolvedDatabasePath } = require('./dbPath');

const DB_CLIENT = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

let pool = null;
let sqliteDb = null;

// =============================================================================
// SQLite Helper & Compatibility Layer
// =============================================================================

function getSqliteDb() {
  if (!sqliteDb) {
    const { DatabaseSync } = require('node:sqlite');
    const dbFilePath = getResolvedDatabasePath();

    const dbDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    sqliteDb = new DatabaseSync(dbFilePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');
    sqliteDb.exec('PRAGMA cache_size = -64000;');
    sqliteDb.exec('PRAGMA temp_store = MEMORY;');
    sqliteDb.exec('PRAGMA busy_timeout = 5000;');

    // Register MySQL-compatible SQL functions in SQLite
    sqliteDb.function('NOW', () => new Date().toISOString().replace('T', ' ').slice(0, 19));
    sqliteDb.function('CURDATE', () => new Date().toISOString().slice(0, 10));
    sqliteDb.function('DATE', (d) => (d ? String(d).slice(0, 10) : null));
    sqliteDb.function('CONCAT', { varargs: true }, (...args) => args.filter(a => a !== null && a !== undefined).join(''));
    sqliteDb.function('DATEDIFF', (d1, d2) => {
      if (!d1 || !d2) return 0;
      const ms1 = new Date(d1).getTime();
      const ms2 = new Date(d2).getTime();
      return Math.floor((ms1 - ms2) / (1000 * 60 * 60 * 24));
    });
    sqliteDb.function('GREATEST', { varargs: true }, (...args) => Math.max(...args.map(Number)));
    sqliteDb.function('LEAST', { varargs: true }, (...args) => Math.min(...args.map(Number)));
    sqliteDb.function('YEAR', (d) => (d ? new Date(d).getFullYear() : null));
    sqliteDb.function('MONTH', (d) => (d ? new Date(d).getMonth() + 1 : null));
    sqliteDb.function('DAY', (d) => (d ? new Date(d).getDate() : null));
    sqliteDb.function('TIMESTAMPDIFF', (unit, d1, d2) => {
      if (!d1 || !d2) return null;
      const diffMs = new Date(d2) - new Date(d1);
      return Math.floor(diffMs / 60000);
    });

    // Auto-initialize schema and seeds if not already initialized
    try {
      const userTableCheck = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!userTableCheck) {
        logger.info('Initializing SQLite schema...');
        const schemaPath = [
          path.join(__dirname, '../../database/sqlite/schema.sql'),
          path.join(__dirname, '../../../database/sqlite/schema.sql'),
          path.join(__dirname, '../database/sqlite/schema.sql')
        ].find(p => fs.existsSync(p));

        if (schemaPath && fs.existsSync(schemaPath)) {
          sqliteDb.exec(fs.readFileSync(schemaPath, 'utf-8'));
          logger.info('SQLite schema loaded successfully.');
        }
      }

      // ── Environment-Aware Seed Strategy ─────────────────────────────────────
      // Render / Production: Clean institutional setup with ONLY 1 Admin account (Zero demo data)
      // Local development: Full institutional demo dataset (14 users) for local tests
      const isRenderOrProd = (
        process.env.RENDER === 'true' || 
        process.env.IS_RENDER === 'true' || 
        process.env.CLEAN_ADMIN_ONLY === 'true' ||
        (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true')
      ) && process.env.LOCAL_DEV !== 'true';

      const PROD_SEED_VERSION = 'v29-prod-clean-only-admin';
      const DEMO_SEED_VERSION = 'v27-clean-2026';
      const TARGET_SEED_VERSION = isRenderOrProd ? PROD_SEED_VERSION : DEMO_SEED_VERSION;
      const FORCE_RESEED = process.env.FORCE_RESEED === 'true';

      // Ensure system_settings table exists (needed to persist stamp)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (
          setting_key   TEXT PRIMARY KEY,
          setting_value TEXT,
          updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      let storedSeedVersion = null;
      try {
        const row = sqliteDb.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'seed_version'").get();
        storedSeedVersion = row ? row.setting_value : null;
      } catch (_) {}

      // ── Database Data Protection Check ──────────────────────────────────────
      // If the database already has registered users, NEVER run a destructive wipe!
      // Only run initial seeds if the database is 100% empty (0 users) or FORCE_RESEED=true.
      let existingUsersCount = 0;
      try {
        const countRow = sqliteDb.prepare("SELECT count(*) as c FROM users").get();
        existingUsersCount = countRow ? Number(countRow.c) : 0;
      } catch (_) {}

      if (FORCE_RESEED || (existingUsersCount === 0 && storedSeedVersion !== TARGET_SEED_VERSION)) {
        const reason = FORCE_RESEED ? 'FORCE_RESEED=true env var' : `initial setup (users=0, stored="${storedSeedVersion}", target="${TARGET_SEED_VERSION}")`;
        
        if (isRenderOrProd) {
          logger.info(`Running CLEAN production seed (1 Admin login only, zero demo data) — reason: ${reason}`);
          try {
            const { seedProductionClean } = require(path.resolve(__dirname, '../../scripts/seed-production-clean.js'));
            seedProductionClean(sqliteDb, { force: FORCE_RESEED });
            sqliteDb.prepare("INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('seed_version', ?, datetime('now'))").run(TARGET_SEED_VERSION);
            logger.info(`Clean production seed complete. Stamped seed_version="${TARGET_SEED_VERSION}".`);
          } catch (seedErr) {
            logger.error('Failed to run seed-production-clean.js', { error: seedErr.message });
          }
        } else {
          logger.info(`Running local institutional demo dataset seed — reason: ${reason}`);
          try {
            const { seed } = require(path.resolve(__dirname, '../../scripts/seed-demo.js'));
            seed(sqliteDb, { force: FORCE_RESEED });
            sqliteDb.prepare("INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('seed_version', ?, datetime('now'))").run(TARGET_SEED_VERSION);
            logger.info(`Institutional demo seed complete. Stamped seed_version="${TARGET_SEED_VERSION}".`);
          } catch (seedErr) {
            logger.error('Failed to run seed-demo.js', { error: seedErr.message });
          }
        }
      } else {
        if (existingUsersCount > 0 && storedSeedVersion !== TARGET_SEED_VERSION) {
          logger.info(`[DATA INTEGRITY GUARD] Active database detected with ${existingUsersCount} user(s). Preserving all institutional records, faculty, students, and attendance. Skipping destructive seed and updating version stamp to "${TARGET_SEED_VERSION}".`);
          sqliteDb.prepare("INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('seed_version', ?, datetime('now'))").run(TARGET_SEED_VERSION);
        } else {
          logger.info(`Seed version "${TARGET_SEED_VERSION}" (${isRenderOrProd ? 'Production/Render' : 'Local'}) matches. Database preserved.`);
        }
      }

      // Ensure Milestone 45 Audit Logs and In-App Notifications tables exist
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT,
          event_type TEXT,
          user_id INTEGER REFERENCES users(id),
          actor_id INTEGER REFERENCES users(id),
          actor_role TEXT,
          entity_type TEXT,
          target_type TEXT,
          entity_id TEXT,
          target_id TEXT,
          details_json TEXT,
          ip_address TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'GENERAL',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          link_url TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Safe column migration for pre-existing SQLite tables
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN event_type TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN actor_id INTEGER;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN actor_role TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN target_type TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN target_id TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN action TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN entity_type TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE audit_logs ADD COLUMN entity_id TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE notifications ADD COLUMN type TEXT DEFAULT \'GENERAL\';'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE user_sessions ADD COLUMN device_id TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE user_sessions ADD COLUMN last_active_at DATETIME;'); } catch (_) {}
      try { sqliteDb.exec("UPDATE user_sessions SET last_active_at = COALESCE(updated_at, created_at, datetime('now')) WHERE last_active_at IS NULL;"); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE assessments ADD COLUMN instructions TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE assessments ADD COLUMN questions TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE assessments ADD COLUMN unit_name TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE teaching_groups ADD COLUMN subject_code TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE teaching_groups ADD COLUMN total_units INTEGER DEFAULT 5;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE teaching_groups ADD COLUMN syllabus_units TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE attendance_sessions ADD COLUMN period_number INTEGER DEFAULT 1;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN address TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN aadhar_number TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN father_name TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN mother_name TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN dob TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN gender TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN category TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE students ADD COLUMN profile_completed INTEGER DEFAULT 0;'); } catch (_) {}

      // Synchronize action <-> event_type, user_id <-> actor_id, entity_type <-> target_type
      sqliteDb.exec(`
        UPDATE audit_logs SET event_type = action WHERE event_type IS NULL AND action IS NOT NULL;
        UPDATE audit_logs SET action = event_type WHERE action IS NULL AND event_type IS NOT NULL;
        UPDATE audit_logs SET actor_id = user_id WHERE actor_id IS NULL AND user_id IS NOT NULL;
        UPDATE audit_logs SET user_id = actor_id WHERE user_id IS NULL AND actor_id IS NOT NULL AND actor_id IN (SELECT id FROM users);
        UPDATE audit_logs SET target_type = entity_type WHERE target_type IS NULL AND entity_type IS NOT NULL;
        UPDATE audit_logs SET entity_type = target_type WHERE entity_type IS NULL AND target_type IS NOT NULL;
        UPDATE audit_logs SET target_id = entity_id WHERE target_id IS NULL AND entity_id IS NOT NULL;
        UPDATE audit_logs SET entity_id = target_id WHERE entity_id IS NULL AND target_id IS NOT NULL;
      `);

      sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_logs(event_type);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

        CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
      `);

      // Ensure Faculty Registration and Common Faculty Manager tables exist
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS faculty_registration_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          phone TEXT,
          employee_id TEXT,
          account_type TEXT NOT NULL CHECK(account_type IN ('FACULTY', 'HOD')),
          department_id INTEGER REFERENCES departments(id),
          approval_type TEXT NOT NULL CHECK(approval_type IN ('DEPT_HOD', 'COMMON_FACULTY_MANAGER', 'ADMIN')),
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
          rejection_reason TEXT,
          reviewed_by INTEGER REFERENCES users(id),
          reviewed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS common_faculty_manager_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          assigned_by INTEGER NOT NULL REFERENCES users(id),
          is_active INTEGER NOT NULL DEFAULT 1,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deactivated_at DATETIME
        );

        CREATE INDEX IF NOT EXISTS idx_frr_status ON faculty_registration_requests(status);
        CREATE INDEX IF NOT EXISTS idx_frr_dept_status ON faculty_registration_requests(department_id, status);
        CREATE INDEX IF NOT EXISTS idx_frr_approval_type ON faculty_registration_requests(approval_type, status);

        -- Teaching Groups Core Tables
        CREATE TABLE IF NOT EXISTS teaching_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          subject_name TEXT NOT NULL,
          component TEXT NOT NULL DEFAULT 'THEORY',
          total_units INTEGER DEFAULT 5,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
          semester INTEGER NOT NULL,
          invite_code TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          archived_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS teaching_group_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'ENROLLED',
          UNIQUE(group_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS classroom_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          attachment_path TEXT,
          attachment_name TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS classroom_post_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES classroom_posts(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_tg_teacher_status ON teaching_groups(teacher_id, status);
        CREATE INDEX IF NOT EXISTS idx_tg_invite_code ON teaching_groups(invite_code);
        CREATE INDEX IF NOT EXISTS idx_tgm_group_student ON teaching_group_members(group_id, student_id);
        CREATE INDEX IF NOT EXISTS idx_cp_group_created ON classroom_posts(group_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_cpc_post ON classroom_post_comments(post_id);

        -- Course File Preparation Tables (Milestone 163)
        CREATE TABLE IF NOT EXISTS course_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teaching_group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          department_id INTEGER NOT NULL REFERENCES departments(id),
          academic_year_id INTEGER REFERENCES academic_years(id),
          semester INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT,
          audited_at DATETIME,
          audited_by INTEGER REFERENCES users(id),
          evaluation_scheme TEXT,
          copo_matrix_json TEXT,
          cos_json TEXT,
          advanced_learners_json TEXT,
          slow_learners_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teaching_group_id)
        );

        CREATE TABLE IF NOT EXISTS course_file_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_file_id INTEGER NOT NULL REFERENCES course_files(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          status TEXT NOT NULL DEFAULT 'UPLOADED',
          version INTEGER NOT NULL DEFAULT 1,
          uploaded_by INTEGER NOT NULL REFERENCES users(id),
          verified_by INTEGER REFERENCES users(id),
          verified_at DATETIME,
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(course_file_id, item_key)
        );

        CREATE INDEX IF NOT EXISTS idx_course_files_teacher ON course_files(teacher_id);
        CREATE INDEX IF NOT EXISTS idx_course_files_dept ON course_files(department_id);
        CREATE INDEX IF NOT EXISTS idx_course_file_docs ON course_file_documents(course_file_id, item_key);

        -- Theory Class Preparation Tables (Milestone 316)
        CREATE TABLE IF NOT EXISTS theory_class_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teaching_group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          department_id INTEGER NOT NULL REFERENCES departments(id),
          academic_year_id INTEGER REFERENCES academic_years(id),
          semester INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT,
          audited_at DATETIME,
          audited_by INTEGER REFERENCES users(id),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teaching_group_id)
        );

        CREATE TABLE IF NOT EXISTS theory_class_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          theory_class_id INTEGER NOT NULL REFERENCES theory_class_files(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          status TEXT NOT NULL DEFAULT 'UPLOADED',
          version INTEGER NOT NULL DEFAULT 1,
          uploaded_by INTEGER NOT NULL REFERENCES users(id),
          verified_by INTEGER REFERENCES users(id),
          verified_at DATETIME,
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(theory_class_id, item_key)
        );

        CREATE INDEX IF NOT EXISTS idx_theory_class_teacher ON theory_class_files(teacher_id);
        CREATE INDEX IF NOT EXISTS idx_theory_class_dept ON theory_class_files(department_id);
        CREATE INDEX IF NOT EXISTS idx_theory_class_docs ON theory_class_documents(theory_class_id, item_key);

        -- Laboratory Class Preparation Tables (Milestone 317)
        CREATE TABLE IF NOT EXISTS lab_class_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teaching_group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          teacher_id INTEGER NOT NULL REFERENCES teachers(id),
          department_id INTEGER NOT NULL REFERENCES departments(id),
          academic_year_id INTEGER REFERENCES academic_years(id),
          semester INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT,
          audited_at DATETIME,
          audited_by INTEGER REFERENCES users(id),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teaching_group_id)
        );

        CREATE TABLE IF NOT EXISTS lab_class_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lab_class_id INTEGER NOT NULL REFERENCES lab_class_files(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          status TEXT NOT NULL DEFAULT 'UPLOADED',
          version INTEGER NOT NULL DEFAULT 1,
          uploaded_by INTEGER NOT NULL REFERENCES users(id),
          verified_by INTEGER REFERENCES users(id),
          verified_at DATETIME,
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(lab_class_id, item_key)
        );

        CREATE INDEX IF NOT EXISTS idx_lab_class_teacher ON lab_class_files(teacher_id);
        CREATE INDEX IF NOT EXISTS idx_lab_class_dept ON lab_class_files(department_id);
        CREATE INDEX IF NOT EXISTS idx_lab_class_docs ON lab_class_documents(lab_class_id, item_key);

        -- Dedicated Faculty Drive & Media Asset Hub (Approach B)
        CREATE TABLE IF NOT EXISTS faculty_media_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          faculty_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
          department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
          student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'LECTURE_NOTES',
          tags TEXT,
          is_public_to_students INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_media_faculty ON faculty_media_assets(faculty_id);
        CREATE INDEX IF NOT EXISTS idx_media_dept ON faculty_media_assets(department_id);
        CREATE INDEX IF NOT EXISTS idx_media_subject ON faculty_media_assets(subject_id);
        CREATE INDEX IF NOT EXISTS idx_media_student ON faculty_media_assets(student_id);
        CREATE INDEX IF NOT EXISTS idx_media_category ON faculty_media_assets(category);
        CREATE INDEX IF NOT EXISTS idx_media_type ON faculty_media_assets(file_type);
      `);

      try { sqliteDb.exec('ALTER TABLE attendance_registers ADD COLUMN group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE assessments ADD COLUMN group_id INTEGER REFERENCES teaching_groups(id) ON DELETE CASCADE;'); } catch (_) {}

      // Ensure at least one System Admin account exists (non-destructive)
      try {
        const adminExists = sqliteDb.prepare("SELECT u.id FROM users u JOIN user_roles ur ON u.id = ur.user_id WHERE ur.role = 'SYSTEM_ADMIN' LIMIT 1").get();
        if (!adminExists) {
          sqliteDb.prepare(`
            INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
            VALUES (1, 'admin@gmail.com', 'admin@gmail.com', '$2b$12$F3fQ1FKnymvFYcx0TBmJrefTNI5O5H07rSeF0IqofBlRt7J5dv9GW', 0, 'ACTIVE')
          `).run();
          sqliteDb.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (1, 'SYSTEM_ADMIN')`).run();
          sqliteDb.prepare(`
            INSERT OR IGNORE INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
            VALUES (1, 1, 4, 'System Administrator', 'ADMIN-01', '0000000000')
          `).run();
        }
      } catch (_) {}
    } catch (initErr) {
      logger.error('Failed to auto-initialize SQLite schema/seed', { error: initErr.message });
    }
  }
  return sqliteDb;
}

/**
 * Translates MySQL-specific SQL idioms (e.g. ON DUPLICATE KEY UPDATE) to SQLite syntax
 */
function translateSqlForSqlite(sql) {
  let trans = sql;

  // Handle ON DUPLICATE KEY UPDATE
  if (trans.includes('ON DUPLICATE KEY UPDATE')) {
    let conflictTarget = '';
    if (/INTO\s+fingerprint_slots/i.test(trans)) {
      conflictTarget = '(device_id, slot_id)';
    } else if (/INTO\s+(register_attendance|student_self_attendance)/i.test(trans)) {
      conflictTarget = '(session_id, student_id)';
    } else if (/INTO\s+users/i.test(trans)) {
      conflictTarget = '(username)';
    } else if (/INTO\s+user_roles/i.test(trans)) {
      conflictTarget = '(user_id, role)';
    } else if (/INTO\s+departments/i.test(trans)) {
      conflictTarget = '(code)';
    } else if (/INTO\s+branches/i.test(trans)) {
      conflictTarget = '(id)';
    } else if (/INTO\s+academic_years/i.test(trans)) {
      conflictTarget = '(id)';
    } else if (/INTO\s+subjects/i.test(trans)) {
      conflictTarget = '(id)';
    } else if (/INTO\s+system_settings/i.test(trans)) {
      conflictTarget = '(setting_key)';
    } else if (/INTO\s+(assignment_submissions|assessment_submissions)/i.test(trans)) {
      conflictTarget = trans.includes('assessment_id') ? '(assessment_id, student_id)' : '(assignment_id, student_id)';
    } else if (/INTO\s+exam_scores/i.test(trans)) {
      conflictTarget = '(exam_id, student_id)';
    }

    trans = trans.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i, `ON CONFLICT${conflictTarget} DO UPDATE SET`);
    trans = trans.replace(/VALUES\s*\(\s*([a-zA-Z0-9_]+)\s*\)/gi, 'excluded.$1');
  }

  // Handle DATE_SUB and DATE_ADD (allowing nested expressions with commas like COALESCE)
  trans = trans.replace(/DATE_SUB\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\d+)\s+(MINUTE|DAY|HOUR|SECOND)S?\s*\)/gi, (m, expr, num, unit) => {
    return `datetime(${expr}, '-${num} ${unit.toLowerCase()}s')`;
  });
  trans = trans.replace(/DATE_ADD\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\d+)\s+(MINUTE|DAY|HOUR|SECOND)S?\s*\)/gi, (m, expr, num, unit) => {
    return `datetime(${expr}, '+${num} ${unit.toLowerCase()}s')`;
  });

  // Handle MySQL CURDATE() -> SQLite CURRENT_DATE
  trans = trans.replace(/CURDATE\s*\(\s*\)/gi, "CURRENT_DATE");

  // Handle MySQL GREATEST / LEAST -> SQLite scalar MAX / MIN
  trans = trans.replace(/\bGREATEST\s*\(/gi, 'MAX(');
  trans = trans.replace(/\bLEAST\s*\(/gi, 'MIN(');

  // Handle MySQL INSERT IGNORE INTO -> SQLite INSERT OR IGNORE INTO
  trans = trans.replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO');

  return trans;
}

/**
 * Normalizes parameterized query values for SQLite driver
 */
function normalizeParams(params = []) {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString().replace('T', ' ').slice(0, 19);
    if (p === undefined) return null;
    return p;
  });
}

// =============================================================================
// MySQL SQL Dialect Translator & Parameter Normalizer
// =============================================================================

function normalizeParamsForMysql(params = []) {
  if (!Array.isArray(params)) return [];
  return params.map((p) => {
    if (p === undefined) return null;
    return p;
  });
}

function translateSqlForMysql(sql) {
  let trans = sql;

  // 1. PRAGMA table_info('table_name') -> information_schema query returning { name, type }
  trans = trans.replace(
    /PRAGMA\s+table_info\s*\(\s*['"]?([a-zA-Z0-9_]+)['"]?\s*\)/gi,
    "SELECT COLUMN_NAME as name, DATA_TYPE as type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '$1'"
  );

  // 2. AUTOINCREMENT -> AUTO_INCREMENT
  trans = trans.replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT');

  // 3. TEXT column with DEFAULT -> VARCHAR(255) DEFAULT (MySQL restriction on BLOB/TEXT default)
  trans = trans.replace(/\bTEXT\s+DEFAULT\s+('?[^,\n)]+'?)/gi, 'VARCHAR(255) DEFAULT $1');

  // 4. date('now', '-X days') and date('now', '+X days')
  trans = trans.replace(/date\s*\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s*days?['"]\s*\)/gi, 'DATE_SUB(CURDATE(), INTERVAL $1 DAY)');
  trans = trans.replace(/date\s*\(\s*['"]now['"]\s*,\s*['"]\+(\d+)\s*days?['"]\s*\)/gi, 'DATE_ADD(CURDATE(), INTERVAL $1 DAY)');
  trans = trans.replace(/date\s*\(\s*['"]now['"]\s*\)/gi, 'CURDATE()');
  trans = trans.replace(/DATE\s*\(\s*['"]now['"]\s*\)/gi, 'CURDATE()');

  // 5. datetime('now', '-X days/minutes')
  trans = trans.replace(/datetime\s*\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s*days?['"]\s*\)/gi, 'DATE_SUB(NOW(), INTERVAL $1 DAY)');
  trans = trans.replace(/datetime\s*\(\s*['"]now['"]\s*,\s*['"]\+(\d+)\s*days?['"]\s*\)/gi, 'DATE_ADD(NOW(), INTERVAL $1 DAY)');
  trans = trans.replace(/datetime\s*\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s*minutes?['"]\s*\)/gi, 'DATE_SUB(NOW(), INTERVAL $1 MINUTE)');
  trans = trans.replace(/datetime\s*\(\s*['"]now['"]\s*,\s*['"]\+(\d+)\s*minutes?['"]\s*\)/gi, 'DATE_ADD(NOW(), INTERVAL $1 MINUTE)');

  // 6. datetime(col, '+X hours/days')
  trans = trans.replace(/datetime\s*\(\s*([^,]+?)\s*,\s*['"]\+(\d+)\s*hours?['"]\s*\)/gi, 'DATE_ADD($1, INTERVAL $2 HOUR)');
  trans = trans.replace(/datetime\s*\(\s*([^,]+?)\s*,\s*['"]-(\d+)\s*hours?['"]\s*\)/gi, 'DATE_SUB($1, INTERVAL $2 HOUR)');
  trans = trans.replace(/datetime\s*\(\s*([^,]+?)\s*,\s*['"]\+(\d+)\s*days?['"]\s*\)/gi, 'DATE_ADD($1, INTERVAL $2 DAY)');
  trans = trans.replace(/datetime\s*\(\s*([^,]+?)\s*,\s*['"]-(\d+)\s*days?['"]\s*\)/gi, 'DATE_SUB($1, INTERVAL $2 DAY)');

  // 7. datetime('now') -> NOW()
  trans = trans.replace(/datetime\s*\(\s*['"]now['"]\s*\)/gi, 'NOW()');

  // 8. julianday expressions -> DATEDIFF in MySQL
  trans = trans.replace(/julianday\s*\(\s*['"]now['"]\s*\)\s*-\s*julianday\s*\(\s*COALESCE\s*\(\s*([^,]+?)\s*,\s*['"]now['"]\s*\)\s*\)/gi, 'DATEDIFF(NOW(), COALESCE($1, NOW()))');
  trans = trans.replace(/julianday\s*\(\s*['"]now['"]\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi, 'DATEDIFF(NOW(), $1)');
  trans = trans.replace(/julianday\s*\(\s*([^)]+)\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi, 'DATEDIFF($1, $2)');

  // 9. Scalar MAX(0, 7 - ...) -> GREATEST(0, 7 - ...)
  trans = trans.replace(/MAX\s*\(\s*0\s*,\s*7\s*-\s*CAST\s*\(\s*\(?(?:julianday|DATEDIFF)[^)]+\)?\s*AS\s+INTEGER\s*\)\s*\)/gi, 'GREATEST(0, 7 - DATEDIFF(NOW(), COALESCE(tg.deleted_at, NOW())))');
  trans = trans.replace(/MAX\s*\(\s*0\s*,\s*7\s*-\s*CAST\s*\([^)]+AS\s+INTEGER\s*\)\s*\)/gi, 'GREATEST(0, 7 - DATEDIFF(NOW(), COALESCE(tg.deleted_at, NOW())))');
  trans = trans.replace(/MAX\s*\(\s*0\s*,\s*([^)]+)\s*\)/gi, 'GREATEST(0, $1)');

  // 10. strftime expressions -> YEAR/MONTH/DAY in MySQL
  trans = trans.replace(/CAST\s*\(\s*strftime\s*\(\s*['"]%Y['"]\s*,\s*([^)]+)\s*\)\s*AS\s+INTEGER\s*\)/gi, 'YEAR($1)');
  trans = trans.replace(/strftime\s*\(\s*['"]%Y['"]\s*,\s*([^)]+)\s*\)/gi, 'YEAR($1)');
  trans = trans.replace(/strftime\s*\(\s*['"]%m['"]\s*,\s*([^)]+)\s*\)/gi, 'MONTH($1)');
  trans = trans.replace(/strftime\s*\(\s*['"]%d['"]\s*,\s*([^)]+)\s*\)/gi, 'DAY($1)');

  // 11. SQLite Pipe Concat || for upcoming_work -> CONCAT(...)
  trans = trans.replace(
    /a\.title\s*\|\|\s*':::'\s*\|\|\s*COALESCE\(a\.due_date,\s*''\)\s*\|\|\s*':::'\s*\|\|\s*a\.type/gi,
    "CONCAT(a.title, ':::', COALESCE(a.due_date, ''), ':::', a.type)"
  );

  // 12. ON CONFLICT(...) DO UPDATE SET col = excluded.col -> ON DUPLICATE KEY UPDATE col = VALUES(col)
  trans = trans.replace(/ON\s+CONFLICT\s*(\([^)]*\))?\s*DO\s+UPDATE\s+SET/gi, 'ON DUPLICATE KEY UPDATE');
  trans = trans.replace(/excluded\.([a-zA-Z0-9_]+)/gi, 'VALUES($1)');

  // 13. INSERT OR IGNORE INTO -> INSERT IGNORE INTO (MySQL syntax)
  trans = trans.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO');

  // 14. CAST(... AS INTEGER) -> CAST(... AS SIGNED) (MySQL requires SIGNED)
  trans = trans.replace(/\bAS\s+INTEGER\b/gi, 'AS SIGNED');

  // 15. CAST(... AS REAL) -> CAST(... AS DECIMAL(10,2)) (MySQL portability)
  trans = trans.replace(/\bAS\s+REAL\b/gi, 'AS DECIMAL(10,2)');

  // 16. ORDER BY COALESCE(s.class_roll_no, ...) with DISTINCT -> ORDER BY class_roll_no
  trans = trans.replace(/ORDER\s+BY\s+COALESCE\s*\(\s*(?:s|st|e)\.class_roll_no[^)]+\)/gi, 'ORDER BY class_roll_no');

  return trans;
}

// =============================================================================
// MySQL Helper Layer
// =============================================================================

function getPool() {
  if (!pool && DB_CLIENT === 'mysql') {
    const mysql = require('mysql2/promise');

    // Configure SSL for Cloud MySQL providers (Aiven, TiDB, AWS RDS, PlanetScale)
    let sslConfig = undefined;
    const isSslRequired = process.env.DB_SSL === 'true' || 
                          process.env.MYSQL_SSL === 'true' || 
                          Boolean(process.env.DB_CA_CERT) || 
                          fs.existsSync(path.resolve(__dirname, '../../ca.pem'));

    if (isSslRequired) {
      let caCert = undefined;
      if (process.env.DB_CA_CERT) {
        caCert = process.env.DB_CA_CERT;
      } else {
        const caPath = [
          path.resolve(__dirname, '../../ca.pem'),
          path.resolve(__dirname, '../ca.pem'),
          path.resolve(process.cwd(), 'ca.pem')
        ].find(p => fs.existsSync(p));
        if (caPath) {
          try {
            caCert = fs.readFileSync(caPath, 'utf8');
          } catch (_) {}
        }
      }

      if (caCert) {
        sslConfig = {
          ca: caCert,
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
        };
      } else {
        sslConfig = {
          rejectUnauthorized: false
        };
      }
    }

    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'college_attendance',
      ssl: sslConfig,
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
      queueLimit: 0,
      timezone: '+00:00',
      dateStrings: true
    });

    // Ensure session sql_mode removes ONLY_FULL_GROUP_BY for seamless MySQL compatibility
    try {
      pool.on('connection', (conn) => {
        try {
          conn.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))", () => {});
        } catch (_) {}
      });
    } catch (_) {}
  }
  return pool;
}

// =============================================================================
// Unified Database Interface
// =============================================================================

/**
 * Execute parameterized SQL query
 */
async function query(sql, params = []) {
  if (DB_CLIENT === 'mysql') {
    const p = getPool();
    const transSql = translateSqlForMysql(sql);
    const normParams = normalizeParamsForMysql(params);

    // Handle CREATE INDEX IF NOT EXISTS in MySQL idempotently
    const idxMatch = transSql.match(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/i);
    if (idxMatch) {
      const [, idxName, tblName, cols] = idxMatch;
      try {
        const [chk] = await p.execute(
          'SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
          [tblName, idxName]
        );
        if (!chk || chk.length === 0) {
          const [res] = await p.execute(`CREATE INDEX ${idxName} ON ${tblName}(${cols})`);
          return res;
        }
        return [{ affectedRows: 0 }];
      } catch (err) {
        if (/Duplicate key name/i.test(err.message)) return [{ affectedRows: 0 }];
        throw err;
      }
    }

    const [rows] = await p.execute(transSql, normParams);
    return rows;
  }

  // SQLite Execution
  const db = getSqliteDb();
  const transSql = translateSqlForSqlite(sql);
  const normParams = normalizeParams(params);

  try {
    const isSelect = /^\s*(SELECT|PRAGMA)/i.test(transSql);
    const stmt = db.prepare(transSql);

    if (isSelect) {
      return stmt.all(...normParams);
    } else {
      const info = stmt.run(...normParams);
      const insertId = Number(info.lastInsertRowid || 0);
      const affectedRows = Number(info.changes || 0);

      const resultObj = {
        insertId,
        affectedRows,
        changes: affectedRows,
        lastInsertRowid: insertId
      };

      try {
        db.exec('PRAGMA wal_checkpoint(PASSIVE);');
      } catch (_) {}

      const resultArr = [resultObj];
      resultArr.insertId = insertId;
      resultArr.affectedRows = affectedRows;
      return resultArr;
    }
  } catch (err) {
    console.error('[SQL ERROR]', err.message, '\nSQL:', transSql, '\nPARAMS:', normParams);
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      err.code = 'ER_DUP_ENTRY';
    }
    throw err;
  }
}

/**
 * Get dedicated connection from pool (or mock connection for SQLite)
 */
async function getConnection() {
  if (DB_CLIENT === 'mysql') {
    const rawConn = await getPool().getConnection();
    return {
      _raw: rawConn,
      execute: async (sql, params = []) => {
        const transSql = translateSqlForMysql(sql);
        const normParams = normalizeParamsForMysql(params);
        return await rawConn.execute(transSql, normParams);
      },
      query: async (sql, params = []) => {
        const transSql = translateSqlForMysql(sql);
        const normParams = normalizeParamsForMysql(params);
        const [rows] = await rawConn.execute(transSql, normParams);
        return rows;
      },
      beginTransaction: async () => await rawConn.beginTransaction(),
      commit: async () => await rawConn.commit(),
      rollback: async () => await rawConn.rollback(),
      release: () => rawConn.release()
    };
  }

  const db = getSqliteDb();
  return {
    execute: async (sql, params = []) => {
      const transSql = translateSqlForSqlite(sql);
      const normParams = normalizeParams(params);
      try {
        const isSelect = /^\s*(SELECT|PRAGMA)/i.test(transSql);
        const stmt = db.prepare(transSql);
        if (isSelect) {
          const rows = stmt.all(...normParams);
          return [rows, []];
        } else {
          const info = stmt.run(...normParams);
          const insertId = Number(info.lastInsertRowid || 0);
          const affectedRows = Number(info.changes || 0);
          const resultObj = { insertId, affectedRows, changes: affectedRows };
          return [resultObj, []];
        }
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          err.code = 'ER_DUP_ENTRY';
        }
        throw err;
      }
    },
    query: async (sql, params = []) => {
      return await query(sql, params);
    },
    release: () => {}
  };
}

/**
 * Executes a sequence of queries within an atomic transaction
 */
async function withTransaction(callback) {
  if (DB_CLIENT === 'mysql') {
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // SQLite Transaction
  const db = getSqliteDb();
  db.exec('BEGIN TRANSACTION');

  const connection = {
    execute: async (sql, params = []) => {
      const transSql = translateSqlForSqlite(sql);
      const normParams = normalizeParams(params);
      try {
        const isSelect = /^\s*(SELECT|PRAGMA)/i.test(transSql);
        const stmt = db.prepare(transSql);
        if (isSelect) {
          const rows = stmt.all(...normParams);
          return [rows, []];
        } else {
          const info = stmt.run(...normParams);
          const insertId = Number(info.lastInsertRowid || 0);
          const affectedRows = Number(info.changes || 0);
          const resultObj = { insertId, affectedRows, changes: affectedRows };
          return [resultObj, []];
        }
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          err.code = 'ER_DUP_ENTRY';
        }
        throw err;
      }
    },
    query: async (sql, params = []) => {
      return await query(sql, params);
    }
  };

  try {
    const result = await callback(connection);
    db.exec('COMMIT');
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE);'); } catch (_) {}
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw error;
  }
}

/**
 * Automatically creates compatibility views for legacy schemas (exams, exam_scores, assignments, etc.)
 * Ensures that both MySQL (Render/Aiven) and SQLite (Local dev) have matching schema views.
 */
async function ensureCompatibilityViews() {
  if (DB_CLIENT === 'mysql') {
    const p = getPool();
    if (!p) return;
    try {
      try {
        await p.execute("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))");
      } catch (_) {}
      await p.execute(`
        CREATE OR REPLACE VIEW exams AS
        SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
               title AS name, due_date AS exam_date, max_marks, unit_name, instructions, questions, created_at, updated_at
        FROM assessments
        WHERE type = 'EXAM'
      `);
      await p.execute(`
        CREATE OR REPLACE VIEW exam_scores AS
        SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
               graded_by AS entered_by, created_at, updated_at
        FROM assessment_submissions
      `);
      await p.execute(`
        CREATE OR REPLACE VIEW assignments AS
        SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
               title, description, attachment_path, attachment_name, due_date, max_marks, unit_name, instructions, questions, created_at, updated_at
        FROM assessments
        WHERE type = 'ASSIGNMENT'
      `);
      await p.execute(`
        CREATE OR REPLACE VIEW assignment_submissions AS
        SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
               submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
        FROM assessment_submissions
      `);
      await p.execute(`
        CREATE OR REPLACE VIEW attendance_session_pins AS
        SELECT id AS session_id, verification_pin AS pin_code, verification_expires_at AS expires_at, created_at
        FROM attendance_sessions
        WHERE verification_pin IS NOT NULL
      `);
      await p.execute(`
        CREATE OR REPLACE VIEW attendance_session_qr AS
        SELECT id AS session_id, verification_qr_hash AS token_hash, verification_expires_at AS expires_at, created_at
        FROM attendance_sessions
        WHERE verification_qr_hash IS NOT NULL
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS theory_class_files (
          id INT AUTO_INCREMENT PRIMARY KEY,
          teaching_group_id INT NOT NULL,
          subject_id INT NULL,
          teacher_id INT NOT NULL,
          department_id INT NOT NULL,
          academic_year_id INT NULL,
          semester INT NOT NULL DEFAULT 1,
          status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT NULL,
          audited_at DATETIME NULL,
          audited_by INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_tc_tg (teaching_group_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS theory_class_documents (
          id INT AUTO_INCREMENT PRIMARY KEY,
          theory_class_id INT NOT NULL,
          item_key VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_size INT NULL DEFAULT 0,
          mime_type VARCHAR(100) NULL DEFAULT 'application/pdf',
          status VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
          version INT NOT NULL DEFAULT 1,
          uploaded_by INT NOT NULL,
          verified_by INT NULL,
          verified_at DATETIME NULL,
          notes TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_tc_doc (theory_class_id, item_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS lab_class_files (
          id INT AUTO_INCREMENT PRIMARY KEY,
          teaching_group_id INT NOT NULL,
          subject_id INT NULL,
          teacher_id INT NOT NULL,
          department_id INT NOT NULL,
          academic_year_id INT NULL,
          semester INT NOT NULL DEFAULT 1,
          status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
          hod_remarks TEXT NULL,
          audited_at DATETIME NULL,
          audited_by INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_lc_tg (teaching_group_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS lab_class_documents (
          id INT AUTO_INCREMENT PRIMARY KEY,
          lab_class_id INT NOT NULL,
          item_key VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_size INT NULL DEFAULT 0,
          mime_type VARCHAR(100) NULL DEFAULT 'application/pdf',
          status VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
          version INT NOT NULL DEFAULT 1,
          uploaded_by INT NOT NULL,
          verified_by INT NULL,
          verified_at DATETIME NULL,
          notes TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_lc_doc (lab_class_id, item_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('MySQL compatibility views (exams, exam_scores, assignments, etc.) verified successfully.');
    } catch (err) {
      logger.warn('Failed to ensure MySQL compatibility views', { error: err.message });
    }
  } else {
    // SQLite
    const db = getSqliteDb();
    if (!db) return;
    try {
      db.exec(`
        CREATE VIEW IF NOT EXISTS exams AS
        SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
               title AS name, due_date AS exam_date, max_marks, unit_name, instructions, questions, created_at, updated_at
        FROM assessments
        WHERE type = 'EXAM';

        CREATE VIEW IF NOT EXISTS exam_scores AS
        SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
               graded_by AS entered_by, created_at, updated_at
        FROM assessment_submissions;

        CREATE VIEW IF NOT EXISTS assignments AS
        SELECT id, teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id,
               title, description, attachment_path, attachment_name, due_date, max_marks, unit_name, instructions, questions, created_at, updated_at
        FROM assessments
        WHERE type = 'ASSIGNMENT';

        CREATE VIEW IF NOT EXISTS assignment_submissions AS
        SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
               submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
        FROM assessment_submissions;

        CREATE VIEW IF NOT EXISTS attendance_session_pins AS
        SELECT id AS session_id, verification_pin AS pin_code, verification_expires_at AS expires_at, created_at
        FROM attendance_sessions
        WHERE verification_pin IS NOT NULL;

        CREATE VIEW IF NOT EXISTS attendance_session_qr AS
        SELECT id AS session_id, verification_qr_hash AS token_hash, verification_expires_at AS expires_at, created_at
        FROM attendance_sessions
        WHERE verification_qr_hash IS NOT NULL;
      `);
    } catch (_) {}
  }
}

/**
 * Test DB connection and report readiness
 */
async function testConnection() {
  if (DB_CLIENT === 'mysql') {
    try {
      const p = getPool();
      const [result] = await p.query('SELECT 1 + 1 AS solution');
      logger.info('MySQL Database connected successfully.', { solution: result[0].solution });
      await ensureCompatibilityViews();
      return true;
    } catch (err) {
      logger.warn(
        'MySQL Connection Warning: Unable to connect to MySQL database at ' +
          `${process.env.DB_HOST}:${process.env.DB_PORT}. Ensure MySQL service is running and database exists.`,
        { error: err.message }
      );
      return false;
    }
  }

  // SQLite
  try {
    const db = getSqliteDb();
    const row = db.prepare('SELECT 1 + 1 AS solution').get();
    logger.info('SQLite Local Database connected and ready.', {
      solution: row.solution,
      db_file: process.env.SQLITE_FILE || 'college_attendance.sqlite'
    });
    await ensureCompatibilityViews();
    return true;
  } catch (err) {
    logger.error('SQLite Database initialization error', { error: err.message });
    return false;
  }
}

module.exports = {
  getPool,
  query,
  getConnection,
  withTransaction,
  testConnection,
  ensureCompatibilityViews
};
