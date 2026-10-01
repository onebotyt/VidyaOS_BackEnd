const { query } = require('../src/config/db');

async function migrate() {
  const dCols = (await query('PRAGMA table_info(departments)')).map(c => c.name);
  if (!dCols.includes('degree_duration_years')) {
    await query("ALTER TABLE departments ADD COLUMN degree_duration_years INTEGER NOT NULL DEFAULT 3");
    console.log('✓ Added degree_duration_years to departments');
  }
  if (!dCols.includes('active_term')) {
    await query("ALTER TABLE departments ADD COLUMN active_term TEXT NOT NULL DEFAULT 'ODD'");
    console.log('✓ Added active_term to departments');
  }

  const sCols = (await query('PRAGMA table_info(students)')).map(c => c.name);
  if (!sCols.includes('fingerprint_template')) {
    await query("ALTER TABLE students ADD COLUMN fingerprint_template TEXT");
    console.log('✓ Added fingerprint_template to students');
  }
  if (!sCols.includes('admission_year')) {
    await query("ALTER TABLE students ADD COLUMN admission_year INTEGER NOT NULL DEFAULT 2024");
    console.log('✓ Added admission_year to students');
  }
  if (!sCols.includes('is_lateral_entry')) {
    await query("ALTER TABLE students ADD COLUMN is_lateral_entry INTEGER NOT NULL DEFAULT 0");
    console.log('✓ Added is_lateral_entry to students');
  }
  console.log('✓ Migration finished successfully.');
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
