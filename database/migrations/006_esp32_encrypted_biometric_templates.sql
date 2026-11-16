-- =============================================================================
-- Migration 006: Encrypted ESP32 Biometric Templates, Telemetry & Command Queue
-- Target DBMS: MySQL 8.x / MariaDB (InnoDB)
-- Architecture:
--   1. Slot-Agnostic Cloud Template Vault (student_biometric_templates):
--      Stores portable 512-byte AS608 fingerprint templates directly under
--      student_id so replacing an ESP32 hardware unit requires ZERO student
--      re-registration. Sensor slot numbers are managed exclusively by ESP32
--      in its local W25Q32 SPI Flash.
--   2. Remote Command Queue (esp32_command_queue):
--      Queues remote enrollment, template sync, and buzzer/reboot commands
--      dispatched from the HOD ESP32 Management Portal.
--   3. Hardware Telemetry Columns on devices:
--      Tracks 2S 3.7V battery voltage/percentage, W25Q32 offline queue depth,
--      AS608 local template count, Wi-Fi RSSI, and AES-256 secret key.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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
  INDEX idx_sbt_dept (department_id),
  CONSTRAINT fk_sbt_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  INDEX idx_esp32_cmd_dept (department_id),
  CONSTRAINT fk_esp32_cmd_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
