/**
 * Verification Test Suite: Automated Academic Session Engine ("2026 Session" Model)
 * 
 * Tests:
 * 1. Calendar resolution logic (resolveSession) across year boundaries.
 * 2. Automatic database synchronization (academic_years.is_current, departments.active_term).
 * 3. REST API endpoints: GET /admin/session/status, POST /admin/session/sync, PUT /admin/session/config.
 * 4. Frontend DOM elements in admin/academic-structure.html.
 */

const fs = require('fs');
const path = require('path');
const sessionService = require('../src/services/sessionService');
const { query } = require('../src/config/db');

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

async function runTests() {
  console.log('===========================================================');
  console.log('🧪 AUTOMATED ACADEMIC SESSION TEST SUITE ("2026 Session")');
  console.log('===========================================================\n');

  try {
    // ─── 1. RESOLUTION LOGIC TESTS ─────────────────────────────
    console.log('--- 1. Testing Session Resolution Logic ---');
    
    // Current date (Sept 2026) -> 2026-27 (Winter)
    const s1 = sessionService.resolveSession(new Date('2026-09-19'), 7, 1);
    assert(s1.session_year === 2026, '2026-09-19 resolves to session_year 2026');
    assert(s1.session_label === '2026-27 (Winter)', '2026-09-19 label is "2026-27 (Winter)"');
    assert(s1.next_session_label === '2027-28 (Winter)', 'Next session is "2027-28 (Winter)"');
    assert(s1.start_date === '2026-07-01', 'Start date is 2026-07-01');
    assert(s1.end_date === '2027-06-30', 'End date is 2027-06-30');
    assert(s1.next_rollover_date === '2027-07-01', 'Next rollover is 2027-07-01');
    assert(s1.days_remaining > 0, `Days remaining is positive (${s1.days_remaining} days)`);

    // Mid-session date (Feb 2027) -> 2026-27 (Summer)
    const s2 = sessionService.resolveSession(new Date('2027-02-15'), 7, 1);
    assert(s2.session_year === 2026, '2027-02-15 remains in 2026 session year');
    assert(s2.session_label === '2026-27 (Summer)', '2027-02-15 label is "2026-27 (Summer)"');

    // Rollover date (July 2, 2027) -> Auto advances to 2027-28 (Winter)
    const s3 = sessionService.resolveSession(new Date('2027-07-02'), 7, 1);
    assert(s3.session_year === 2027, '2027-07-02 automatically rolls over to session_year 2027');
    assert(s3.session_label === '2027-28 (Winter)', '2027-07-02 label is "2027-28 (Winter)"');
    assert(s3.next_session_label === '2028-29 (Winter)', 'Next session is "2028-29 (Winter)"');

    // ─── 2. DATABASE AUTO-SYNC TESTS ──────────────────────────
    console.log('\n--- 2. Testing Database Auto-Synchronization ---');
    const syncRes = await sessionService.syncAcademicSession(new Date('2026-09-19'));
    assert(syncRes.success === true, 'syncAcademicSession returned success');
    assert(syncRes.active_session === '2026-27 (Winter)', 'Active session synchronized as "2026-27 (Winter)"');

    // Verify academic_years table in database
    const ayRows = await query('SELECT * FROM academic_years WHERE is_current = 1');
    assert(ayRows.length === 1, 'Exactly one academic year has is_current = 1');
    assert(ayRows[0].label.includes('2026'), `Current academic year includes 2026 (got: ${ayRows[0].label})`);

    // Verify departments table in database
    const deptRows = await query('SELECT active_term FROM departments');
    assert(deptRows.length > 0, 'Departments exist');
    const allSynced = deptRows.every(d => d.active_term === '2026-27 (Winter)');
    assert(allSynced, 'All departments synchronized with active_term = "2026-27 (Winter)"');

    // ─── 3. REST API ENDPOINTS ────────────────────────────────
    console.log('\n--- 3. Testing Admin REST API Endpoints ---');
    const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
    });
    const loginData = await loginRes.json();
    assert(loginRes.ok && loginData.success, 'Admin authenticated via REST API');
    const token = loginData.data?.access_token || loginData.data?.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // GET /session/status
    const statusRes = await fetch('http://localhost:3000/api/v1/admin/session/status', { headers: authHeaders });
    const statusData = await statusRes.json();
    assert(statusRes.status === 200 && statusData.success, 'GET /admin/session/status returns 200');
    assert(statusData.data?.session_label === '2026-27 (Winter)', `Status returns session_label "2026-27 (Winter)" (got: ${statusData.data?.session_label})`);
    assert(statusData.data?.status === 'AUTOMATED_ACTIVE', 'Status indicates AUTOMATED_ACTIVE');
    assert(statusData.data?.days_remaining > 0, 'Status includes countdown days_remaining');

    // POST /session/sync
    const apiSyncRes = await fetch('http://localhost:3000/api/v1/admin/session/sync', {
      method: 'POST',
      headers: authHeaders
    });
    const apiSyncData = await apiSyncRes.json();
    assert(apiSyncRes.status === 200 && apiSyncData.success, 'POST /admin/session/sync returns 200');
    assert(apiSyncData.data?.active_session === '2026-27 (Winter)', 'Sync response confirms active_session "2026-27 (Winter)"');

    // PUT /session/config
    const configRes = await fetch('http://localhost:3000/api/v1/admin/session/config', {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_month: 7, start_day: 1, auto_enabled: true })
    });
    const configData = await configRes.json();
    assert(configRes.status === 200 && configData.success, 'PUT /admin/session/config returns 200');

    // PUT /session/duration — Invalid validation (end_date <= start_date)
    const invalidDurRes = await fetch('http://localhost:3000/api/v1/admin/session/duration', {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: '2026-07-01', end_date: '2026-05-01' })
    });
    assert(invalidDurRes.status === 400, 'PUT /admin/session/duration rejects end_date <= start_date with 400');

    // PUT /session/duration — Valid update
    const validDurRes = await fetch('http://localhost:3000/api/v1/admin/session/duration', {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_date: '2026-06-15',
        end_date: '2027-05-31',
        label: '2026-2027 Session'
      })
    });
    const validDurData = await validDurRes.json();
    assert(validDurRes.status === 200 && validDurData.success, 'PUT /admin/session/duration returns 200');
    assert(validDurData.data?.start_date === '2026-06-15', 'Updated start_date is 2026-06-15');
    assert(validDurData.data?.end_date === '2027-05-31', 'Updated end_date is 2027-05-31');
    assert(validDurData.data?.session_label === '2026-2027 Session', 'Updated session_label is "2026-2027 Session"');
    assert(validDurData.data?.next_rollover_date === '2027-06-01', 'Recalculated rollover date is 2027-06-01 (day after end_date)');

    // Verify departments.active_term updated dynamically to new session label
    const updatedDeptRows = await query('SELECT active_term FROM departments');
    const allDeptsUpdated = updatedDeptRows.every(d => d.active_term === '2026-2027 Session');
    assert(allDeptsUpdated, 'All departments dynamically updated with new session label without hardcoding');

    // PUT /session/duration — Omitted label should automatically derive institutional label (e.g. 2026-27 (Winter))
    const autoDurRes = await fetch('http://localhost:3000/api/v1/admin/session/duration', {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_date: '2026-07-01',
        end_date: '2027-06-30'
      })
    });
    const autoDurData = await autoDurRes.json();
    assert(autoDurRes.status === 200 && autoDurData.success, 'PUT /admin/session/duration without label succeeds');
    assert(autoDurData.data?.session_label === '2026-27 (Winter)', `Omitted label automatically computed as "2026-27 (Winter)" (got: ${autoDurData.data?.session_label})`);

    // Reset back to standard session duration for clean test environment
    await sessionService.updateSessionDuration('2026-07-01', '2027-06-30', '2026-27 (Winter)');
    const resetStatus = await sessionService.getSessionStatus();
    assert(resetStatus.start_date === '2026-07-01' && resetStatus.end_date === '2027-06-30', 'Reset session duration back to standard bounds');

    // ─── 4. AUTOMATIC INSTITUTIONAL SESSION LABEL ALGORITHM ──
    console.log('\n--- 4. Testing Institutional Automatic Session Label Logic ---');
    const auto1 = sessionService.computeAutoSessionLabel('2026-07-01', '2027-06-30', new Date('2026-09-19'));
    assert(auto1 === '2026-27 (Winter)', `Sept 2026 computes to "2026-27 (Winter)" (got: ${auto1})`);

    const auto2 = sessionService.computeAutoSessionLabel('2026-07-01', '2027-06-30', new Date('2027-03-15'));
    assert(auto2 === '2026-27 (Summer)', `March 2027 computes to "2026-27 (Summer)" (got: ${auto2})`);

    const auto3 = sessionService.computeAutoSessionLabel('2026-07-01', '2026-12-31');
    assert(auto3 === '2026-27 (Winter)', `Winter term bounds compute to "2026-27 (Winter)" (got: ${auto3})`);

    const auto4 = sessionService.computeAutoSessionLabel('2027-01-01', '2027-06-30');
    assert(auto4 === '2026-27 (Summer)', `Summer term bounds compute to "2026-27 (Summer)" (got: ${auto4})`);

    const auto5 = sessionService.computeAutoSessionLabel('2027-07-01', '2028-06-30', new Date('2027-09-19'));
    assert(auto5 === '2027-28 (Winter)', `Next rollover AY computes to "2027-28 (Winter)" (got: ${auto5})`);

    // ─── 5. FRONTEND DOM VERIFICATION (ZERO-MAINTENANCE GUARANTEE) ──
    console.log('\n--- 5. Testing Frontend DOM Structure (Zero-Maintenance Design) ---');
    const htmlPath = path.join(__dirname, '../../frontend/admin/academic-structure.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verify passive read-only displays are intact
    assert(html.includes('id="session-active-label"'), 'academic-structure.html contains #session-active-label');
    assert(html.includes('id="session-dates-label"'), 'academic-structure.html contains #session-dates-label');
    assert(html.includes('id="session-rollover-text"'), 'academic-structure.html contains #session-rollover-text');
    assert(html.includes('loadSessionStatus'), 'academic-structure.html defines loadSessionStatus function');
    assert(html.includes('FULLY AUTONOMOUS • ZERO MAINTENANCE'), 'academic-structure.html contains autonomous zero-maintenance indicator badge');

    // Verify all manual buttons and maintenance modals are completely removed
    assert(!html.includes('id="btn-sync-session"'), 'academic-structure.html has NO #btn-sync-session (zero manual sync burden)');
    assert(!html.includes('id="btn-edit-session"'), 'academic-structure.html has NO #btn-edit-session (zero manual edit burden)');
    assert(!html.includes('id="session-duration-modal"'), 'academic-structure.html has NO #session-duration-modal (zero maintenance modals)');
    assert(!html.includes('openEditSessionModal'), 'academic-structure.html has NO openEditSessionModal function');
    assert(!html.includes('saveSessionDuration'), 'academic-structure.html has NO saveSessionDuration function');

    // Also check registers.html has dynamic Session label
    const regHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/registers.html'), 'utf8');
    assert(regHtml.includes('Session:</span>'), 'registers.html has Session label instead of Term');

    console.log('\n===========================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('===========================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal error running session automation test suite:', err);
    process.exit(1);
  }
}

runTests();
