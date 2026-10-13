/**
 * Database Persistence & Automated Snapshot Service — VidyaOS
 * 
 * Protects database integrity across server updates, container redeploys, and host restarts:
 * 1. Takes pre-shutdown snapshots on SIGTERM / SIGINT so recent registrations and attendance are captured.
 * 2. Runs periodic snapshot intervals (every 30 minutes).
 * 3. Supports automated startup restoration if the container starts with a missing or empty SQLite file.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { createDatabaseBackup } = require('../../scripts/backup-db');
const { restoreDatabaseSnapshot, getLatestBackupSnapshot } = require('../../scripts/restore-db');

let backupInterval = null;

/**
 * Initializes database persistence guards and automated backup cycles.
 */
function initDatabasePersistence() {
  const dbPath = process.env.SQLITE_FILE
    ? (path.isAbsolute(process.env.SQLITE_FILE) ? process.env.SQLITE_FILE : path.resolve(__dirname, '../../', process.env.SQLITE_FILE))
    : path.resolve(__dirname, '../../college_attendance.sqlite');

  // Check if database file is missing or 0 bytes, and restore from newest backup if available
  try {
    const isMissing = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0;
    if (isMissing) {
      const latestBackup = getLatestBackupSnapshot();
      if (latestBackup && latestBackup.size > 0) {
        logger.info(`[PERSISTENCE] Target database is empty/missing. Auto-restoring latest snapshot: ${latestBackup.filename}`);
        restoreDatabaseSnapshot(latestBackup.fullPath);
      }
    }
  } catch (err) {
    logger.warn(`[PERSISTENCE] Snapshot auto-restore check bypassed: ${err.message}`);
  }

  // Periodic Automated Snapshot Cycle (every 30 minutes)
  if (!backupInterval) {
    backupInterval = setInterval(() => {
      try {
        if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
          createDatabaseBackup();
        }
      } catch (err) {
        logger.warn(`[PERSISTENCE] Periodic backup snapshot warning: ${err.message}`);
      }
    }, 30 * 60 * 1000);

    // Don't keep Node process alive solely for backup interval
    if (backupInterval.unref) {
      backupInterval.unref();
    }
  }
}

/**
 * Creates an instantaneous safety snapshot before graceful process termination.
 */
function capturePreShutdownSnapshot() {
  try {
    const dbPath = process.env.SQLITE_FILE
      ? (path.isAbsolute(process.env.SQLITE_FILE) ? process.env.SQLITE_FILE : path.resolve(__dirname, '../../', process.env.SQLITE_FILE))
      : path.resolve(__dirname, '../../college_attendance.sqlite');

    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
      const res = createDatabaseBackup();
      logger.info(`[PERSISTENCE] Pre-shutdown snapshot saved: ${res.filename}`);
      return res;
    }
  } catch (err) {
    logger.warn(`[PERSISTENCE] Pre-shutdown snapshot warning: ${err.message}`);
  }
  return null;
}

module.exports = {
  initDatabasePersistence,
  capturePreShutdownSnapshot
};
