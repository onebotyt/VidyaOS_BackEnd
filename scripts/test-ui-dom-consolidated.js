/**
 * Automated UI & DOM Integration Test for Consolidated Faculty Pages
 */

const http = require('http');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: () => Promise.resolve(d)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('=== AUTOMATED UI & DOM CONSOLIDATION TEST ===\n');

  // 1. Check HTTP 301 Redirects
  console.log('1. Testing HTTP 301 redirects for consolidated URLs...');
  const redTests = [
    { from: 'http://localhost:3000/faculty/analytics.html', to: '/faculty/reports.html?tab=analytics' },
    { from: 'http://localhost:3000/faculty/marks.html', to: '/faculty/assignments.html?tab=marks' },
    { from: 'http://localhost:3000/faculty/attendance/quick.html', to: '/faculty/registers.html' },
    { from: 'http://localhost:3000/faculty/register-view.html?id=2', to: '/faculty/registers.html?id=2' }
  ];

  for (const t of redTests) {
    const res = await fetch(t.from);
    if (res.status !== 301 || res.headers.location !== t.to) {
      throw new Error(`Redirect failed for ${t.from}: expected 301 ${t.to}, got ${res.status} ${res.headers.location}`);
    }
    console.log(`   ✓ ${t.from} ➔ 301 ${res.headers.location}`);
  }

  // 2. Inspect registers.html DOM
  console.log('\n2. Inspecting /faculty/registers.html DOM elements...');
  const regHtml = await (await fetch('http://localhost:3000/faculty/registers.html')).text();
  const checksReg = [
    { name: 'Subject Cards Grid container', id: 'id="registers-grid"' },
    { name: 'Cards View container', id: 'id="view-cards-container"' },
    { name: 'Register Switcher dropdown', id: 'id="register-switcher-select"' },
    { name: 'Register Detail View container', id: 'id="view-register-container"' },
    { name: 'Back to Subject Cards compatibility', id: 'backToCards()' },
    { name: 'ESP32 Status Badge container', id: 'id="esp-status-badge"' },
    { name: 'Date picker input', id: 'id="sync-date"' },
    { name: 'Sync ESP Attendance button', id: 'id="btn-esp-sync"' },
    { name: 'ESP Confirmation Modal with checkboxes', id: 'id="esp-confirm-modal"' },
    { name: 'ESP Select All checkbox', id: 'id="esp-select-all"' },
    { name: 'ESP Scans table body', id: 'id="esp-scans-tbody"' },
    { name: 'Confirm & Add to Register button', id: 'id="btn-confirm-save-esp"' },
    { name: 'Physical Register Matrix Table', id: 'id="register-matrix-table"' },
    { name: 'Sessions Timeline Table Body', id: 'id="sessions-table-body"' },
    { name: 'Quick Manual Roll Call Modal', id: 'id="manual-roll-modal"' },
    { name: 'Create Personal Register Modal', id: 'id="personal-modal"' }
  ];

  for (const c of checksReg) {
    if (!regHtml.includes(c.id)) {
      throw new Error(`registers.html missing element: ${c.name} (${c.id})`);
    }
    console.log(`   ✓ registers.html has ${c.name}`);
  }

  // 3. Inspect assignments.html DOM
  console.log('\n3. Inspecting /faculty/assignments.html DOM elements...');
  const assignHtml = await (await fetch('http://localhost:3000/faculty/assignments.html')).text();
  const checksAssign = [
    { name: 'Tab 1: Assignments button', id: 'id="tab-assignments-btn"' },
    { name: 'Tab 1: Assignments panel', id: 'id="tab-assignments-panel"' },
    { name: 'Tab 2: Test Marks button', id: 'id="tab-marks-btn"' },
    { name: 'Tab 2: Test Marks panel', id: 'id="tab-marks-panel"' },
    { name: 'Assignment Create Form', id: 'createAssignment(event)' },
    { name: 'Assignment Title Input', id: 'id="a-title"' },
    { name: 'Assignment List Container', id: 'id="assignment-list"' },
    { name: 'Exam Create Form', id: 'createExam(event)' },
    { name: 'Exam Title Input', id: 'id="m-name"' },
    { name: 'Exam List Container', id: 'id="exam-list"' }
  ];

  for (const c of checksAssign) {
    if (!assignHtml.includes(c.id)) {
      throw new Error(`assignments.html missing element: ${c.name} (${c.id})`);
    }
    console.log(`   ✓ assignments.html has ${c.name}`);
  }

  // 4. Inspect reports.html DOM
  console.log('\n4. Inspecting /faculty/reports.html DOM elements...');
  const repHtml = await (await fetch('http://localhost:3000/faculty/reports.html')).text();
  const checksRep = [
    { name: 'Tab 1: Attendance Analytics button', id: 'id="tab-analytics-btn"' },
    { name: 'Tab 1: Attendance Analytics panel', id: 'id="tab-analytics-panel"' },
    { name: 'Tab 2: Defaulters button', id: 'id="tab-defaulters-btn"' },
    { name: 'Tab 2: Defaulters panel', id: 'id="tab-defaulters-panel"' },
    { name: 'Tab 3: ESP32 Hardware Scans button', id: 'id="tab-esp32-btn"' },
    { name: 'Tab 3: ESP32 Hardware Scans panel', id: 'id="tab-esp32-panel"' },
    { name: 'KPI Cards Row', id: 'id="kpi-row"' },
    { name: 'Class Attendance Progress Bars', id: 'id="class-bars"' },
    { name: '14-Day Attendance Trend Container', id: 'id="trend-row"' },
    { name: 'Defaulters Search Input', id: 'id="defaulter-search"' },
    { name: 'Defaulters Table Body', id: 'id="defaulters-tbody"' },
    { name: 'Defaulters CSV Export button', id: 'exportDefaultersCsv()' },
    { name: 'ESP32 Scans Table Body', id: 'id="esp32-tbody"' }
  ];

  for (const c of checksRep) {
    if (!repHtml.includes(c.id)) {
      throw new Error(`reports.html missing element: ${c.name} (${c.id})`);
    }
    console.log(`   ✓ reports.html has ${c.name}`);
  }

  // 5. Inspect dashboard.html DOM
  console.log('\n5. Inspecting /faculty/dashboard.html DOM elements...');
  const dashHtml = await (await fetch('http://localhost:3000/faculty/dashboard.html')).text();
  
  const hasRegTile = dashHtml.includes('href="/faculty/registers.html"') && dashHtml.includes('Take Attendance & Registers');
  const hasAssignTile = dashHtml.includes('href="/faculty/assignments.html"') && dashHtml.includes('Assignments & Test Marks');
  const hasRepTile = dashHtml.includes('href="/faculty/reports.html"') && (dashHtml.includes('Attendance Reports & Analytics') || dashHtml.includes('Analytics & Defaulters'));

  const hasOldQuickTile = dashHtml.includes('href="/faculty/attendance/quick.html"');
  const hasOldMarksTile = dashHtml.includes('href="/faculty/marks.html"');
  const hasOldAnalyticsTile = dashHtml.includes('href="/faculty/analytics.html"');

  console.log('   Has unified Take Attendance & Registers tile:', hasRegTile);
  console.log('   Has unified Assignments & Test Marks tile:', hasAssignTile);
  console.log('   Has unified Analytics & Defaulters tile:', hasRepTile);
  console.log('   Has separate old Take Attendance tile (should be false):', hasOldQuickTile);
  console.log('   Has separate old Test Marks tile (should be false):', hasOldMarksTile);
  console.log('   Has separate old Analytics tile (should be false):', hasOldAnalyticsTile);

  if (!hasRegTile || !hasAssignTile || !hasRepTile || hasOldQuickTile || hasOldMarksTile || hasOldAnalyticsTile) {
    throw new Error('dashboard.html tile verification failed!');
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🎉 ALL DOM & UI INTEGRATION CHECKS PASSED WITH ZERO ERRORS!');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(0);
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
