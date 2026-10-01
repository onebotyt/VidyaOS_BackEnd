/**
 * JSDOM Full Browser Simulation for Admin Session Duration Editor
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('===========================================================');
console.log('🧪 JSDOM SIMULATION: Admin Session Duration Modal & Actions');
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
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip external script tags to run self-contained
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
      return { success: true, data: [] };
    };
  }
});

const { window } = dom;
const { document } = window;


let putPayload = null;
window.fetchApi = async (url, opts = {}) => {
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
  if (url === '/admin/session/duration' && opts.method === 'PUT') {
    putPayload = JSON.parse(opts.body);
    return {
      success: true,
      message: `Academic Session duration successfully updated for ${putPayload.label}`,
      data: {
        session_label: putPayload.label,
        start_date: putPayload.start_date,
        end_date: putPayload.end_date,
        next_rollover_date: '2027-06-01',
        next_session_label: '2027-28 (Winter)',
        days_remaining: 254
      }
    };
  }
  return { success: true, data: [] };
};

async function runDomTests() {
  try {
    // 1. Check Initial State — Zero Maintenance Guarantee
    console.log('--- 1. Testing Initial DOM Structure (Zero-Maintenance Design) ---');
    const btnEdit = document.getElementById('btn-edit-session');
    assert(btnEdit === null, 'No #btn-edit-session exists (Zero manual maintenance burden)');
    const btnSync = document.getElementById('btn-sync-session');
    assert(btnSync === null, 'No #btn-sync-session exists (Zero manual sync burden)');
    const modal = document.getElementById('session-duration-modal');
    assert(modal === null, 'No #session-duration-modal exists (No complex modal maintenance)');

    // Verify autonomous zero-maintenance badge
    const html = document.body.innerHTML;
    assert(html.includes('FULLY AUTONOMOUS • ZERO MAINTENANCE'), 'Autonomous indicator badge present');

    // 2. Load Session Status Passively
    console.log('\n--- 2. Testing Passive loadSessionStatus ---');
    await window.loadSessionStatus();
    const activeLabelEl = document.getElementById('session-active-label');
    assert(activeLabelEl.textContent === '2026-27 (Winter)', 'Session label passively rendered as "2026-27 (Winter)"');
    const datesLabelEl = document.getElementById('session-dates-label');
    assert(datesLabelEl.textContent === '(2026-07-01 to 2027-06-30)', 'Dates label populated correctly');
    const rollEl = document.getElementById('session-rollover-text');
    assert(rollEl.innerHTML.includes('2027-28 (Winter)'), 'Rollover text indicates advances to 2027-28 (Winter)');

    console.log('\n===========================================================');
    console.log(`JSDOM SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('===========================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal error in DOM test:', err);
    process.exit(1);
  }
}

runDomTests();
