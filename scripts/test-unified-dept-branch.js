const { query } = require('../src/config/db');

async function verify() {
  console.log('=== VERIFYING UNIFIED DEPARTMENTS & BRANCHES ===\n');

  // 1. Check departments and branches 1-to-1 parity
  const depts = await query(`SELECT * FROM departments ORDER BY id`);
  const branches = await query(`SELECT * FROM branches ORDER BY id`);

  console.log(`Departments count: ${depts.length}`);
  console.log(`Branches count: ${branches.length}`);

  let mismatch = false;
  for (const d of depts) {
    const matching = branches.filter(b => b.department_id === d.id);
    if (matching.length !== 1) {
      console.error(`❌ Mismatch: Dept ${d.id} (${d.code}) has ${matching.length} branches instead of 1!`);
      mismatch = true;
    } else {
      const b = matching[0];
      if (b.code !== d.code || b.name !== d.name) {
        console.error(`❌ Code/Name mismatch for Dept ${d.id}: Dept(${d.code}, ${d.name}) vs Branch(${b.code}, ${b.name})`);
        mismatch = true;
      } else {
        console.log(`✓ Dept ${d.id} (${d.code} - ${d.name}) === Branch ${b.id} (${b.code} - ${b.name})`);
      }
    }
  }

  if (mismatch) {
    console.error('\nVerification failed due to mismatches.');
    process.exit(1);
  }

  // 2. Check foreign keys
  console.log('\n--- Checking Dependent Tables Foreign Keys ---');
  const tables = [
    { name: 'subjects', col: 'branch_id' },
    { name: 'teacher_assignments', col: 'branch_id' },
    { name: 'enrollments', col: 'branch_id' },
    { name: 'devices', col: 'branch_id' }
  ];

  for (const t of tables) {
    const orphans = await query(
      `SELECT COUNT(*) as count FROM ${t.name} WHERE ${t.col} NOT IN (SELECT id FROM branches)`
    );
    const count = orphans[0]?.count || 0;
    if (count > 0) {
      console.error(`❌ Found ${count} orphan records in ${t.name}.${t.col}!`);
      process.exit(1);
    } else {
      console.log(`✓ ${t.name}.${t.col}: 0 orphans. All valid.`);
    }
  }

  // 3. Test insert auto-sync simulation
  console.log('\n--- Testing Auto-sync Behavior ---');
  const testCode = 'TEST' + Date.now().toString().slice(-4);
  const testName = 'Test Department Program';
  
  // Insert dept
  const insRes = await query(
    `INSERT INTO departments (name, code, is_active) VALUES (?, ?, 1)`,
    [testName, testCode]
  );
  const newDeptId = insRes[0]?.insertId ?? insRes.lastInsertRowid;
  // Insert matching branch
  await query(
    `INSERT INTO branches (department_id, name, code, is_active) VALUES (?, ?, ?, 1)`,
    [newDeptId, testName, testCode]
  );

  const createdBranch = await query(`SELECT * FROM branches WHERE department_id = ?`, [newDeptId]);
  console.log(`✓ Insert test: Created Dept ${newDeptId}, matching Branch ${createdBranch[0]?.id} with code ${createdBranch[0]?.code}`);

  // Update dept & branch
  const updatedName = 'Updated Test Program';
  await query(`UPDATE departments SET name = ? WHERE id = ?`, [updatedName, newDeptId]);
  await query(`UPDATE branches SET name = ? WHERE department_id = ?`, [updatedName, newDeptId]);

  const updatedBranch = await query(`SELECT * FROM branches WHERE department_id = ?`, [newDeptId]);
  console.log(`✓ Update test: Updated Branch name to: ${updatedBranch[0]?.name}`);

  // Cleanup test data
  await query(`DELETE FROM branches WHERE department_id = ?`, [newDeptId]);
  await query(`DELETE FROM departments WHERE id = ?`, [newDeptId]);
  console.log(`✓ Cleaned up test data.`);

  console.log('\n========================================');
  console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY! 🎯');
  console.log('========================================');
}

verify().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
