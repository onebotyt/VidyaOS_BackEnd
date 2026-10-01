const { query } = require('../src/config/db');

(async () => {
  try {
    const cols = await query('PRAGMA table_info(departments)');
    const colNames = cols.map(c => c.name);

    if (!colNames.includes('is_archived')) {
      await query('ALTER TABLE departments ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0');
      console.log('Added is_archived to departments');
    }
    if (!colNames.includes('archived_at')) {
      await query('ALTER TABLE departments ADD COLUMN archived_at DATETIME');
      console.log('Added archived_at to departments');
    }

    // Also check if admin faculty placeholder exists in teachers
    const adminTeacher = await query('SELECT id FROM teachers WHERE user_id = 1');
    if (!adminTeacher.length) {
      await query(`
        INSERT INTO teachers (user_id, employee_id, full_name, phone)
        VALUES (1, 'ADMIN-INSTITUTION', 'Institutional Administrator', '0000000000')
      `);
      console.log('Created Institutional Administrator teacher record for user_id = 1');
    } else {
      console.log('Institutional Administrator teacher record already exists');
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
})();
