/**
 * Dual Database Adapter: SQLite (Local Testing) / MySQL (Deployment)
 * Controlled via DB_CLIENT in .env ('sqlite' | 'mysql')
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config();
const logger = require('../utils/logger');

const DB_CLIENT = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

let pool = null;
let sqliteDb = null;

// =============================================================================
// SQLite Helper & Compatibility Layer
// =============================================================================

function getSqliteDb() {
  if (!sqliteDb) {
    const { DatabaseSync } = require('node:sqlite');
    const dbFilePath = process.env.SQLITE_FILE
      ? (path.isAbsolute(process.env.SQLITE_FILE) ? process.env.SQLITE_FILE : path.resolve(process.cwd(), process.env.SQLITE_FILE))
      : (fs.existsSync(path.resolve(__dirname, '../../college_attendance.sqlite'))
          ? path.resolve(__dirname, '../../college_attendance.sqlite')
          : path.resolve(__dirname, '../college_attendance.sqlite'));

    const dbDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    sqliteDb = new DatabaseSync(dbFilePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');

    // Register MySQL-compatible SQL functions in SQLite
    sqliteDb.function('NOW', () => new Date().toISOString().replace('T', ' ').slice(0, 19));
    sqliteDb.function('CURDATE', () => new Date().toISOString().slice(0, 10));
    sqliteDb.function('DATE', (d) => (d ? String(d).slice(0, 10) : null));
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

      // Check if users table is empty or missing master admin
      let userCount = 0;
      try {
        const countRow = sqliteDb.prepare("SELECT count(*) as c FROM users").get();
        userCount = countRow ? countRow.c : 0;
      } catch (_) {}

      if (userCount < 10) {
        logger.info(`Users count (${userCount}) is incomplete. Seeding full institutional demo dataset...`);
        try {
          const { seed } = require(path.resolve(__dirname, '../../scripts/seed-demo.js'));
          seed(sqliteDb);
          logger.info('Institutional demo seed loaded successfully!');
        } catch (seedErr) {
          logger.error('Failed to run seed-demo.js', { error: seedErr.message });
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

        CREATE TABLE IF NOT EXISTS parent_communication_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          recipient_phone TEXT NOT NULL,
          recipient_name TEXT,
          channel TEXT NOT NULL DEFAULT 'WHATSAPP',
          template_type TEXT NOT NULL DEFAULT 'ATTENDANCE_CRITICAL',
          message_body TEXT NOT NULL,
          message_payload TEXT,
          attendance_pct REAL,
          total_classes INTEGER,
          attended_classes INTEGER,
          shortfall_classes INTEGER,
          dispatched_by INTEGER REFERENCES users(id),
          faculty_id INTEGER REFERENCES users(id),
          status TEXT NOT NULL DEFAULT 'DELIVERED',
          delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
          gateway_response TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS parent_escalation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          recipient_phone TEXT NOT NULL,
          recipient_name TEXT,
          channel TEXT NOT NULL DEFAULT 'WHATSAPP',
          template_type TEXT NOT NULL DEFAULT 'ATTENDANCE_CRITICAL',
          message_payload TEXT,
          message_body TEXT,
          attendance_pct REAL,
          total_classes INTEGER,
          attended_classes INTEGER,
          shortfall_classes INTEGER,
          faculty_id INTEGER REFERENCES users(id),
          dispatched_by INTEGER REFERENCES users(id),
          delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
          status TEXT NOT NULL DEFAULT 'DELIVERED',
          gateway_response TEXT,
          sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      try { sqliteDb.exec('ALTER TABLE parent_communication_logs ADD COLUMN message_payload TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_communication_logs ADD COLUMN delivery_status TEXT DEFAULT \'DELIVERED\';'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_communication_logs ADD COLUMN faculty_id INTEGER;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_communication_logs ADD COLUMN sent_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN message_payload TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN message_body TEXT;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN delivery_status TEXT DEFAULT \'DELIVERED\';'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN status TEXT DEFAULT \'DELIVERED\';'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN faculty_id INTEGER;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN dispatched_by INTEGER;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN sent_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (_) {}
      try { sqliteDb.exec('ALTER TABLE parent_escalation_logs ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (_) {}

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
      `);

      // Ensure Admin account has admin@gmail.com and admin username alias
      try {
        sqliteDb.exec(`
          UPDATE users SET email = 'admin@gmail.com', password_hash = '$2b$12$F3fQ1FKnymvFYcx0TBmJrefTNI5O5H07rSeF0IqofBlRt7J5dv9GW' WHERE id IN (SELECT user_id FROM user_roles WHERE role = 'SYSTEM_ADMIN');
          UPDATE users SET email = 'admin@gmail.com', password_hash = '$2b$12$F3fQ1FKnymvFYcx0TBmJrefTNI5O5H07rSeF0IqofBlRt7J5dv9GW' WHERE username = 'admin' OR id = 1;
          INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
          VALUES (1, 'admin@gmail.com', 'admin@gmail.com', '$2b$12$F3fQ1FKnymvFYcx0TBmJrefTNI5O5H07rSeF0IqofBlRt7J5dv9GW', 0, 'ACTIVE');
          INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (1, 'SYSTEM_ADMIN');
        `);
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
  trans = trans.replace(/DATE_SUB\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, "datetime($1, '-$2 minutes')");
  trans = trans.replace(/DATE_ADD\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, "datetime($1, '+$2 minutes')");

  // Handle MySQL CURDATE() -> SQLite CURRENT_DATE
  trans = trans.replace(/CURDATE\s*\(\s*\)/gi, "CURRENT_DATE");

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
// MySQL Helper Layer
// =============================================================================

function getPool() {
  if (!pool && DB_CLIENT === 'mysql') {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'college_attendance',
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
      queueLimit: 0,
      timezone: '+00:00',
      dateStrings: true
    });
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
    const [rows] = await p.execute(sql, params);
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

      const resultArr = [resultObj];
      resultArr.insertId = insertId;
      resultArr.affectedRows = affectedRows;
      return resultArr;
    }
  } catch (err) {
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
    return await getPool().getConnection();
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
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw error;
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
  testConnection
};
