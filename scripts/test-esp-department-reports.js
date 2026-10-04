/**
 * Test suite for verifying simplified Department Reports with Analysis Board & ESP Records
 * - Admin reports (/api/v1/admin/reports/department)
 * - HOD reports (/api/v1/hod/reports)
 * - Class Teacher department report access
 * - Subject Teacher (non-class teacher) forbidden check
 * - JSDOM verification for Analysis Board and removal of teacher registers
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

async function runTests() {
  console.log('=== VERIFYING SIMPLIFIED ESP DEPARTMENT REPORTS ===\n');

  // Helper login
  async function login(email, password) {
    const res = await fetch(`${BASE_URL}/auth/faculty/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!data.success) throw new Error(`Login failed for ${email}: ` + JSON.stringify(data));
    return data.data.access_token;
  }

  // 1. Admin Endpoint Verification
  console.log('[Step 1] Testing Admin ESP Reports (GET /api/v1/admin/reports/department)...');
  const adminToken = await login('admin@gmail.com', 'Admin@123');
  const adminRes = await fetch(`${BASE_URL}/admin/reports/department?department_id=1`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminData = await adminRes.json();
  if (!adminData.success) throw new Error('Admin report failed: ' + JSON.stringify(adminData));

  console.log('✓ Admin report returned successfully:');
  console.log('   Department:', adminData.data.department.name);
  console.log('   KPIs:', adminData.data.kpis);
  console.log('   Daily trend days:', adminData.data.daily_trend.length);
  console.log('   Total ESP scan records:', adminData.data.records.length);

  if (adminData.data.kpis.total_scans < 1) throw new Error('Expected positive total_scans in admin report');
  if (adminData.data.records.length < 1) throw new Error('Expected ESP scan records in admin report');
  if (!adminData.data.records[0].device_uid) throw new Error('Expected device_uid on ESP scan record');

  // Test Date Filter Preset
  const todayRes = await fetch(`${BASE_URL}/admin/reports/department?department_id=1&date_preset=today`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const todayData = await todayRes.json();
  console.log(`✓ Date preset 'today' filter returned ${todayData.data.records.length} scans for today.`);

  // 2. HOD Endpoint Verification
  console.log('\n[Step 2] Testing HOD ESP Reports (GET /api/v1/hod/reports)...');
  const hodToken = await login('hod@gmail.com', 'Password@123');
  const hodRes = await fetch(`${BASE_URL}/hod/reports`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const hodData = await hodRes.json();
  if (!hodData.success) throw new Error('HOD report failed: ' + JSON.stringify(hodData));
  if (!hodData.data.is_hod) throw new Error('Expected is_hod to be true for HOD');
  console.log('✓ HOD report returned successfully:');
  console.log('   Department:', hodData.data.department_name);
  console.log('   KPIs:', hodData.data.kpis);
  console.log('   Records count:', hodData.data.records.length);

  // 3. Class Teacher Access Verification
  console.log('\n[Step 3] Testing Class Teacher access to Department Reports & Hierarchy...');
  const ctToken = await login('classteacher@gmail.com', 'Password@123');

  const ctHierRes = await fetch(`${BASE_URL}/hod/hierarchy`, {
    headers: { Authorization: `Bearer ${ctToken}` }
  });
  const ctHierData = await ctHierRes.json();
  if (!ctHierData.success) throw new Error('Class Teacher failed to access /hod/hierarchy: ' + JSON.stringify(ctHierData));
  console.log('✓ Class Teacher successfully accessed /api/v1/hod/hierarchy:', ctHierData.data.department_name);

  const ctReportRes = await fetch(`${BASE_URL}/hod/reports`, {
    headers: { Authorization: `Bearer ${ctToken}` }
  });
  const ctReportData = await ctReportRes.json();
  if (!ctReportData.success) throw new Error('Class Teacher failed to access /hod/reports: ' + JSON.stringify(ctReportData));
  if (!ctReportData.data.is_class_teacher) throw new Error('Expected is_class_teacher to be true for Class Teacher');
  console.log('✓ Class Teacher successfully accessed /api/v1/hod/reports:', {
    department: ctReportData.data.department_name,
    is_class_teacher: ctReportData.data.is_class_teacher,
    records: ctReportData.data.records.length
  });

  // 4. Regular Teacher (Non-HOD, Non-Class Teacher) Forbidden Check
  console.log('\n[Step 4] Testing Subject Teacher rejection on /hod/reports...');
  const tToken = await login('teacher@gmail.com', 'Password@123');
  const tRes = await fetch(`${BASE_URL}/hod/reports`, {
    headers: { Authorization: `Bearer ${tToken}` }
  });
  if (tRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for regular subject teacher, got: ${tRes.status}`);
  }
  console.log('✓ Subject Teacher without HOD/Class Teacher role is properly forbidden (HTTP 403).');

  // 5. DOM & Template Verification
  console.log('\n[Step 5] Checking HTML structure for Analysis Board & absence of teacher registers...');
  
  // Admin reports.html check
  const adminHtmlPath = path.resolve(__dirname, '../../frontend/admin/reports.html');
  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf-8');
  if (!adminHtml.includes('id="kpi-board"')) throw new Error('admin/reports.html must have #kpi-board');
  if (!adminHtml.includes('id="daily-trend-chart"')) throw new Error('admin/reports.html must have #daily-trend-chart');
  if (!adminHtml.includes('Department Attendance Summary')) {
    throw new Error('admin/reports.html must have Department Attendance Summary table');
  }
  const hodDevicesHtmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-devices.html');
  const hodDevicesHtml = fs.readFileSync(hodDevicesHtmlPath, 'utf-8');
  if (!hodDevicesHtml.includes('Biometric ESP32 Presence Records')) {
    throw new Error('faculty/hod-devices.html must contain Biometric ESP32 Presence Records');
  }
  if (adminHtml.includes('Attendance Registers Report') || adminHtml.includes('No Official Registers Found')) {
    throw new Error('admin/reports.html should not contain legacy teacher registers report text');
  }
  // Verify KPI board is before chart-card and single Department/Program filter is inside chart-card
  const adminKpiIdx = adminHtml.indexOf('id="kpi-board"');
  const adminChartIdx = adminHtml.indexOf('class="chart-card');
  const adminFilterIdx = adminHtml.indexOf('id="report-dept"');
  if (adminKpiIdx > adminChartIdx) throw new Error('admin/reports.html: #kpi-board must be placed above chart section');
  if (adminFilterIdx < adminChartIdx) throw new Error('admin/reports.html: filters must be placed inside chart section');
  if (adminHtml.includes('id="report-branch"')) throw new Error('admin/reports.html should not have separate #report-branch dropdown');
  console.log('✓ Admin reports.html verified: KPI board at top, unified Department/Program filter inside chart section (no redundant branch dropdown).');

  // HOD hod-reports.html check
  const hodHtmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-reports.html');
  const hodHtml = fs.readFileSync(hodHtmlPath, 'utf-8');
  if (!hodHtml.includes('id="kpi-board"')) throw new Error('hod-reports.html must have #kpi-board');
  if (!hodHtml.includes('id="daily-trend-chart"')) throw new Error('hod-reports.html must have #daily-trend-chart');
  if (!hodHtml.includes('Biometric ESP32 Presence Records')) throw new Error('hod-reports.html must have ESP records section');
  if (hodHtml.includes('scope-theory') || hodHtml.includes('scope-practical')) {
    throw new Error('hod-reports.html should not contain teacher register theory/practical badges');
  }
  // Verify KPI board is before chart-card, filters inside chart-card, and no redundant branch dropdown
  const hodKpiIdx = hodHtml.indexOf('id="kpi-board"');
  const hodChartIdx = hodHtml.indexOf('class="chart-card');
  const hodFilterIdx = hodHtml.indexOf('id="filter-year"');
  if (hodKpiIdx > hodChartIdx) throw new Error('hod-reports.html: #kpi-board must be placed above chart section');
  if (hodFilterIdx < hodChartIdx) throw new Error('hod-reports.html: filters must be placed inside chart section');
  if (hodHtml.includes('id="filter-branch"')) throw new Error('hod-reports.html should not have redundant #filter-branch dropdown');
  console.log('✓ HOD hod-reports.html verified: KPI board at top, filters inside chart section, redundant branch dropdown eliminated.');

  // 6. JSDOM Render Test
  console.log('\n[Step 6] JSDOM interactive rendering test...');
  const dom = new JSDOM(hodHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/faculty/hod-reports.html'
  });
  const { window } = dom;
  window.guardRoute = () => true;
  window.user = { id: 3, full_name: 'Prof. Priya Mehta (Class Teacher)', is_class_teacher: true };
  window.getCurrentUser = () => window.user;
  window.getAuthToken = () => ctToken;

  // Extract inline script and eval in window context (omit automatic init() fetch)
  const inlineScriptMatch = hodHtml.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/);
  if (inlineScriptMatch) {
    const scriptToRun = inlineScriptMatch[1].replace(/\binit\(\);?\s*$/, '// auto-init disabled');
    window.eval(scriptToRun);
  }

  console.log('typeof window.renderAnalysisBoard:', typeof window.renderAnalysisBoard);
  if (typeof window.renderAnalysisBoard === 'function') {
    window.renderAnalysisBoard(ctReportData.data);
    window.renderRecordsTable(ctReportData.data.records);
  }

  const renderedKpiScans = window.document.getElementById('kpi-scans').textContent.trim();
  console.log('Rendered KPI Scans in DOM:', renderedKpiScans);
  if (renderedKpiScans !== '57') throw new Error(`Expected KPI scans 57, got ${renderedKpiScans}`);

  const tableRows = window.document.querySelectorAll('#table-wrap tbody tr');
  console.log(`Rendered ${tableRows.length} ESP scan table rows in DOM.`);
  if (tableRows.length !== 57) throw new Error(`Expected 57 table rows, got ${tableRows.length}`);

  const firstRowCols = Array.from(tableRows[0].querySelectorAll('td')).map(td => td.textContent.trim().replace(/\s+/g, ' '));
  console.log('First rendered ESP scan row:', firstRowCols);
  if (!firstRowCols.some(c => c.includes('VERIFIED'))) {
    throw new Error('Expected VERIFIED status in first row');
  }

  console.log('\n======================================================');
  console.log(' ALL ESP DEPARTMENT REPORT WORKFLOW TESTS PASSED! 🎉');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
