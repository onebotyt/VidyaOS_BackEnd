/**
 * System Administrator Environment Bootstrapping Service
 * 
 * Enables zero-touch initial administrator onboarding on cloud deployments (Render/Vercel/Docker):
 * 1. On server boot, checks if ADMIN_EMAIL and ADMIN_PASSWORD environment variables are defined.
 * 2. If present, provisions or updates the initial administrator account in the database.
 * 3. Supports subsequent administrator creation directly in the web UI.
 * 4. Once a permanent administrator is created in the database, the user can safely remove
 *    the ADMIN_EMAIL / ADMIN_PASSWORD variables from the Render environment.
 */

const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const logger = require('../utils/logger');

class AdminBootstrapService {
  /**
   * Run administrator bootstrapping sequence
   * Dual-mode compatible (SQLite & MySQL)
   */
  static async bootstrap() {
    const envEmail = (process.env.ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    const envPassword = (process.env.ADMIN_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '').trim();
    const envName = (process.env.ADMIN_NAME || 'System Administrator').trim();

    try {
      // 1. If environment credentials are provided, upsert the admin account
      if (envEmail && envPassword) {
        logger.info(`[BOOTSTRAP] Synchronizing administrator from environment: ${envEmail}`);

        const existingUsers = await query(
          `SELECT id, username, email, password_hash, status FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?`,
          [envEmail, envEmail]
        );

        const passwordHash = await bcrypt.hash(envPassword, 10);

        if (existingUsers && existingUsers.length > 0) {
          const user = existingUsers[0];
          await query(
            `UPDATE users SET password_hash = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [passwordHash, user.id]
          );

          // Ensure SYSTEM_ADMIN role
          const roles = await query(
            `SELECT role FROM user_roles WHERE user_id = ? AND role = 'SYSTEM_ADMIN'`,
            [user.id]
          );
          if (!roles || roles.length === 0) {
            await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`, [user.id]);
          }

          // Ensure teacher profile exists
          const teacherProfiles = await query(`SELECT id FROM teachers WHERE user_id = ?`, [user.id]);
          if (!teacherProfiles || teacherProfiles.length === 0) {
            const depts = await query(`SELECT id FROM departments ORDER BY id ASC LIMIT 1`);
            const deptId = (depts && depts.length > 0) ? depts[0].id : 1;
            await query(
              `INSERT INTO teachers (user_id, department_id, full_name, employee_id, phone) VALUES (?, ?, ?, 'ADMIN-ENV', '0000000000')`,
              [user.id, deptId, envName]
            );
          }

          logger.info(`[BOOTSTRAP] Administrator credentials updated from environment: ${envEmail}`);
          return { success: true, action: 'UPDATED', email: envEmail, userId: user.id };
        } else {
          // Create new administrator user
          const insertResult = await query(
            `INSERT INTO users (username, email, password_hash, must_change_password, status) VALUES (?, ?, ?, 0, 'ACTIVE')`,
            [envEmail, envEmail, passwordHash]
          );

          const newUserId = insertResult.insertId || insertResult.lastID || (
            await query(`SELECT id FROM users WHERE LOWER(email) = ?`, [envEmail])
          )[0]?.id;

          if (newUserId) {
            await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`, [newUserId]);

            const depts = await query(`SELECT id FROM departments ORDER BY id ASC LIMIT 1`);
            const deptId = (depts && depts.length > 0) ? depts[0].id : 1;
            await query(
              `INSERT INTO teachers (user_id, department_id, full_name, employee_id, phone) VALUES (?, ?, ?, 'ADMIN-ENV', '0000000000')`,
              [newUserId, deptId, envName]
            );
          }

          logger.info(`[BOOTSTRAP] Initial Administrator successfully provisioned from environment: ${envEmail}`);
          return { success: true, action: 'CREATED', email: envEmail, userId: newUserId };
        }
      }

      // 2. If no environment credentials, check if any administrators exist
      const existingAdmins = await query(
        `SELECT u.id, u.email, u.status 
         FROM users u
         JOIN user_roles ur ON u.id = ur.user_id
         WHERE ur.role = 'SYSTEM_ADMIN' AND u.status = 'ACTIVE'`
      );

      if (existingAdmins && existingAdmins.length > 0) {
        logger.info(`[BOOTSTRAP] Found ${existingAdmins.length} active database administrator(s). Preserving existing database logins.`);
        return { success: true, action: 'PRESERVED', count: existingAdmins.length };
      }

      // 3. Resilient Fallback: If 0 administrators exist anywhere in the database,
      // provision a safe emergency administrator so the institution is NEVER locked out!
      const fallbackEmail = process.env.ADMIN_FALLBACK_EMAIL || 'admin@college.edu';
      const fallbackPassword = process.env.ADMIN_FALLBACK_PASSWORD || 'Admin@VidyaOS2026!';
      const fallbackHash = await bcrypt.hash(fallbackPassword, 10);

      logger.warn('════════════════════════════════════════════════════════════════════════');
      logger.warn('🏛️  [ADMINISTRATOR AUTO-PROVISION NOTICE]');
      logger.warn(`    Zero active administrators detected in database.`);
      logger.warn(`    Provisioned recovery administrator: ${fallbackEmail}`);
      logger.warn(`    Password: ${fallbackPassword}`);
      logger.warn('    Please log in immediately and set your desired permanent credentials.');
      logger.warn('════════════════════════════════════════════════════════════════════════');

      const recoveryInsert = await query(
        `INSERT INTO users (username, email, password_hash, must_change_password, status) VALUES (?, ?, ?, 0, 'ACTIVE')`,
        [fallbackEmail, fallbackEmail, fallbackHash]
      );
      const recoveryId = recoveryInsert.insertId || recoveryInsert.lastID || (
        await query(`SELECT id FROM users WHERE LOWER(email) = ?`, [fallbackEmail])
      )[0]?.id || 1;

      await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`, [recoveryId]);
      
      const depts = await query(`SELECT id FROM departments ORDER BY id ASC LIMIT 1`);
      const deptId = (depts && depts.length > 0) ? depts[0].id : 1;
      await query(
        `INSERT INTO teachers (user_id, department_id, full_name, employee_id, phone) VALUES (?, ?, 'Recovery Administrator', 'ADMIN-RECOVERY', '0000000000')`,
        [recoveryId, deptId]
      );
      return { success: true, action: 'RECOVERY_ADMIN_CREATED', email: fallbackEmail };
    } catch (err) {
      logger.error(`[BOOTSTRAP ERROR] Administrator bootstrapping failed: ${err.message}`, { stack: err.stack });
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if an email is the active environment administrator
   */
  static isEnvAdmin(email) {
    if (!email) return false;
    const envEmail = (process.env.ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    return Boolean(envEmail && envEmail === email.trim().toLowerCase());
  }
}

module.exports = AdminBootstrapService;

