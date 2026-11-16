/**
 * Student & Auth Schema Migration Service (MySQL 8.x)
 * Ensures required columns and tables exist on MySQL startup:
 * 1. registration_no (UBTER Roll Number) on students table
 * 2. class_roll_no (Classroom Roll Number) on students table
 * 3. Backfills class_roll_no from enrollments if missing
 * 4. Ensures phone & OTP verification schema on users, students, teachers, and otp_verifications
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

async function getTableColumnNames(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Array.isArray(rows) ? rows.map((r) => r.name || r.COLUMN_NAME) : [];
}

async function ensureStudentColumns() {
  try {
    const colNames = await getTableColumnNames('students');

    if (!colNames.includes('registration_no')) {
      try {
        logger.info('Migrating schema: Adding registration_no column to students table...');
        await query('ALTER TABLE students ADD COLUMN registration_no VARCHAR(100) NULL');
        logger.info('✓ Column registration_no added successfully.');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }

    if (!colNames.includes('class_roll_no')) {
      try {
        logger.info('Migrating schema: Adding class_roll_no column to students table...');
        await query('ALTER TABLE students ADD COLUMN class_roll_no INT NULL');
        logger.info('✓ Column class_roll_no added successfully.');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }

    await query(`
      UPDATE students s
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      SET s.class_roll_no = e.class_roll_no
      WHERE s.class_roll_no IS NULL AND e.class_roll_no IS NOT NULL
    `).catch(() => {});

    try {
      await query('CREATE INDEX idx_students_registration_no ON students(registration_no)');
    } catch (_) {}
    try {
      await query('CREATE INDEX idx_students_class_roll_no ON students(class_roll_no)');
    } catch (_) {}

    await ensureOtpAndPhoneColumns();
    await ensureSessionAndAttendanceColumns();
  } catch (err) {
    logger.warn('Student schema migration warning:', err.message);
  }
}

async function ensureOtpAndPhoneColumns() {
  try {
    const userColNames = await getTableColumnNames('users');
    if (!userColNames.includes('phone')) {
      try {
        await query('ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL');
        try {
          await query('CREATE INDEX idx_users_phone ON users(phone)');
        } catch (_) {}
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }

    const stdColNames = await getTableColumnNames('students');
    const safeAddStudentCol = async (col, def) => {
      if (!stdColNames.includes(col)) {
        try {
          await query(`ALTER TABLE students ADD COLUMN ${col} ${def}`);
        } catch (e) {
          if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
        }
      }
    };

    await safeAddStudentCol('phone', 'VARCHAR(20) NULL');
    await safeAddStudentCol('parent_phone', 'VARCHAR(20) NULL');
    await safeAddStudentCol('parent_name', 'VARCHAR(150) NULL');
    await safeAddStudentCol('is_phone_verified', 'TINYINT(1) DEFAULT 0');
    await safeAddStudentCol('address', 'TEXT NULL');
    await safeAddStudentCol('aadhar_number', 'VARCHAR(20) NULL');
    await safeAddStudentCol('father_name', 'VARCHAR(150) NULL');
    await safeAddStudentCol('mother_name', 'VARCHAR(150) NULL');
    await safeAddStudentCol('dob', 'DATE NULL');
    await safeAddStudentCol('gender', 'VARCHAR(20) NULL');
    await safeAddStudentCol('category', 'VARCHAR(50) NULL');
    await safeAddStudentCol('profile_completed', 'TINYINT(1) DEFAULT 0');

    const teachColNames = await getTableColumnNames('teachers');
    if (!teachColNames.includes('is_phone_verified')) {
      try {
        await query('ALTER TABLE teachers ADD COLUMN is_phone_verified TINYINT(1) DEFAULT 0');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }

    await query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        identifier VARCHAR(150) NOT NULL,
        otp_code VARCHAR(20) NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        user_id INT NULL,
        verification_token VARCHAR(255) NULL,
        expires_at DATETIME NOT NULL,
        attempts INT DEFAULT 0,
        is_verified TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_otp_identifier_purpose (identifier, purpose),
        INDEX idx_otp_token (verification_token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    logger.warn('OTP/Phone schema migration warning:', err.message);
  }
}

async function ensureSessionAndAttendanceColumns() {
  try {
    const sessionCols = await getTableColumnNames('user_sessions');
    if (!sessionCols.includes('device_id')) {
      try {
        await query('ALTER TABLE user_sessions ADD COLUMN device_id VARCHAR(100) NULL AFTER ip_address');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }
    if (!sessionCols.includes('last_active_at')) {
      try {
        await query('ALTER TABLE user_sessions ADD COLUMN last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER device_id');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }

    const attendanceCols = await getTableColumnNames('attendance_sessions');
    if (!attendanceCols.includes('auto_close_at')) {
      try {
        await query('ALTER TABLE attendance_sessions ADD COLUMN auto_close_at DATETIME NULL AFTER state');
      } catch (e) {
        if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) throw e;
      }
    }
  } catch (err) {
    logger.warn('Session/Attendance schema migration warning:', err.message);
  }
}

module.exports = { ensureStudentColumns, ensureOtpAndPhoneColumns, ensureSessionAndAttendanceColumns };
