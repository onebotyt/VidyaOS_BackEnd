/**
 * Production Clean Seed Script (MySQL 8.x)
 * Seeds standard institutional departments, active academic year, and 1 System Administrator.
 */

const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../src/config/db');
const { HARDCODED_DEPARTMENTS } = require('../src/services/departmentService');

async function seedProductionClean() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
  const adminPass = (process.env.ADMIN_PASSWORD || 'Admin@123').trim();
  const adminHash = await bcrypt.hash(adminPass, 10);

  await withTransaction(async (conn) => {
    for (const d of HARDCODED_DEPARTMENTS) {
      await conn.execute(
        `INSERT INTO departments (name, code, is_active, degree_duration_years)
         VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), degree_duration_years = VALUES(degree_duration_years)`,
        [d.name, d.code, d.degree_duration_years]
      );
    }

    await conn.execute(
      `INSERT INTO academic_years (label, start_date, end_date, is_current)
       VALUES ('2026-27', '2026-07-01', '2027-06-30', 1)
       ON DUPLICATE KEY UPDATE is_current = 1`
    );

    await conn.execute(
      `INSERT INTO users (username, email, password_hash, must_change_password, status)
       VALUES (?, ?, ?, 0, 'ACTIVE')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), status = 'ACTIVE'`,
      [adminEmail, adminEmail, adminHash]
    );

    const [uRows] = await conn.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [adminEmail]);
    const adminId = uRows[0]?.id;
    if (adminId) {
      await conn.execute(
        `INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`,
        [adminId]
      );
    }
  });

  console.log(`[MYSQL SEED] Clean production seed completed for administrator: ${adminEmail}`);
}

if (require.main === module) {
  seedProductionClean()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[MYSQL SEED ERROR]', err);
      process.exit(1);
    });
}

module.exports = { seedProductionClean };
