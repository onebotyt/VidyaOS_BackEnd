/**
 * Automated Database Snapshot & Backup Script
 * Creates timestamped snapshots of SQLite database with automated retention policy.
 * 
 * Usage:
 *   node backend/scripts/backup-db.js
 */

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

function getSourceDbPath(overridePath = null) {
  if (overridePath) {
    return path.isAbsolute(overridePath) ? overridePath : path.resolve(process.cwd(), overridePath);
  }
  return process.env.SQLITE_FILE
    ? (path.isAbsolute(process.env.SQLITE_FILE) ? process.env.SQLITE_FILE : path.resolve(__dirname, '../', process.env.SQLITE_FILE))
    : path.resolve(__dirname, '../college_attendance.sqlite');
}

const BACKUP_DIR = path.resolve(__dirname, '../backups');
const MAX_BACKUPS = 30; // Keep max 30 recent snapshots
const MAX_AGE_DAYS = 14; // Keep snapshots up to 14 days

/**
 * Creates an instantaneous database backup snapshot
 */
function createDatabaseBackup(sourceDbPath = null) {
  const dbPath = getSourceDbPath(sourceDbPath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Source database file not found at ${dbPath}`);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);

  const backupFilename = `college_attendance_${timestamp}.sqlite`;
  const backupFilePath = path.join(BACKUP_DIR, backupFilename);

  // Flush WAL journal into main database file before creating snapshot
  try {
    const { DatabaseSync } = require('node:sqlite');
    const syncDb = new DatabaseSync(dbPath);
    syncDb.exec('PRAGMA wal_checkpoint(PASSIVE);');
    syncDb.close();
  } catch (_) {}

  // Copy SQLite database atomically
  fs.copyFileSync(dbPath, backupFilePath);
  const stats = fs.statSync(backupFilePath);
  const sizeKb = Math.round(stats.size / 1024);

  logger.info(`[BACKUP] Snapshot created: ${backupFilename} (${sizeKb} KB)`);

  // Retention cleanup
  pruneOldBackups();

  return {
    success: true,
    filename: backupFilename,
    path: backupFilePath,
    sizeKb,
    timestamp: now.toISOString()
  };
}

/**
 * Prunes backups exceeding retention limits
 */
function pruneOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('college_attendance_') && f.endsWith('.sqlite'))
      .map(f => {
        const fullPath = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          filename: f,
          fullPath,
          ctime: stat.ctimeMs
        };
      })
      .sort((a, b) => b.filename.localeCompare(a.filename)); // newest first based on timestamp ISO format

    const now = Date.now();
    const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    files.forEach((f, idx) => {
      const isTooOld = (now - f.ctime) > maxAgeMs;
      const isExceedingCount = idx >= MAX_BACKUPS;

      if (isTooOld || isExceedingCount) {
        fs.unlinkSync(f.fullPath);
        logger.info(`[BACKUP PRUNE] Removed old snapshot: ${f.filename}`);
      }
    });
  } catch (err) {
    logger.warn('[BACKUP PRUNE] Warning during backup retention cleanup', { error: err.message });
  }
}

// Direct CLI Execution
if (require.main === module) {
  try {
    console.log('Initiating database backup...');
    const res = createDatabaseBackup();
    console.log(`Backup completed successfully: ${res.filename} (${res.sizeKb} KB)`);
  } catch (err) {
    console.error('Backup failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  createDatabaseBackup,
  pruneOldBackups
};
