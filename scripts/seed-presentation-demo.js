/**
 * Institutional Demo Seed Runner (MySQL 8.x)
 * Applies database/schema.sql and database/seeds/001_initial_master_data.sql to the configured MySQL database.
 */

const fs = require('fs');
const path = require('path');
const { getPool } = require('../src/config/db');

async function seedPresentationDemo() {
  const pool = getPool();
  const sqlFile = path.resolve(__dirname, '../database/cpanel_production_mysql.sql');
  if (!fs.existsSync(sqlFile)) {
    throw new Error('database/cpanel_production_mysql.sql not found');
  }
  const rawSql = fs.readFileSync(sqlFile, 'utf8');
  const statements = rawSql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    await pool.query(stmt);
  }
  console.log(`[MYSQL DEMO SEED] Executed ${statements.length} MySQL statements from cpanel_production_mysql.sql`);
}

if (require.main === module) {
  seedPresentationDemo()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[MYSQL DEMO SEED ERROR]', err);
      process.exit(1);
    });
}

module.exports = { seed: seedPresentationDemo, seedPresentationDemo };
