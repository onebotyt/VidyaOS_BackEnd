const { query } = require('../src/config/db');

async function run() {
  console.log('=== Normalizing Departments & Branches into Single Unified Entity ===');

  // 1. Delete unused duplicate branches (1 and 3) which have 0 foreign key references
  await query(`DELETE FROM branches WHERE id IN (1, 3)`);
  console.log('Deleted legacy unused branch IDs 1 and 3.');

  // 2. Normalize existing active branches to match their parent department 1-to-1
  const depts = await query(`SELECT * FROM departments`);
  console.log(`Found ${depts.length} departments:`);

  for (const d of depts) {
    // Find matching branch
    const branches = await query(`SELECT * FROM branches WHERE department_id = ?`, [d.id]);
    if (branches.length > 0) {
      // Update first branch to have identical name and code as department
      const mainBranch = branches[0];
      await query(
        `UPDATE branches SET name = ?, code = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [d.name, d.code, d.is_active, mainBranch.id]
      );
      console.log(`Updated Branch ID ${mainBranch.id} to match Dept ${d.id} (${d.code} - ${d.name})`);

      // If there are extra branches for this department, delete them if unreferenced
      for (let i = 1; i < branches.length; i++) {
        const extra = branches[i];
        try {
          await query(`DELETE FROM branches WHERE id = ?`, [extra.id]);
          console.log(`Deleted redundant extra branch ID ${extra.id}`);
        } catch (e) {
          console.warn(`Could not delete branch ID ${extra.id}:`, e.message);
        }
      }
    } else {
      // No branch exists for this department, create 1-to-1 branch
      const res = await query(
        `INSERT INTO branches (department_id, name, code, is_active) VALUES (?, ?, ?, ?)`,
        [d.id, d.name, d.code, d.is_active]
      );
      const newId = res[0]?.insertId ?? res.lastInsertRowid;
      console.log(`Created new matching Branch ID ${newId} for Dept ${d.id} (${d.code} - ${d.name})`);
    }
  }

  // 3. Verify final state
  const finalDepts = await query(`SELECT id, code, name, is_active, hod_user_id FROM departments ORDER BY id`);
  const finalBranches = await query(`SELECT id, department_id, code, name, is_active FROM branches ORDER BY id`);

  console.log('\n--- Final Departments ---');
  console.table(finalDepts);

  console.log('\n--- Final Branches (1-to-1 Unified) ---');
  console.table(finalBranches);

  console.log('\nNormalization completed successfully!');
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
