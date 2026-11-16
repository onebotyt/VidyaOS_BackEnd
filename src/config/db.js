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
    pool = mysql.createPool({
      host: env.DB_HOST || '127.0.0.1',
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
      multipleStatements: false
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
  logger.info('✓ MySQL 8.x compatibility views verified (exams, exam_scores, assignments, etc.)');
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
