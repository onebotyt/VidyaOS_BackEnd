/**
 * Verification Test Suite: Responsive Design & Multi-Screen Support
 * for /admin/academic-structure.html
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('===========================================================');
console.log('🧪 TEST: Responsive Design & Multi-Screen Support');
console.log('===========================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

const htmlPath = path.join(__dirname, '../../frontend/admin/academic-structure.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ─── 1. CSS & Media Query Verification ─────────────────────────────
console.log('--- 1. Testing Media Queries & Responsive CSS Rules ---');

assert(htmlContent.includes('@media (max-width: 1024px)'), 'Contains tablet breakpoint (@media max-width: 1024px)');
assert(htmlContent.includes('@media (max-width: 768px)'), 'Contains small tablet / mobile breakpoint (@media max-width: 768px)');
assert(htmlContent.includes('@media (max-width: 540px)'), 'Contains mobile breakpoint (@media max-width: 540px)');
assert(htmlContent.includes('.table-scroll-wrapper'), 'Contains .table-scroll-wrapper container');
assert(htmlContent.includes('.kpi-secondary'), 'Contains .kpi-secondary rule to streamline metrics on mobile');
assert(htmlContent.includes('deleteDepartment'), 'Defines deleteDepartment function for deleting departments');
assert(htmlContent.includes('btn-danger-soft'), 'Contains .btn-danger-soft styling for deletion buttons');

// ─── 2. Zero Hardcoded Color Compliance ───────────────────────────
console.log('\n--- 2. Testing Zero Hardcoded Hex Colors ---');
const hexMatches = htmlContent.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
assert(hexMatches.length === 0, `Zero hardcoded hex colors found in academic-structure.html (found: ${hexMatches.length})`);

// ─── 3. DOM Structure & Required Test IDs ─────────────────────────
console.log('\n--- 3. Testing Required Element IDs & Invariants ---');
const dom = new JSDOM(htmlContent, {
  runScripts: 'dangerously',
  url: 'http://localhost:3000/admin/academic-structure.html',
  beforeParse(window) {
    window.guardRoute = () => {};
    window.showToast = () => {};
    window.fetchApi = async (url) => {
      if (url === '/admin/session/status') {
        return {
          success: true,
          data: {
            session_label: '2026-27 (Winter)',
            db_academic_year_label: '2026-27 (Winter)',
            academic_year_id: 1,
            start_date: '2026-07-01',
            end_date: '2027-06-30',
            next_rollover_date: '2027-07-01',
            next_session_label: '2027-28 (Winter)',
            days_remaining: 285,
            auto_enabled: true
          }
        };
      }
      if (url === '/admin/departments') {
        return {
          success: true,
          data: [
            { id: 1, code: 'IT', name: 'Information Technology', is_active: 1 },
            { id: 2, code: 'CE', name: 'Civil Engineering', is_active: 1 },
            { id: 3, code: 'ME', name: 'Mechanical Engineering', is_active: 0 },
            { id: 4, code: 'CUSTOM', name: 'Applied Sciences', is_active: 1 }
          ]
        };
      }
      if (url === '/admin/hods') {
        return {
          success: true,
          data: [
            { id: 10, department_id: 1, full_name: 'Prof. Amit Verma', email: 'hod.it@college.edu' }
          ]
        };
      }
      return { success: true, data: [] };
    };
  }
});

const { window } = dom;
const { document } = window;

// Check 4-card KPI stat bar
const statCards = document.querySelectorAll('.quick-stat');
assert(statCards.length === 4, `Quick stat bar has 4 balanced metric cards (found: ${statCards.length})`);
assert(document.getElementById('stat-dept-count') !== null, '#stat-dept-count exists');
assert(document.getElementById('stat-hod-count') !== null, '#stat-hod-count exists');
assert(document.getElementById('stat-session-term') !== null, '#stat-session-term exists');

// Check Autonomous Session Command card
assert(document.getElementById('session-active-label') !== null, '#session-active-label exists');
assert(document.getElementById('session-dates-label') !== null, '#session-dates-label exists');
assert(document.getElementById('session-rollover-text') !== null, '#session-rollover-text exists');
assert(document.body.innerHTML.includes('FULLY AUTONOMOUS • ZERO MAINTENANCE'), 'Autonomous badge present');

// Check zero maintenance: no manual buttons or modals
assert(document.getElementById('btn-edit-session') === null, 'No #btn-edit-session in DOM');
assert(document.getElementById('btn-sync-session') === null, 'No #btn-sync-session in DOM');
assert(document.getElementById('session-duration-modal') === null, 'No #session-duration-modal in DOM');

// Check catalog & search
assert(document.getElementById('dept-search') !== null, '#dept-search input exists');
assert(document.getElementById('dept-tbody') !== null, '#dept-tbody exists');
const addBtn = document.querySelector('button[onclick="openDeptModal()"]');
assert(addBtn !== null && addBtn.textContent.includes('+ Add Department'), '+ Add Department button exists');

// Check modal
const modal = document.getElementById('dept-modal');
assert(modal !== null, '#dept-modal exists');
assert(htmlContent.includes('.modal-backdrop.open'), 'CSS rule .modal-backdrop.open exists');

// ─── 4. Functional Execution in JSDOM ──────────────────────────────
console.log('\n--- 4. Testing Functional Data Loading & Rendering ---');
async function testFunctional() {
  try {
    await window.loadSessionStatus();
    assert(document.getElementById('session-active-label').textContent === '2026-27 (Winter)', 'loadSessionStatus() populated active label');
    assert(document.getElementById('stat-session-term').textContent === 'Winter Term', 'stat-session-term updated to "Winter Term"');

    await window.loadAllData();
    assert(document.getElementById('stat-dept-count').textContent === '4', 'stat-dept-count shows 4 departments');
    assert(document.getElementById('stat-hod-count').textContent === '1 / 4', 'stat-hod-count shows 1 / 4 appointed HODs');
    assert(document.getElementById('catalog-count-badge').textContent === '4 Programs', 'catalog-count-badge shows 4 Programs');

    const rows = document.querySelectorAll('#dept-tbody tr');
    assert(rows.length === 4, `Table rendered 4 department rows (found: ${rows.length})`);

    // Search filter test
    document.getElementById('dept-search').value = 'IT';
    window.renderDepartments();
    const filteredRows = document.querySelectorAll('#dept-tbody tr');
    assert(filteredRows.length === 1, `Search "IT" filtered to 1 row (found: ${filteredRows.length})`);

    // Reset search
    document.getElementById('dept-search').value = '';
    window.renderDepartments();
    const allRows = document.querySelectorAll('#dept-tbody tr');

    // Deletion UI tests: Hardcoded institutional departments have delete button REMOVED
    const hardcodedRowDeleteBtn = allRows[0].querySelector('.btn-danger-soft');
    assert(hardcodedRowDeleteBtn === null, 'Hardcoded department rows have Delete button removed');
    assert(allRows[0].textContent.includes('Core'), 'Hardcoded department rows display Core badge');

    // Custom department rows DO have delete button
    const customRowDeleteBtn = allRows[3].querySelector('.btn-danger-soft');
    assert(customRowDeleteBtn !== null && customRowDeleteBtn.textContent.includes('Delete'), 'Custom department rows contain a Delete button');

    // Modal delete button test: Hidden for hardcoded depts, visible for custom depts
    window.openDeptModal(1); // open hardcoded IT
    assert(modal.classList.contains('open') && modal.style.display === 'flex', 'openDeptModal(1) opened modal for editing');
    const modalDelBtn = document.getElementById('dept-delete-btn');
    assert(modalDelBtn !== null && modalDelBtn.style.display === 'none', 'Edit modal hides Delete button for hardcoded departments');
    window.closeDeptModal();

    window.openDeptModal(4); // open custom department
    assert(modalDelBtn.style.display !== 'none', 'Edit modal shows Delete button for custom departments');
    window.closeDeptModal();

    // In-app custom delete confirmation modal tests (Zero native browser confirm/prompt)
    console.log('\n--- 5. Testing In-App Delete Confirmation Modal (Zero Native Prompts) ---');
    assert(!htmlContent.includes('confirm('), 'Zero native confirm() browser popups in code');
    assert(!htmlContent.includes('prompt('), 'Zero native prompt() browser popups in code');
    const delModal = document.getElementById('delete-confirm-modal');
    assert(delModal !== null, '#delete-confirm-modal custom in-app modal exists in DOM');
    assert(document.getElementById('delete-modal-confirm-btn') !== null, '#delete-modal-confirm-btn exists');

    window.openDeleteModal(4, 'Applied Sciences', 'CUSTOM');
    assert(delModal.classList.contains('open') && delModal.style.display === 'flex', 'openDeleteModal opened custom in-app modal');
    assert(document.getElementById('delete-modal-dept-name').textContent.includes('CUSTOM'), 'Delete modal displays department code');

    window.closeDeleteModal();
    assert(!delModal.classList.contains('open') && delModal.style.display === 'none', 'closeDeleteModal closed custom modal');

    console.log('\n===========================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===========================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal functional test error:', err);
    process.exit(1);
  }
}

testFunctional();
