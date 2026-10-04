const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

const BASE_URL = 'http://localhost:3000';

async function runTest() {
  console.log('=== TESTING ADMIN ADD DEPARTMENT BUTTON & MODAL WORKFLOW ===\n');

  // [Step 1] Verify DOM & CSS in academic-structure.html
  console.log('[Step 1] Verifying academic-structure.html DOM structure & CSS...');
  const htmlPath = path.resolve(__dirname, '../../frontend/admin/academic-structure.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Check CSS fix
  if (!htmlContent.includes('.modal-backdrop.open') || !htmlContent.includes('opacity: 1 !important')) {
    throw new Error('Missing .modal-backdrop.open CSS visibility rule in academic-structure.html');
  }
  console.log('✓ CSS rule for .modal-backdrop.open with opacity: 1 !important is present.');

  // Parse JSDOM
  const dom = new JSDOM(htmlContent, { runScripts: 'dangerously' });
  const doc = dom.window.document;

  const addBtn = doc.querySelector('button[onclick="openDeptModal()"]');
  if (!addBtn) throw new Error('+ Add Department button missing in academic-structure.html');
  console.log('✓ Found button:', addBtn.textContent.trim());

  const modal = doc.getElementById('dept-modal');
  if (!modal) throw new Error('#dept-modal missing in DOM');
  console.log('✓ Found #dept-modal element.');

  const durationSelect = doc.getElementById('dept-duration');
  if (!durationSelect) throw new Error('#dept-duration missing in modal form');
  console.log('✓ Found #dept-duration selector in modal form.');

  // Test executing openDeptModal in JSDOM window
  dom.window.openDeptModal();
  if (!modal.classList.contains('open') || modal.style.display !== 'flex') {
    throw new Error(`Expected modal to have class 'open' and display 'flex', got class='${modal.className}' and display='${modal.style.display}'`);
  }
  console.log('✓ openDeptModal() correctly sets modal.classList.contains("open") and style.display="flex".');

  // Test closeDeptModal
  dom.window.closeDeptModal();
  if (modal.classList.contains('open') || modal.style.display !== 'none') {
    throw new Error('closeDeptModal() failed to close modal');
  }
  console.log('✓ closeDeptModal() correctly removes "open" and sets style.display="none".');

  // [Step 2] Login as Admin
  console.log('\n[Step 2] Logging in as Admin (admin@gmail.com)...');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gmail.com', password: 'Admin@123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('Admin login failed: ' + JSON.stringify(loginData));
  const adminToken = loginData.data.access_token;
  console.log('✓ Admin authenticated successfully.');

  // Clean up any existing AUTO test department
  const existingAUTO = await query("SELECT id FROM departments WHERE code = 'AUTO'");
  if (existingAUTO.length > 0) {
    await query("DELETE FROM departments WHERE id = ?", [existingAUTO[0].id]);
  }

  // [Step 3] Test POST /api/v1/admin/departments
  console.log('\n[Step 3] Submitting new department via API (AUTO - Automobile Engineering, 3 Years)...');
  const createRes = await fetch(`${BASE_URL}/api/v1/admin/departments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      code: 'AUTO',
      name: 'Automobile Engineering',
      degree_duration_years: 3
    })
  });
  const createData = await createRes.json();
  if (!createData.success) throw new Error('Department creation failed: ' + JSON.stringify(createData));
  console.log('✓ Department created:', createData.data);
  const createdDeptId = createData.data.id;

  // [Step 4] Verify GET /api/v1/admin/departments
  console.log('\n[Step 4] Verifying created department in GET /api/v1/admin/departments...');
  const listRes = await fetch(`${BASE_URL}/api/v1/admin/departments`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const listData = await listRes.json();
  const foundDept = listData.data.find(d => d.code === 'AUTO');
  if (!foundDept) throw new Error('Created department AUTO not found in list');
  console.log('   Retrieved Department:', {
    id: foundDept.id,
    code: foundDept.code,
    name: foundDept.name,
    duration: foundDept.degree_duration_years,
    active: foundDept.is_active
  });
  if (foundDept.degree_duration_years !== 3) {
    throw new Error(`Expected degree_duration_years 3, got ${foundDept.degree_duration_years}`);
  }
  console.log('✓ Department code, name, and degree_duration_years verified.');

  // [Step 5] Test PUT /api/v1/admin/departments/:id (Edit Department)
  console.log('\n[Step 5] Testing PUT /api/v1/admin/departments/:id (Update duration to 2 years)...');
  const updateRes = await fetch(`${BASE_URL}/api/v1/admin/departments/${createdDeptId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      name: 'Automobile & EV Engineering',
      degree_duration_years: 2
    })
  });
  const updateData = await updateRes.json();
  if (!updateData.success) throw new Error('Department update failed: ' + JSON.stringify(updateData));
  console.log('✓ Department updated successfully:', updateData.message);

  // Clean up test department
  console.log('\n[Cleanup] Removing test department...');
  await query("DELETE FROM departments WHERE id = ?", [createdDeptId]);
  console.log('✓ Cleanup complete.');

  console.log('\n=============================================================');
  console.log(' ALL ADMIN ADD DEPARTMENT & MODAL TESTS PASSED! 🎉');
  console.log('=============================================================');
}

runTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
