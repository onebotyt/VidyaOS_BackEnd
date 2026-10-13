/**
 * Student Schema Migration & UBTER Identifier Synchronization Service
 * Ensures:
 * 1. registration_no (UBTER Official Registration Number) exists on students table
 * 2. class_roll_no (Classroom Roll Number) exists directly on students table
 * 3. Existing students have class_roll_no backfilled from enrollments
 * 4. Indexes are created for fast lookups
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

async function ensureStudentColumns() {
  try {
    const cols = await query("PRAGMA table_info('students')");
    const colNames = Array.isArray(cols) ? cols.map(c => c.name) : [];

    // 1. Ensure registration_no exists
    if (!colNames.includes('registration_no')) {
      logger.info('Migrating schema: Adding registration_no column to students table...');
      await query('ALTER TABLE students ADD COLUMN registration_no TEXT');
      logger.info('✓ Column registration_no added successfully.');
    }

    // 2. Ensure class_roll_no exists
    if (!colNames.includes('class_roll_no')) {
      logger.info('Migrating schema: Adding class_roll_no column to students table...');
      await query('ALTER TABLE students ADD COLUMN class_roll_no INTEGER');
      logger.info('✓ Column class_roll_no added successfully.');
    }

    // 3. Create indexes
    try {
      await query('CREATE INDEX IF NOT EXISTS idx_students_reg_no ON students(registration_no)');
      await query('CREATE INDEX IF NOT EXISTS idx_students_class_roll ON students(class_roll_no)');
    } catch (_) {}

    // 4. Backfill class_roll_no from enrollments for any student where it is null
    try {
      await query(`
        UPDATE students
        SET class_roll_no = (
          SELECT e.class_roll_no 
          FROM enrollments e 
          WHERE e.student_id = students.id 
          ORDER BY e.id DESC 
          LIMIT 1
        )
        WHERE class_roll_no IS NULL 
          AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = students.id AND e.class_roll_no IS NOT NULL)
      `);
    } catch (backfillErr) {
      logger.warn('Backfill class_roll_no note: ' + backfillErr.message);
    }

    // 5. Backfill realistic UBTER registration numbers for demo students (2024IT001..2024IT010) if empty
    try {
      const demoStudents = await query(`
        SELECT id, official_enrollment_no, class_roll_no 
        FROM students 
        WHERE registration_no IS NULL AND official_enrollment_no LIKE '2024IT%'
      `);
      for (const st of demoStudents) {
        const numPart = (st.official_enrollment_no.match(/\d+$/) || ['001'])[0].padStart(3, '0');
        const ubterReg = `24101054${numPart}`;
        await query(`UPDATE students SET registration_no = ? WHERE id = ?`, [ubterReg, st.id]);
      }
    } catch (_) {}

    logger.info('UBTER student identifiers schema & data verified.');
    return true;
  } catch (err) {
    logger.error('Failed to ensure student schema columns: ' + err.message);
    return false;
  }
}

/**
 * Ensures phone columns and otp_verifications table exist for Unified Auth & OTP Security
 */
async function ensureOtpAndPhoneColumns() {
  try {
    // 1. users.phone
    const userCols = await query("PRAGMA table_info('users')");
    const userColNames = Array.isArray(userCols) ? userCols.map(c => c.name) : [];
    if (!userColNames.includes('phone')) {
      logger.info('Migrating schema: Adding phone column to users table...');
      await query('ALTER TABLE users ADD COLUMN phone TEXT');
      try {
        await query('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
      } catch (_) {}
      logger.info('✓ Column phone added to users.');
    }

    // 2. students columns: phone, parent_phone, parent_name, is_phone_verified
    const stdCols = await query("PRAGMA table_info('students')");
    const stdColNames = Array.isArray(stdCols) ? stdCols.map(c => c.name) : [];
    if (!stdColNames.includes('phone')) {
      logger.info('Migrating schema: Adding phone column to students table...');
      await query('ALTER TABLE students ADD COLUMN phone TEXT');
      try {
        await query('CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone)');
      } catch (_) {}
    }
    if (!stdColNames.includes('parent_phone')) {
      await query('ALTER TABLE students ADD COLUMN parent_phone TEXT');
    }
    if (!stdColNames.includes('parent_name')) {
      await query('ALTER TABLE students ADD COLUMN parent_name TEXT');
    }
    if (!stdColNames.includes('is_phone_verified')) {
      await query('ALTER TABLE students ADD COLUMN is_phone_verified INTEGER DEFAULT 0');
    }

    // 3. teachers columns: is_phone_verified
    const teachCols = await query("PRAGMA table_info('teachers')");
    const teachColNames = Array.isArray(teachCols) ? teachCols.map(c => c.name) : [];
    if (!teachColNames.includes('is_phone_verified')) {
      await query('ALTER TABLE teachers ADD COLUMN is_phone_verified INTEGER DEFAULT 0');
    }

    // 4. Create otp_verifications table
    await query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        user_id INTEGER,
        verification_token TEXT,
        expires_at DATETIME NOT NULL,
        attempts INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try {
      await query('CREATE INDEX IF NOT EXISTS idx_otp_identifier_purpose ON otp_verifications(identifier, purpose)');
      await query('CREATE INDEX IF NOT EXISTS idx_otp_token ON otp_verifications(verification_token)');
    } catch (_) {}

    // 5. Backfill demo phones for test accounts if empty (enabling seamless phone login testing)
    try {
      // Give teacher@gmail.com phone 9876543210
      await query(`UPDATE users SET phone = '9876543210' WHERE email = 'teacher@gmail.com' AND (phone IS NULL OR phone = '')`);
      await query(`UPDATE teachers SET phone = '9876543210', is_phone_verified = 1 WHERE user_id = (SELECT id FROM users WHERE email = 'teacher@gmail.com')`);

      // Give student 2024IT001 (student@gmail.com) phone 9876500001
      await query(`UPDATE users SET phone = '9876500001' WHERE email = 'student@gmail.com' AND (phone IS NULL OR phone = '')`);
      await query(`UPDATE students SET phone = '9876500001', is_phone_verified = 1 WHERE user_id = (SELECT id FROM users WHERE email = 'student@gmail.com')`);
    } catch (_) {}

    logger.info('OTP and phone schema migration verified.');
    return true;
  } catch (err) {
    logger.error('Failed to ensure OTP & phone schema columns: ' + err.message);
    return false;
  }
}

module.exports = {
  ensureStudentColumns,
  ensureOtpAndPhoneColumns
};

