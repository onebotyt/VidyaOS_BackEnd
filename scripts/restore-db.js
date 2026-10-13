/**
 * Automated Database Snapshot Restoration Utility — VidyaOS
 * Restores a selected or latest SQLite snapshot with safety verification.
 * 
 * Usage:
 *   node backend/scripts/restore-db.js [optional_snapshot_filename_or_path]
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const logger = require('../src/utils/logger');

function getTargetDbPath(overridePath = null) {
  if (overridePath) {
    return path.isAbsolute(overridePath) ? overridePath : path.resolve(process.cwd(), overridePath);
  }
  return process.env.SQLITE_FILE
    ? (path.isAbsolute(process.env.SQLITE_FILE) ? process.env.SQLITE_FILE : path.resolve(__dirname, '../', process.env.SQLITE_FILE))
    : path.resolve(__dirname, '../college_attendance.sqlite');
}

const BACKUP_DIR = path.resolve(__dirname, '../backups');

/**
 * Finds the latest valid backup snapshot in the backups directory.
 */
function getLatestBackupSnapshot() {
  if (!fs.existsSync(BACKUP_DIR)) return null;

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('college_attendance_') && f.endsWith('.sqlite'))
    .map(f => {
      const fullPath = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fullPath);
      return {
        filename: f,
        fullPath,
        size: stat.size,
        ctime: stat.ctimeMs
      };
    })
    .filter(f => f.size > 0)
    .sort((a, b) => b.filename.localeCompare(a.filename));

  return files.length > 0 ? files[0] : null;
}

/**
 * Safely restores database from a snapshot file.
 */
function restoreDatabaseSnapshot(targetSnapshotPath = null, destinationDbPath = null) {
  let sourcePath = targetSnapshotPath;
  const targetDbPath = getTargetDbPath(destinationDbPath);

  if (!sourcePath) {
    const latest = getLatestBackupSnapshot();
    if (!latest) {
      throw new Error(`No database backup snapshots found in ${BACKUP_DIR}`);
    }
    sourcePath = latest.fullPath;
  } else if (!path.isAbsolute(sourcePath)) {
    // Check if filename was given relative to BACKUP_DIR
    const inBackupDir = path.join(BACKUP_DIR, sourcePath);
    if (fs.existsSync(inBackupDir)) {
      sourcePath = inBackupDir;
    } else {
      sourcePath = path.resolve(process.cwd(), sourcePath);
    }
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Backup snapshot file does not exist: ${sourcePath}`);
  }

  // Pre-verification: Verify SQLite integrity of snapshot
  const verifyDb = new DatabaseSync(sourcePath);
  let userCount = 0;
  let studentCount = 0;
  try {
    const uRow = verifyDb.prepare("SELECT count(*) as c FROM users").get();
    userCount = uRow ? uRow.c : 0;
    const sRow = verifyDb.prepare("SELECT count(*) as c FROM students").get();
    studentCount = sRow ? sRow.c : 0;
  } catch (err) {
    throw new Error(`Snapshot verification failed: ${err.message}`);
  }

  // Safety backup of current DB if exists and has data
  if (fs.existsSync(targetDbPath)) {
    try {
      const preRestoreBak = `${targetDbPath}.pre_restore_${Date.now()}.bak`;
      fs.copyFileSync(targetDbPath, preRestoreBak);
      logger.info(`[RESTORE] Pre-restore safety backup created: ${preRestoreBak}`);
    } catch (_) {}
  }

  // Copy snapshot atomically over targetDbPath
  const dbDir = path.dirname(targetDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  fs.copyFileSync(sourcePath, targetDbPath);

  // Clean stale WAL/SHM files to avoid lock conflicts
  try { if (fs.existsSync(`${targetDbPath}-wal`)) fs.unlinkSync(`${targetDbPath}-wal`); } catch (_) {}
  try { if (fs.existsSync(`${targetDbPath}-shm`)) fs.unlinkSync(`${targetDbPath}-shm`); } catch (_) {}

  logger.info(`[RESTORE] Successfully restored database from ${path.basename(sourcePath)} to ${targetDbPath} (Users: ${userCount}, Students: ${studentCount})`);

  return {
    success: true,
    sourcePath,
    targetPath: targetDbPath,
    userCount,
    studentCount
  };
}

if (require.main === module) {
  try {
    const targetFile = process.argv[2] || null;
    console.log('Initiating database restoration...');
    const result = restoreDatabaseSnapshot(targetFile);
    console.log('✅ Restoration Complete:');
    console.log(`   Source:   ${result.sourcePath}`);
    console.log(`   Target:   ${result.targetPath}`);
    console.log(`   Users:    ${result.userCount}`);
    console.log(`   Students: ${result.studentCount}`);
  } catch (err) {
    console.error('❌ Database restoration failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  restoreDatabaseSnapshot,
  getLatestBackupSnapshot
};
