const BASE_URL = 'http://localhost:3000';

async function testSingleController() {
  console.log('=== VERIFYING SINGLE CONTROLLER FOR DEPARTMENTS ===\n');

  // Login as admin
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const token = (await loginRes.json()).data.access_token;
  console.log('1. Logged in as admin.');

  // Verify POST /branches returns 404
  console.log('2. Testing POST /branches endpoint (should be 404 Not Found)...');
  const postBranchRes = await fetch(`${BASE_URL}/api/v1/admin/branches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: 'Test', code: 'TST', department_id: 1 })
  });
  console.log('   POST /admin/branches status:', postBranchRes.status);
  if (postBranchRes.status !== 404) {
    throw new Error(`Expected 404 for POST /branches, got ${postBranchRes.status}`);
  }
  console.log('   ✓ Separate POST /branches successfully removed!');

  // Verify PUT /branches/:id returns 404
  console.log('3. Testing PUT /branches/:id endpoint (should be 404 Not Found)...');
  const putBranchRes = await fetch(`${BASE_URL}/api/v1/admin/branches/2`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: 'Test' })
  });
  console.log('   PUT /admin/branches/2 status:', putBranchRes.status);
  if (putBranchRes.status !== 404) {
    throw new Error(`Expected 404 for PUT /branches/2, got ${putBranchRes.status}`);
  }
  console.log('   ✓ Separate PUT /branches/:id successfully removed!');

  // Verify single controller POST /departments works
  console.log('4. Testing single controller POST /departments...');
  const testCode = 'SC' + Date.now().toString().slice(-4);
  const testName = 'Single Controller Test Dept';
  const postDeptRes = await fetch(`${BASE_URL}/api/v1/admin/departments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: testName, code: testCode })
  });
  const postDeptData = await postDeptRes.json();
  console.log('   POST /departments response:', postDeptData);
  if (!postDeptData.success) {
    throw new Error('Failed to create department via single controller!');
  }
  const newDeptId = postDeptData.data.id;
  console.log(`   ✓ Department created with ID ${newDeptId} and code ${testCode}`);

  // Verify single controller PUT /departments/:id works
  console.log('5. Testing single controller PUT /departments/:id...');
  const updatedName = 'Updated Single Controller Dept';
  const putDeptRes = await fetch(`${BASE_URL}/api/v1/admin/departments/${newDeptId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: updatedName, code: testCode, is_active: true })
  });
  const putDeptData = await putDeptRes.json();
  console.log('   PUT /departments response:', putDeptData);
  if (!putDeptData.success) {
    throw new Error('Failed to update department via single controller!');
  }
  console.log('   ✓ Department updated successfully via single controller');

  // Cleanup test record
  const { query } = require('../src/config/db');
  await query(`DELETE FROM branches WHERE department_id = ?`, [newDeptId]);
  await query(`DELETE FROM departments WHERE id = ?`, [newDeptId]);
  console.log('6. Cleaned up test record.');

  console.log('\n=============================================');
  console.log('SINGLE CONTROLLER FOR DEPARTMENTS VERIFIED! 🚀');
  console.log('=============================================');
}

testSingleController().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
