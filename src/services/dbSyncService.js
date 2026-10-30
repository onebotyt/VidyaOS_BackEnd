/**
 * Database Persistence & Automated Snapshot Service — VidyaOS
 * Location: /src/services/dbSyncService.js
 * 
 * Protects database integrity across server updates, container redeploys, and host restarts:
 * 1. Takes pre-shutdown snapshots on SIGTERM / SIGINT so recent registrations and attendance are captured.
 * 2. Uploads snapshots to Cloud Persistence (GitHub Gist / Remote Storage) if configured.
 * 3. Runs periodic snapshot intervals (every 10 minutes).
 * 4. Supports automated startup restoration if the container starts with a missing or empty SQLite file.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getResolvedDatabasePath } = require('../config/dbPath');
const { createDatabaseBackup } = require('../../scripts/backup-db');
const { restoreDatabaseSnapshot, getLatestBackupSnapshot } = require('../../scripts/restore-db');
const CloudStorageService = require('./cloudStorageService');

let backupInterval = null;

/**
 * Initializes database persistence guards, cloud restore, and automated backup cycles.
 */
async function initDatabasePersistence() {
  const dbPath = getResolvedDatabasePath();

  // 1. Check if database file is missing or 0 bytes
  try {
    const isMissing = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0;
    if (isMissing) {
      // A. Try Cloud Persistence first (GitHub Gist or Remote URL)
      try {
        const cloudRestored = await CloudStorageService.restoreSnapshot(dbPath);
        if (cloudRestored && cloudRestored.success) {
          logger.info(`[PERSISTENCE] Database restored from Cloud Storage: ${cloudRestored.source} (${cloudRestored.sizeKb} KB).`);
          return;
        }
      } catch (cloudErr) {
        logger.warn(`[PERSISTENCE] Cloud snapshot restore bypassed: ${cloudErr.message}`);
      }

      // B. Fall back to newest local backup snapshot
      const latestBackup = getLatestBackupSnapshot();
      if (latestBackup && latestBackup.size > 0) {
        logger.info(`[PERSISTENCE] Target database is empty/missing. Auto-restoring latest local snapshot: ${latestBackup.filename}`);
        restoreDatabaseSnapshot(latestBackup.fullPath);
      }
    }
  } catch (err) {
    logger.warn(`[PERSISTENCE] Snapshot auto-restore check bypassed: ${err.message}`);
  }

  // 2. Periodic Automated Snapshot & Cloud Sync Cycle (every 10 minutes)
  if (!backupInterval) {
    backupInterval = setInterval(async () => {
      try {
        if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
          createDatabaseBackup();
          await CloudStorageService.uploadSnapshot(dbPath);
        }
      } catch (err) {
        logger.warn(`[PERSISTENCE] Periodic backup snapshot warning: ${err.message}`);
      }
    }, 10 * 60 * 1000);

    // Don't keep Node process alive solely for backup interval
    if (backupInterval.unref) {
      backupInterval.unref();
    }
  }
}

/**
 * Creates an instantaneous safety snapshot and cloud sync before graceful process termination.
 */
async function capturePreShutdownSnapshot() {
  try {
    const dbPath = getResolvedDatabasePath();

    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
      const res = createDatabaseBackup();
      logger.info(`[PERSISTENCE] Pre-shutdown snapshot saved locally: ${res.filename}`);

      // Sync to cloud storage before container terminates
      await CloudStorageService.uploadSnapshot(dbPath);
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
