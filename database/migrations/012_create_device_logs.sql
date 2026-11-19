-- 012_create_device_logs.sql
-- Remote Cloud Diagnostics & System Logs for ESP32 Nodes over the Internet

CREATE TABLE IF NOT EXISTS device_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  device_uid VARCHAR(64) NOT NULL,
  log_level VARCHAR(16) DEFAULT 'INFO',
  tag VARCHAR(32) DEFAULT 'SYSTEM',
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_device_id_created (device_id, created_at),
  INDEX idx_device_uid_created (device_uid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
