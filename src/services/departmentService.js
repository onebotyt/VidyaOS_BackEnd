/**
 * Department Service & Master Institutional Seeder
 * 
 * Manages institutional academic departments and ensures standard hardcoded
 * college departments (Electronics, Electrical, IT, Mechanical, Civil, Pharmacy)
 * are always seeded and available in SQLite/MySQL.
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

const HARDCODED_DEPARTMENTS = [
  { code: 'ECE', name: 'Electronics Engineering', degree_duration_years: 3, branch_code: 'ECE', branch_name: 'Electronics Engineering' },
  { code: 'EE', name: 'Electrical Engineering', degree_duration_years: 3, branch_code: 'EE', branch_name: 'Electrical Engineering' },
  { code: 'IT', name: 'Information Technology', degree_duration_years: 3, branch_code: 'IT', branch_name: 'Information Technology' },
  { code: 'ME', name: 'Mechanical Engineering', degree_duration_years: 3, branch_code: 'ME', branch_name: 'Mechanical Engineering' },
  { code: 'CE', name: 'Civil Engineering', degree_duration_years: 3, branch_code: 'CE', branch_name: 'Civil Engineering' },
  { code: 'PHARM', name: 'Pharmacy', degree_duration_years: 2, branch_code: 'DPHARM', branch_name: 'Diploma in Pharmacy' }
];

/**
 * Ensures all standard hardcoded departments and branches exist.
 */
async function ensureHardcodedDepartments() {
  try {
    for (const d of HARDCODED_DEPARTMENTS) {
      const existing = await query('SELECT id FROM departments WHERE code = ?', [d.code]);
      let deptId;
      if (!existing || !existing.length) {
        const res = await query(
          'INSERT INTO departments (name, code, is_active, degree_duration_years) VALUES (?, ?, 1, ?)',
          [d.name, d.code, d.degree_duration_years]
        );
        deptId = res[0]?.insertId ?? res.lastInsertRowid;
        logger.info(`Auto-seeded institutional department: ${d.name} (${d.code})`);
      } else {
        deptId = existing[0].id;
        // Keep name and duration aligned
        await query(
          'UPDATE departments SET name = ?, degree_duration_years = ? WHERE id = ?',
          [d.name, d.degree_duration_years, deptId]
        );
      }
    }
  } catch (err) {
    logger.error('Failed to ensure hardcoded departments:', { error: err.message });
  }
}

const HARDCODED_CODES = ['CE', 'EE', 'ECE', 'IT', 'ME', 'PHARM'];

function isHardcodedDepartment(code) {
  if (!code) return false;
  return HARDCODED_CODES.includes(String(code).toUpperCase().trim());
}

module.exports = {
  HARDCODED_DEPARTMENTS,
  HARDCODED_CODES,
  isHardcodedDepartment,
  ensureHardcodedDepartments
};
