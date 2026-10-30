/**
 * IoT Presence, Time-Aware Department Enrollments & Attendance Corrections Migration Service
 * Implements architectural requirements from redesign.md (Sections 16, 30–32, 42–44, 49, 53)
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

async function ensureIotAndCorrectionTables() {
  try {
    const isMysql = (process.env.DB_CLIENT || '').toLowerCase() === 'mysql';

    if (isMysql) {
      await query(`
        CREATE TABLE IF NOT EXISTS iot_attendance_events (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_id INT NOT NULL,
          device_id INT NOT NULL,
          department_id INT,
          scan_time DATETIME NOT NULL,
          scan_date DATE,
          verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED',
          event_type VARCHAR(50) NOT NULL DEFAULT 'FINGERPRINT',
          payload_json LONGTEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_iot_events_student_date (student_id, scan_date),
          INDEX idx_iot_events_device (device_id),
          INDEX idx_iot_events_dept (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS attendance_corrections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id INT NOT NULL,
          student_id INT NOT NULL,
          original_status VARCHAR(50) NOT NULL,
          new_status VARCHAR(50) NOT NULL,
          reason TEXT NOT NULL,
          changed_by INT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_att_corr_session (session_id),
          INDEX idx_att_corr_student (student_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS student_department_enrollments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_id INT NOT NULL,
          department_id INT NOT NULL,
          academic_year_id INT,
          year INT NOT NULL DEFAULT 1,
          semester INT NOT NULL DEFAULT 1,
          class_roll_no INT,
          start_date DATE NOT NULL,
          end_date DATE,
          status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_sde_student (student_id),
          INDEX idx_sde_dept (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    } else {
      // 1. Ensure iot_attendance_events table exists (Raw Immutable IoT Events Layer)
      await query(`
        CREATE TABLE IF NOT EXISTS iot_attendance_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
          scan_time DATETIME NOT NULL,
          scan_date DATE,
          verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
          event_type TEXT NOT NULL DEFAULT 'FINGERPRINT',
          payload_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS idx_iot_events_student_date ON iot_attendance_events(student_id, scan_date)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_iot_events_device ON iot_attendance_events(device_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_iot_events_dept ON iot_attendance_events(department_id)`);

      // 2. Ensure attendance_corrections table exists (Post-Finalization Correction Audit)
      await query(`
        CREATE TABLE IF NOT EXISTS attendance_corrections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          original_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          reason TEXT NOT NULL,
          changed_by INTEGER NOT NULL REFERENCES users(id),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS idx_att_corr_session ON attendance_corrections(session_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_att_corr_student ON attendance_corrections(student_id)`);

      // 3. Ensure student_department_enrollments table exists (Time-Aware Academic Department Enrollment)
      await query(`
        CREATE TABLE IF NOT EXISTS student_department_enrollments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          academic_year_id INTEGER REFERENCES academic_years(id),
          year INTEGER NOT NULL DEFAULT 1,
          semester INTEGER NOT NULL DEFAULT 1,
          class_roll_no INTEGER,
          start_date DATE NOT NULL,
          end_date DATE,
          status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'TRANSFERRED' | 'COMPLETED'
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS idx_sde_student ON student_department_enrollments(student_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_sde_dept ON student_department_enrollments(department_id)`);
    }

    // 4. Safe backfill for student_department_enrollments from existing enrollments
    try {
      const sdeCount = (await query('SELECT COUNT(*) as cnt FROM student_department_enrollments'))[0]?.cnt || 0;
      if (sdeCount === 0) {
        await query(`
          INSERT INTO student_department_enrollments 
            (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
          SELECT 
            e.student_id, 
            e.department_id, 
            e.academic_year_id, 
            e.year, 
            e.semester, 
            COALESCE(s.class_roll_no, e.class_roll_no), 
            DATE(e.created_at), 
            'ACTIVE'
          FROM enrollments e
          JOIN students s ON e.student_id = s.id
          WHERE e.status = 'ENROLLED'
        `);
        logger.info('✓ Backfilled student_department_enrollments from active enrollments.');
      }
    } catch (bfErr) {
      logger.warn('Backfill student_department_enrollments note: ' + bfErr.message);
    }

    // 5. Safe backfill for iot_attendance_events from existing esp32_presence
    try {
      const iotCount = (await query('SELECT COUNT(*) as cnt FROM iot_attendance_events'))[0]?.cnt || 0;
      if (iotCount === 0) {
        await query(`
          INSERT INTO iot_attendance_events
            (student_id, device_id, department_id, scan_time, scan_date, verification_status, event_type, payload_json, created_at)
          SELECT
            ep.student_id,
            ep.device_id,
            d.department_id,
            ep.scan_time,
            DATE(ep.scan_time),
            'VERIFIED',
            'FINGERPRINT',
            ep.payload_json,
            ep.created_at
          FROM esp32_presence ep
          JOIN devices d ON ep.device_id = d.id
        `);
        logger.info('✓ Backfilled iot_attendance_events from esp32_presence.');
      }
    } catch (bfIot) {
      logger.warn('Backfill iot_attendance_events note: ' + bfIot.message);
    }

    logger.info('✓ IoT presence, department enrollments & attendance corrections schema verified.');
  } catch (err) {
    logger.error('Error in ensureIotAndCorrectionTables:', { error: err.message });
  }
}

module.exports = {
  ensureIotAndCorrectionTables
};
