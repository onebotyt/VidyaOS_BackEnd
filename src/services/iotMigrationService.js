/**
 * IoT Presence, Encrypted ESP32 Biometric Templates, Command Queue & Telemetry Migration Service (MySQL 8.x)
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

async function getTableCols(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Array.isArray(rows) ? rows.map((r) => r.name || r.COLUMN_NAME) : [];
}

async function safeAddColumn(tableName, existingCols, colName, colDef) {
  if (!existingCols.includes(colName)) {
    try {
      await query(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
    } catch (e) {
      if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(e.message)) {
        logger.warn(`Column migration warning on ${tableName}.${colName}: ${e.message}`);
      }
    }
  }
}

async function ensureIotAndCorrectionTables() {
  try {
    // 1. Ensure telemetry & AES-256 columns exist on devices table
    const devCols = await getTableCols('devices');
    if (devCols.length > 0) {
      await safeAddColumn('devices', devCols, 'secret_key', 'VARCHAR(128) NULL');
      await safeAddColumn('devices', devCols, 'assigned_years', "VARCHAR(50) NULL DEFAULT '1,2,3'");
      await safeAddColumn('devices', devCols, 'assigned_semesters', "VARCHAR(50) NULL DEFAULT '1,2,3,4,5,6'");
      await safeAddColumn('devices', devCols, 'firmware_version', "VARCHAR(50) NULL DEFAULT 'v3.0-AES256-GCM'");
      await safeAddColumn('devices', devCols, 'battery_voltage', 'DECIMAL(5,2) NULL');
      await safeAddColumn('devices', devCols, 'battery_pct', 'INT NULL');
      await safeAddColumn('devices', devCols, 'is_charging', 'TINYINT(1) NOT NULL DEFAULT 0');
      await safeAddColumn('devices', devCols, 'offline_queue_count', 'INT NOT NULL DEFAULT 0');
      await safeAddColumn('devices', devCols, 'w25q32_used_kb', 'INT NOT NULL DEFAULT 0');
      await safeAddColumn('devices', devCols, 'as608_enrolled_count', 'INT NOT NULL DEFAULT 0');
      await safeAddColumn('devices', devCols, 'wifi_rssi', 'INT NULL');
      await safeAddColumn('devices', devCols, 'ip_address', 'VARCHAR(64) NULL');
    }

    // 2. Slot-Agnostic Student Biometric Templates Vault
    await query(`
      CREATE TABLE IF NOT EXISTS student_biometric_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        department_id INT NULL,
        finger_index TINYINT NOT NULL DEFAULT 1,
        template_base64 LONGTEXT NOT NULL,
        template_sha256 VARCHAR(64) NOT NULL,
        quality_score INT NOT NULL DEFAULT 95,
        captured_by_device_uid VARCHAR(100) NULL,
        enrolled_by INT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_finger_template (student_id, finger_index),
        INDEX idx_sbt_student (student_id),
        INDEX idx_sbt_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Remote ESP32 Command Queue (Enrollment, Sync, Buzzer, Flash Clear)
    await query(`
      CREATE TABLE IF NOT EXISTS esp32_command_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        department_id INT NOT NULL,
        command_type VARCHAR(50) NOT NULL,
        student_id INT NULL,
        payload_json LONGTEXT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        result_message VARCHAR(255) NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        INDEX idx_esp32_cmd_device_status (device_id, status),
        INDEX idx_esp32_cmd_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Immutable IoT Attendance Events Log
    await query(`
      CREATE TABLE IF NOT EXISTS iot_attendance_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        device_id INT NOT NULL,
        department_id INT NULL,
        scan_time DATETIME NOT NULL,
        scan_date DATE NULL,
        verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED',
        event_type VARCHAR(50) NOT NULL DEFAULT 'FINGERPRINT',
        payload_json LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_iot_events_student_date (student_id, scan_date),
        INDEX idx_iot_events_device (device_id),
        INDEX idx_iot_events_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Attendance Corrections & Department Enrollments
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
        academic_year_id INT NULL,
        year INT NOT NULL DEFAULT 1,
        semester INT NOT NULL DEFAULT 1,
        class_roll_no INT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sde_student (student_id),
        INDEX idx_sde_dept (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    logger.info('✓ MySQL 8.x Encrypted ESP32 Biometric Templates, Command Queue & IoT Telemetry schema verified.');
  } catch (err) {
    logger.error('Error in ensureIotAndCorrectionTables:', { error: err.message });
  }
}

module.exports = { ensureIotAndCorrectionTables };
