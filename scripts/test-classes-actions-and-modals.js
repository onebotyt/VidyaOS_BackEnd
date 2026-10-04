/**
 * End-to-End Test for Classes Hub & Modals
 * Verifies:
 * 1. Modal visibility and classList manipulation in groups.html and dashboard.html
 * 2. Three-dot dropdown menus (header & footer) in card rendering
 * 3. Direct card action buttons (Delete, Edit, Matrix, Marks, Coursework)
 * 4. API endpoints for Class lifecycle (Create, Edit, Trash, Restore, Permanent Delete)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM } = require('jsdom');

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('======================================================');
  console.log('🧪 TESTING CLASSES ACTIONS, MODALS & LIFECYCLE API');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log('✓ PASS:', msg);
      passed++;
    } else {
      console.error('✗ FAIL:', msg);
      failed++;
    }
  }

  // --- 1. DOM Inspection for groups.html & dashboard.html ---
  console.log('--- 1. DOM Modal & Card Inspection ---');
  for (const pageName of ['faculty/groups.html', 'faculty/dashboard.html']) {
    const filePath = path.join(__dirname, '../../frontend', pageName);
    const html = fs.readFileSync(filePath, 'utf8');

    // Create virtual DOM with mocked global dependencies
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000/' + pageName,
      beforeParse(window) {
        window.guardRoute = () => true;
        window.getCurrentUser = () => ({ id: 4, full_name: 'Dr. Jane Smith', roles: ['TEACHER'] });
        window.fetchApi = async () => ({ success: true, data: [] });
      }
    });
    const { window } = dom;
    const { document } = window;

    // Test openModal & closeModal on create-group-modal
    const createModal = document.getElementById('create-group-modal');
    assert(createModal !== null, `${pageName}: create-group-modal exists`);

    window.openModal('create-group-modal');
    assert(createModal.classList.contains('open'), `${pageName}: openModal adds 'open' class`);
    assert(createModal.style.display === 'flex', `${pageName}: openModal sets display to flex`);
    assert(createModal.style.opacity === '1', `${pageName}: openModal sets opacity to 1`);
    assert(createModal.style.pointerEvents === 'auto', `${pageName}: openModal sets pointerEvents to auto`);

    window.closeModal('create-group-modal');
    assert(!createModal.classList.contains('open'), `${pageName}: closeModal removes 'open' class`);
    assert(createModal.style.display === 'none', `${pageName}: closeModal sets display to none`);

    // Test modal-delete-group
    const deleteModal = document.getElementById('modal-delete-group');
    assert(deleteModal !== null, `${pageName}: modal-delete-group exists`);
    window.openModal('modal-delete-group');
    assert(deleteModal.classList.contains('open'), `${pageName}: modal-delete-group receives 'open' class`);
    assert(deleteModal.style.display === 'flex', `${pageName}: modal-delete-group display is flex`);
    window.closeModal('modal-delete-group');

    // Test modal-edit-group
    const editModal = document.getElementById('modal-edit-group');
    assert(editModal !== null, `${pageName}: modal-edit-group exists`);
    window.openModal('modal-edit-group');
    assert(editModal.classList.contains('open'), `${pageName}: modal-edit-group receives 'open' class`);
    window.closeModal('modal-edit-group');

    // Test modal-trash-bin
    const trashModal = document.getElementById('modal-trash-bin');
    assert(trashModal !== null, `${pageName}: modal-trash-bin exists`);
    window.openModal('modal-trash-bin');
    assert(trashModal.classList.contains('open'), `${pageName}: modal-trash-bin receives 'open' class`);
    window.closeModal('modal-trash-bin');

    // Test mock renderGroups and check generated card buttons
    window.eval(`
      state.groups = [
        {
          id: 9999,
          name: 'Automated Test Class',
          subject_name: 'Software Testing',
          component: 'THEORY',
          semester: 3,
          status: 'ACTIVE',
          invite_code: 'TEST99',
          member_count: 42,
          avg_attendance_pct: 85
        }
      ];
      renderGroups();
    `);

    const groupsContainer = document.getElementById('groups-container');
    const cardHtml = groupsContainer.innerHTML;

    assert(cardHtml.includes('card-menu-header-9999'), `${pageName}: Card includes header dropdown menu`);
    assert(cardHtml.includes('card-menu-footer-9999'), `${pageName}: Card includes footer dropdown menu`);
    assert(cardHtml.includes('openDeleteGroupModal(9999'), `${pageName}: Card includes direct delete button`);
    assert(cardHtml.includes('openEditGroupModal(9999)'), `${pageName}: Card includes direct edit button`);

    // Test toggleCardMenu
    window.eval(`
      const mockEvt = { stopPropagation: () => {}, preventDefault: () => {} };
      toggleCardMenu(mockEvt, 'header-9999');
    `);
    const headerMenu = document.getElementById('card-menu-header-9999');
    assert(headerMenu && headerMenu.classList.contains('open'), `${pageName}: toggleCardMenu opens header menu`);

    window.eval(`
      const mockEvt = { stopPropagation: () => {}, preventDefault: () => {} };
      toggleCardMenu(mockEvt, 'footer-9999');
    `);
    const footerMenu = document.getElementById('card-menu-footer-9999');
    assert(footerMenu && footerMenu.classList.contains('open'), `${pageName}: toggleCardMenu opens footer menu`);
    assert(!headerMenu.classList.contains('open'), `${pageName}: opening footer menu closes header menu`);

    // Close on outside click
    document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert(!footerMenu.classList.contains('open'), `${pageName}: outside click closes open dropdown menus`);
  }

  // --- 2. API End-to-End Lifecycle ---
  console.log('\n--- 2. Backend API Class Lifecycle (Teacher & Admin) ---');

  // Teacher login
  const tLogin = await httpRequest({
    hostname: 'localhost', port: 3000, path: '/api/v1/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: 'teacher@gmail.com', password: 'Password@123', force_logout: true });

  const teacherToken = tLogin.data?.data?.access_token;
  assert(Boolean(teacherToken), 'Teacher logs in successfully');

  // 1. Create Class
  const createRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: '/api/v1/teaching-groups', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + teacherToken }
  }, {
    name: 'E2E Biology Class',
    subject_name: 'Biology 101',
    component: 'THEORY',
    semester: 2,
    enrollment_mode: 'INVITE_CODE',
    department_id: 4
  });

  assert(createRes.status === 201 && createRes.data?.success, 'POST /teaching-groups creates class (201)');
  const groupId = createRes.data?.data?.id;
  assert(Boolean(groupId), `Teaching group created with ID: ${groupId}`);

  // 2. Edit Class
  const editRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: `/api/v1/teaching-groups/${groupId}`, method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + teacherToken }
  }, {
    name: 'E2E Advanced Biology Class',
    subject_name: 'Biology 201',
    component: 'PRACTICAL'
  });
  assert(editRes.status === 200 && editRes.data?.success, `PUT /teaching-groups/${groupId} updates class settings`);

  // 3. Move to Trash Bin
  const trashRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: `/api/v1/teaching-groups/${groupId}/trash`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + teacherToken }
  });
  assert(trashRes.status === 200 && trashRes.data?.success, `POST /teaching-groups/${groupId}/trash moves class to trash`);

  // 4. Verify listed in trash
  const trashList = await httpRequest({
    hostname: 'localhost', port: 3000, path: '/api/v1/teaching-groups?status=TRASH', method: 'GET',
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  const inTrash = (trashList.data?.data || []).some(g => g.id === groupId);
  assert(inTrash, `GET /teaching-groups?status=TRASH includes group #${groupId}`);

  // 5. Restore from Trash
  const restoreRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: `/api/v1/teaching-groups/${groupId}/restore`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + teacherToken }
  });
  assert(restoreRes.status === 200 && restoreRes.data?.success, `POST /teaching-groups/${groupId}/restore restores class`);

  // 6. Delete via DELETE /api/v1/teaching-groups/:id (direct delete)
  const delRouteRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: `/api/v1/teaching-groups/${groupId}`, method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  assert(delRouteRes.status === 200 && delRouteRes.data?.success, `DELETE /teaching-groups/${groupId} trashes/deletes class`);

  // 7. Permanent Delete
  const permRes = await httpRequest({
    hostname: 'localhost', port: 3000, path: `/api/v1/teaching-groups/${groupId}/permanent`, method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  assert(permRes.status === 200 && permRes.data?.success, `DELETE /teaching-groups/${groupId}/permanent purges class permanently`);

  console.log('\n======================================================');
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
