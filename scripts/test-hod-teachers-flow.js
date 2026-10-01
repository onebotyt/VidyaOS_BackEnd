const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('=== STARTING HOD TEACHER & PASSWORD MANAGEMENT TESTS ===\n');

  // 1. Login as HOD
  const hodLoginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const hodLogin = await hodLoginRes.json();
  if (!hodLogin.success) throw new Error('HOD login failed: ' + JSON.stringify(hodLogin));
  console.log('✓ 1. HOD Logged in successfully.');
  const hodToken = hodLogin.data.access_token;
  const hodUserId = hodLogin.data.user.id;

  // 2. Fetch teachers list
  const teachersRes = await fetch(`${BASE_URL}/api/v1/hod/teachers`, {
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const teachersData = await teachersRes.json();
  if (!teachersData.success) throw new Error('Failed to get teachers: ' + JSON.stringify(teachersData));
  console.log(`✓ 2. Retrieved ${teachersData.data.length} department teachers.`);
  
  const hodTeacherRecord = teachersData.data.find(t => t.user_id === hodUserId);
  if (!hodTeacherRecord) throw new Error('Could not find HOD in department teachers list');
  console.log(`✓ 3. Found HOD teacher record: ID=${hodTeacherRecord.id}, Name="${hodTeacherRecord.full_name}".`);

  // 3. Test: HOD CANNOT reset their own password via teacher reset endpoint
  const selfResetRes = await fetch(`${BASE_URL}/api/v1/hod/teachers/${hodTeacherRecord.id}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ new_password: 'ShouldFailPassword@123' })
  });
  const selfReset = await selfResetRes.json();
  if (selfResetRes.status === 403 && !selfReset.success) {
    console.log('✓ 4. Correctly rejected HOD self-reset on teacher card (HTTP 403 Forbidden):', selfReset.error.message);
  } else {
    throw new Error('Expected 403 when HOD resets own password via teacher card, got: ' + JSON.stringify(selfReset));
  }

  // 4. Test: HOD creates new teacher with custom password
  const testEmail = `testteacher_${Date.now()}@gmail.com`;
  const customPass = 'TeacherCustomPass@123';
  const createRes = await fetch(`${BASE_URL}/api/v1/hod/teachers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({
      full_name: 'Prof. Test Instructor',
      email: testEmail,
      password: customPass
    })
  });
  const createData = await createRes.json();
  if (!createData.success) throw new Error('Failed to create teacher: ' + JSON.stringify(createData));
  const newTeacherId = createData.data.teacher_id;
  console.log(`✓ 5. Created teacher "${testEmail}" (ID: ${newTeacherId}) with custom active password.`);

  // 5. Test: New teacher logs in immediately with custom password without forced reset
  const tLoginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: customPass })
  });
  const tLogin = await tLoginRes.json();
  if (!tLogin.success || tLogin.data?.must_change_password) {
    throw new Error('New teacher failed to log in directly: ' + JSON.stringify(tLogin));
  }
  console.log('✓ 6. New teacher logged in directly with the password provided (must_change_password is false).');

  // 6. Test: HOD resets new teacher password
  const newResetPass = 'BrandNewSecret@789';
  const resetRes = await fetch(`${BASE_URL}/api/v1/hod/teachers/${newTeacherId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hodToken}` },
    body: JSON.stringify({ new_password: newResetPass })
  });
  const resetData = await resetRes.json();
  if (!resetData.success) throw new Error('Failed to reset teacher password: ' + JSON.stringify(resetData));
  console.log('✓ 7. HOD successfully reset teacher password:', resetData.message);

  // 7. Test: Teacher logs in with new password
  const tLogin2Res = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: newResetPass })
  });
  const tLogin2 = await tLogin2Res.json();
  if (!tLogin2.success || tLogin2.data?.must_change_password) {
    throw new Error('Teacher failed to log in with new reset password: ' + JSON.stringify(tLogin2));
  }
  console.log('✓ 8. Teacher logged in directly with new reset password.');

  // 8. Test: Delete teacher
  const delRes = await fetch(`${BASE_URL}/api/v1/hod/teachers/${newTeacherId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${hodToken}` }
  });
  const delData = await delRes.json();
  if (!delData.success) throw new Error('Failed to delete teacher: ' + JSON.stringify(delData));
  console.log('✓ 9. HOD successfully deleted teacher account.');

  // 9. DOM & Modal Verification in JSDOM
  console.log('\n--- VERIFYING DOM & MODALS IN JSDOM ---');
  const htmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-teachers.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/faculty/hod-teachers.html',
    runScripts: 'dangerously'
  });

  const { window } = dom;

  // Mock localStorage and auth
  window.localStorage.setItem('access_token', hodToken);
  window.localStorage.setItem('user', JSON.stringify(hodLogin.data.user));

  // Verify Self Modal is completely removed
  const selfModal = window.document.getElementById('self-modal');
  if (selfModal !== null) throw new Error('self-modal was expected to be removed, but still found in DOM');
  console.log('✓ 10. "#self-modal" is completely removed from DOM.');

  // Test openCreateModal
  if (typeof window.openCreateModal !== 'function') throw new Error('openCreateModal is not a function');
  window.openCreateModal();
  const createModal = window.document.getElementById('create-modal');
  if (createModal.style.display !== 'flex' || !createModal.classList.contains('open')) throw new Error('create-modal is not visible or lacks .open class');
  console.log('✓ 11. openCreateModal() opens "#create-modal" with display: flex AND .open class.');

  // Test openDeleteModal
  if (typeof window.openDeleteModal !== 'function') throw new Error('openDeleteModal is not a function');
  window.openDeleteModal(42, 'Prof. Sharma');
  const delModal = window.document.getElementById('delete-modal');
  if (delModal.style.display !== 'flex' || !delModal.classList.contains('open')) throw new Error('delete-modal is not visible or lacks .open class');
  if (window.document.getElementById('del-name').textContent !== 'Prof. Sharma') throw new Error('del-name textContent mismatch');
  console.log('✓ 12. openDeleteModal() opens "#delete-modal" with display: flex, .open class, and teacher name.');

  // Test openResetModal
  if (typeof window.openResetModal !== 'function') throw new Error('openResetModal is not a function');
  window.openResetModal(42, 'Prof. Sharma');
  const resetModal = window.document.getElementById('reset-modal');
  if (resetModal.style.display !== 'flex' || !resetModal.classList.contains('open')) throw new Error('reset-modal is not visible or lacks .open class');
  if (window.document.getElementById('reset-name').textContent !== 'Prof. Sharma') throw new Error('reset-name textContent mismatch');
  console.log('✓ 13. openResetModal() opens "#reset-modal" with display: flex, .open class, and teacher name.');

  // Test openReassignModal
  if (typeof window.openReassignModal !== 'function') throw new Error('openReassignModal is not a function');
  window.openReassignModal(42, 'Prof. Sharma');
  const reassignModal = window.document.getElementById('reassign-modal');
  if (reassignModal.style.display !== 'flex' || !reassignModal.classList.contains('open')) throw new Error('reassign-modal is not visible or lacks .open class');
  if (window.document.getElementById('reassign-name').textContent !== 'Prof. Sharma') throw new Error('reassign-name textContent mismatch');
  console.log('✓ 14. openReassignModal() opens "#reassign-modal" with display: flex, .open class, and teacher name.');

  console.log('\n=== ALL HOD TEACHER & PASSWORD MANAGEMENT TESTS PASSED 100%! ===');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
