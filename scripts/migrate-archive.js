/**
 * Migration: Add graduation_year to students table for Alumni Archive
 */

const { query } = require('../src/config/db');

async function migrate() {
  console.log('=== RUNNING ARCHIVE SCHEMA MIGRATION ===');
  try {
    const studentCols = await query(`PRAGMA table_info(students)`);
    const hasGradYear = studentCols.some(c => c.name === 'graduation_year');
    if (!hasGradYear) {
      console.log('Adding graduation_year to students table...');
      await query(`ALTER TABLE students ADD COLUMN graduation_year INTEGER`);
      console.log('✓ Added graduation_year column.');
    } else {
      console.log('✓ graduation_year already exists in students table.');
    }

    console.log('=== MIGRATION COMPLETE ===');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
