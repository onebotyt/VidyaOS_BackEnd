/**
 * Centralized Database Path Resolver — VidyaOS
 * Location: /src/config/dbPath.js
 * 
 * Accurately determines the authoritative SQLite database path across environments:
 * 1. Explicit SQLITE_FILE environment variable (absolute or relative)
 * 2. Render / Docker persistent disk mount paths (/var/data, /data)
 * 3. Default repository root (college_attendance.sqlite)
 */

const path = require('path');
const fs = require('fs');

function getResolvedDatabasePath(overridePath = null) {
  if (overridePath) {
    return path.isAbsolute(overridePath) ? overridePath : path.resolve(process.cwd(), overridePath);
  }

  // 1. Explicit environment variable
  if (process.env.SQLITE_FILE) {
    return path.isAbsolute(process.env.SQLITE_FILE)
      ? process.env.SQLITE_FILE
      : path.resolve(__dirname, '../../', process.env.SQLITE_FILE);
  }

  // 2. Render / Cloud Persistent Disks
  if (fs.existsSync('/var/data')) {
    return '/var/data/college_attendance.sqlite';
  }
  if (fs.existsSync('/data')) {
    return '/data/college_attendance.sqlite';
  }

  // 3. Default root database file
  return path.resolve(__dirname, '../../college_attendance.sqlite');
}

module.exports = {
  getResolvedDatabasePath
};

