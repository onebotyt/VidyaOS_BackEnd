/**
 * VidyaOS Pure MySQL 8.x / MariaDB Database Adapter
 * Exclusively uses mysql2/promise connection pooling.
 */

const mysql = require('mysql2/promise');
const env = require('./env');
const logger = require('../utils/logger');

let pool = null;

/**
 * Converts positional parameters (?) for mysql2 compatibility
 * and normalizes undefined -> null.
 * @param {string} sql
 * @param {Array} params
 */
function normalizeParams(params = []) {
  if (!Array.isArray(params)) return [];
  return params.map((p) => (p === undefined ? null : p));
}

/**
 * Initializes and returns the singleton MySQL connection pool.
 */
function getPool() {
  if (!pool) {
    const isLocal = ['127.0.0.1', 'localhost'].includes(env.DB_HOST);
    const useSsl = env.DB_SSL === 'true' || (!isLocal && env.DB_SSL !== 'false' && process.env.NODE_ENV === 'production');
    pool = mysql.createPool({
      host: (env.DB_HOST === 'localhost' ? '127.0.0.1' : env.DB_HOST) || '127.0.0.1',
      port: Number(env.DB_PORT) || 3306,
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'college_attendance',
      waitForConnections: true,
      connectionLimit: Number(env.DB_POOL_MAX) || 15,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      timezone: '+05:30',
      decimalNumbers: true,
      dateStrings: true,
      multipleStatements: false,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
    });
  }
  return pool;
}

/**
 * Wraps a raw mysql2 connection to provide consistent .query(), .execute(), .get(), and .run() helpers.
 */
function wrapConnection(rawConn) {
  return {
    raw: rawConn,
    async query(sql, params = []) {
      const [rows] = await rawConn.query(sql, normalizeParams(params));
      return [rows];
    },
    async execute(sql, params = []) {
      const [result] = await rawConn.execute(sql, normalizeParams(params));
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        result.lastID = result.insertId;
      }
      return [result];
    },
    async get(sql, params = []) {
      const [rows] = await rawConn.query(sql, normalizeParams(params));
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async run(sql, params = []) {
      const [result] = await rawConn.execute(sql, normalizeParams(params));
      return {
        insertId: result?.insertId || 0,
        lastID: result?.insertId || 0,
        affectedRows: result?.affectedRows || 0,
        changes: result?.affectedRows || 0
      };
    },
    release() {
      return rawConn.release();
    }
  };
}

/**
 * Executes a SQL query against the MySQL pool.
 * Returns an array of rows for SELECT/SHOW/DESCRIBE queries, or result metadata for DML.
 */
async function query(sql, params = []) {
  const activePool = getPool();
  const [rows] = await activePool.query(sql, normalizeParams(params));
  if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
    rows.lastID = rows.insertId;
  }
  return rows;
}

/**
 * Executes a SQL query and returns the first row or null.
 */
async function get(sql, params = []) {
  const rows = await query(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

/**
 * Executes an INSERT/UPDATE/DELETE statement and returns { insertId, lastID, affectedRows, changes }.
 */
async function run(sql, params = []) {
  const activePool = getPool();
  const [result] = await activePool.execute(sql, normalizeParams(params));
  return {
    insertId: result?.insertId || 0,
    lastID: result?.insertId || 0,
    affectedRows: result?.affectedRows || 0,
    changes: result?.affectedRows || 0
  };
}

/**
 * Executes an async callback inside a managed MySQL InnoDB transaction.
 */
async function withTransaction(callback) {
  const activePool = getPool();
  const rawConn = await activePool.getConnection();
  const wrapped = wrapConnection(rawConn);
  try {
    await rawConn.beginTransaction();
    const result = await callback(wrapped);
    await rawConn.commit();
    return result;
  } catch (err) {
    await rawConn.rollback();
    throw err;
  } finally {
    rawConn.release();
  }
}

/**
 * Verifies MySQL connectivity on server startup.
 */
async function testConnection() {
  try {
    const activePool = getPool();
    const conn = await activePool.getConnection();
    await conn.ping();
    conn.release();
    logger.info(`✓ MySQL 8.x Database Pool connected (${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME})`);
    return true;
  } catch (err) {
    logger.error('✗ MySQL Database connection failed:', err.message);
    throw err;
  }
}

/**
 * Gracefully closes the MySQL connection pool.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL connection pool closed.');
  }
}

/**
 * Automatically creates and ensures SQL compatibility views across MySQL 8.x
 * (assignments, assignment_submissions, exams, exam_scores, attendance_session_pins, attendance_session_qr)
 */
async function ensureCompatibilityViews() {
  const views = [
    `CREATE OR REPLACE VIEW assignments AS
     SELECT id, teacher_id, subject_id, group_id, department_id, year, semester, academic_year_id,
            title, description, attachment_path, attachment_name, due_date, max_marks, created_at, updated_at
     FROM assessments
     WHERE type = 'ASSIGNMENT'`,

    `CREATE OR REPLACE VIEW assignment_submissions AS
     SELECT id, assessment_id AS assignment_id, student_id, file_path, original_filename,
            submitted_at, status, marks_obtained, feedback, graded_at, graded_by, created_at, updated_at
     FROM assessment_submissions`,

    `CREATE OR REPLACE VIEW exams AS
     SELECT id, teacher_id, subject_id, group_id, department_id, year, semester, academic_year_id,
            title AS name, due_date AS exam_date, max_marks, created_at, updated_at
     FROM assessments
     WHERE type = 'EXAM'`,

    `CREATE OR REPLACE VIEW exam_scores AS
     SELECT id, assessment_id AS exam_id, student_id, marks_obtained, feedback AS remarks,
            graded_by AS entered_by, created_at, updated_at
     FROM assessment_submissions`,

    `CREATE OR REPLACE VIEW attendance_session_pins AS
     SELECT id AS session_id, COALESCE(verification_pin, pin_code) AS pin_code,
            COALESCE(verification_expires_at, token_expires_at) AS expires_at, created_at
     FROM attendance_sessions
     WHERE verification_pin IS NOT NULL OR pin_code IS NOT NULL`,

    `CREATE OR REPLACE VIEW attendance_session_qr AS
     SELECT id AS session_id, COALESCE(verification_qr_hash, qr_token) AS token_hash,
            COALESCE(verification_expires_at, token_expires_at) AS expires_at, created_at
     FROM attendance_sessions
     WHERE verification_qr_hash IS NOT NULL OR qr_token IS NOT NULL`
  ];

  for (const v of views) {
    try {
      await query(v);
    } catch (err) {
      logger.warn(`Failed to create compatibility view: ${err.message}`);
    }
  }

  // Ensure crucial tables and columns exist across any MySQL database instance
  try {
    // 1. Ensure teaching_groups.subject_code exists
    const tgCols = await query("SHOW COLUMNS FROM teaching_groups LIKE 'subject_code'");
    if (!tgCols || tgCols.length === 0) {
      await query("ALTER TABLE teaching_groups ADD COLUMN subject_code VARCHAR(50) DEFAULT NULL AFTER subject_name");
      logger.info('✓ Added missing column teaching_groups.subject_code');
    }

    // 1a. Ensure teaching_groups.start_date and end_date exist
    const tgDateCols = await query("SHOW COLUMNS FROM teaching_groups LIKE 'start_date'");
    if (!tgDateCols || tgDateCols.length === 0) {
      await query("ALTER TABLE teaching_groups ADD COLUMN start_date DATE NULL AFTER semester");
      await query("ALTER TABLE teaching_groups ADD COLUMN end_date DATE NULL AFTER start_date");
      await query("UPDATE teaching_groups SET start_date = DATE(created_at) WHERE start_date IS NULL");
      logger.info('✓ Added missing columns teaching_groups.start_date and end_date');
    }

    // 1a-reg. Ensure attendance_registers.start_date and end_date exist
    const arDateCols = await query("SHOW COLUMNS FROM attendance_registers LIKE 'start_date'");
    if (!arDateCols || arDateCols.length === 0) {
      await query("ALTER TABLE attendance_registers ADD COLUMN start_date DATE NULL AFTER semester");
      await query("ALTER TABLE attendance_registers ADD COLUMN end_date DATE NULL AFTER start_date");
      await query("UPDATE attendance_registers SET start_date = DATE(created_at) WHERE start_date IS NULL");
      logger.info('✓ Added missing columns attendance_registers.start_date and end_date');
    }

    // 1b. Ensure teachers.designation exists
    try {
      const desigCols = await query("SHOW COLUMNS FROM teachers LIKE 'designation'");
      if (!desigCols || desigCols.length === 0) {
        await query("ALTER TABLE teachers ADD COLUMN designation VARCHAR(100) NULL DEFAULT 'Lecturer' AFTER full_name");
        await query("UPDATE teachers SET designation = 'Head of Department' WHERE employee_id LIKE '%HOD%'");
        logger.info('✓ Added missing column teachers.designation');
      }
    } catch (_) {}

    // 1c. Ensure students.deleted_at exists for trash management
    const stuCols = await query("SHOW COLUMNS FROM students LIKE 'deleted_at'");
    if (!stuCols || stuCols.length === 0) {
      await query("ALTER TABLE students ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER updated_at");
      logger.info('✓ Added missing column students.deleted_at');
    }

    // 1c. Ensure fingerprint_slots has slot_id for compatibility
    try {
      const fsCols = await query("SHOW COLUMNS FROM fingerprint_slots LIKE 'slot_id'");
      if (!fsCols || fsCols.length === 0) {
        await query("ALTER TABLE fingerprint_slots ADD COLUMN slot_id INT NULL AFTER slot_number");
        await query("UPDATE fingerprint_slots SET slot_id = slot_number WHERE slot_id IS NULL");
        logger.info('✓ Added missing column fingerprint_slots.slot_id');
      }
    } catch (_) {}

    // 1d. Ensure students.official_enrollment_no allows NULL and enrollment_no_status exists
    try {
      await query("ALTER TABLE students MODIFY official_enrollment_no VARCHAR(100) NULL DEFAULT NULL");
      const statCols = await query("SHOW COLUMNS FROM students LIKE 'enrollment_no_status'");
      if (!statCols || statCols.length === 0) {
        await query("ALTER TABLE students ADD COLUMN enrollment_no_status VARCHAR(50) DEFAULT 'ASSIGNED' AFTER official_enrollment_no");
        await query("UPDATE students SET enrollment_no_status = 'Not Assigned' WHERE official_enrollment_no IS NULL OR official_enrollment_no = '' OR official_enrollment_no = 'Not Assigned'");
        logger.info('✓ Added missing column students.enrollment_no_status');
      }
    } catch (_) {}
  } catch (err) {
    logger.warn(`Note on teaching_groups.subject_code check: ${err.message}`);
  }

  try {
    // 2. Ensure theory_class_files table exists
    await query(`
      CREATE TABLE IF NOT EXISTS theory_class_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teaching_group_id INT NULL,
        subject_id INT NULL,
        teacher_id INT NULL,
        department_id INT NULL,
        semester INT DEFAULT 1,
        academic_year_id INT NULL,
        status VARCHAR(50) DEFAULT 'IN_PROGRESS',
        hod_remarks TEXT NULL,
        audited_by INT NULL,
        audited_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tc_group (teaching_group_id),
        INDEX idx_tc_teacher (teacher_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Ensure theory_class_documents table exists
    await query(`
      CREATE TABLE IF NOT EXISTS theory_class_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        theory_class_id INT NOT NULL,
        item_key VARCHAR(100) NOT NULL,
        document_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size BIGINT DEFAULT 0,
        mime_type VARCHAR(100) DEFAULT 'application/pdf',
        uploaded_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tcd_class (theory_class_id),
        INDEX idx_tcd_item (item_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. Ensure timetable_files table exists for simple year-based PDF timetable uploads
    await query(`
      CREATE TABLE IF NOT EXISTS timetable_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        department_id INT NULL,
        year INT NOT NULL,
        semester INT NULL,
        academic_year_id INT NULL,
        title VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size BIGINT DEFAULT 0,
        uploaded_by INT NULL,
        uploader_name VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tt_year (year),
        INDEX idx_tt_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. Ensure student_documents table exists for archived student records
    await query(`
      CREATE TABLE IF NOT EXISTS student_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        department_id INT NULL,
        title VARCHAR(255) NOT NULL,
        document_type VARCHAR(100) NOT NULL DEFAULT 'ACADEMIC_RECORD',
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NULL,
        file_size INT NULL,
        mime_type VARCHAR(100) NULL,
        uploaded_by INT NULL,
        uploader_name VARCHAR(255) NULL,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_stdoc_student (student_id),
        INDEX idx_stdoc_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 6. Ensure bug_reports table exists for website technical issue reporting
    await query(`
      CREATE TABLE IF NOT EXISTS bug_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id VARCHAR(30) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        user_name VARCHAR(150) NOT NULL,
        user_role VARCHAR(50) NOT NULL,
        user_email VARCHAR(150) NULL,
        department_id INT NULL,
        department_name VARCHAR(150) NULL,
        issue_title VARCHAR(255) NOT NULL,
        issue_category VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        screenshot_url VARCHAR(500) NOT NULL,
        screenshot_filename VARCHAR(255) NOT NULL,
        recording_url VARCHAR(500) NULL,
        recording_filename VARCHAR(255) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'New',
        admin_response TEXT NULL,
        rejection_reason TEXT NULL,
        resolved_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bug_user (user_id),
        INDEX idx_bug_status (status),
        INDEX idx_bug_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    logger.warn(`Note on tables auto-provision check: ${err.message}`);
  }

  logger.info('✓ MySQL 8.x compatibility views & schema auto-healing verified (exams, theory_classes, etc.)');
}

module.exports = {
  getPool,
  query,
  get,
  run,
  withTransaction,
  testConnection,
  ensureCompatibilityViews,
  closePool
};
