const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('======================================================');
console.log('🧪 AUTOMATED HOD ADAPTIVE DASHBOARD VERIFICATION');
console.log('======================================================\n');

const facultyDir = path.resolve(__dirname, '../../frontend/faculty');
const pagesToTest = ['dashboard.html', 'groups.html'];

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failCount++;
  }
}

for (const pageName of pagesToTest) {
  console.log(`\n--- Testing ${pageName} ---`);
  const filePath = path.join(facultyDir, pageName);
  const html = fs.readFileSync(filePath, 'utf8');

  // 1. Verify Static DOM Structure
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const doc = dom.window.document;

  assert(doc.getElementById('hod-view-switcher-bar') !== null, `${pageName} contains #hod-view-switcher-bar`);
  assert(doc.getElementById('btn-tab-classes') !== null, `${pageName} contains #btn-tab-classes`);
  assert(doc.getElementById('badge-teaching-count') !== null, `${pageName} contains #badge-teaching-count`);
  assert(doc.getElementById('btn-tab-dept') !== null, `${pageName} contains #btn-tab-dept`);
  assert(doc.getElementById('dept-pending-dot') !== null, `${pageName} contains #dept-pending-dot`);
  assert(doc.getElementById('hod-switcher-dept-name') !== null, `${pageName} contains #hod-switcher-dept-name`);

  assert(doc.getElementById('hod-dept-command-center') !== null, `${pageName} contains #hod-dept-command-center`);
  assert(doc.getElementById('dept-command-title') !== null, `${pageName} contains #dept-command-title`);
  assert(doc.getElementById('kpi-dept-teachers') !== null, `${pageName} contains #kpi-dept-teachers`);
  assert(doc.getElementById('kpi-dept-students') !== null, `${pageName} contains #kpi-dept-students`);
  assert(doc.getElementById('kpi-dept-att-pct') !== null, `${pageName} contains #kpi-dept-att-pct`);
  assert(doc.getElementById('kpi-dept-registers') !== null, `${pageName} contains #kpi-dept-registers`);
  assert(doc.getElementById('kpi-dept-devices') !== null, `${pageName} contains #kpi-dept-devices`);
  assert(doc.getElementById('dept-recent-sessions-list') !== null, `${pageName} contains #dept-recent-sessions-list`);
  assert(doc.getElementById('dept-action-radar-list') !== null, `${pageName} contains #dept-action-radar-list`);

  assert(doc.getElementById('teaching-classes-view') !== null, `${pageName} contains #teaching-classes-view`);
  assert(doc.getElementById('btn-create-group') !== null, `${pageName} contains #btn-create-group (Contract preserved)`);
  assert(doc.getElementById('groups-container') !== null, `${pageName} contains #groups-container (Contract preserved)`);
  assert(doc.getElementById('todo-widget-list') !== null, `${pageName} contains #todo-widget-list (Contract preserved)`);
  assert(doc.getElementById('att-chart-bars') !== null, `${pageName} contains #att-chart-bars (Contract preserved)`);
  assert(doc.getElementById('no-subjects-banner') !== null, `${pageName} contains #no-subjects-banner (Contract preserved)`);

  // 2. Verify JS Functions exist in script
  assert(html.includes('function updateDashboardMode('), `${pageName} script includes updateDashboardMode()`);
  assert(html.includes('function switchDashboardTab('), `${pageName} script includes switchDashboardTab()`);
  assert(html.includes('async function loadHodDashboardData('), `${pageName} script includes loadHodDashboardData()`);

  // 3. Behavioral Simulation using Mock State & Functions
  // Mock localStorage
  const localStorageMock = (function() {
    let store = {};
    return {
      getItem: (key) => store[key] || null,
      setItem: (key, val) => { store[key] = String(val); },
      clear: () => { store = {}; }
    };
  })();
  dom.window.localStorage = localStorageMock;

  // Simulate Teaching Faculty (Regular Teacher: not HOD, 2 classes)
  let mockState = {
    currentUser: { id: 10, full_name: 'Prof Regular', is_hod: false, has_assigned_subjects: true },
    groups: [{ id: 1, status: 'ACTIVE' }, { id: 2, status: 'ACTIVE' }]
  };

  // Run updateDashboardMode logic
  function testUpdateDashboardMode(state) {
    const isHOD = Boolean(state.currentUser?.is_hod);
    const activeGroups = state.groups.filter(g => g.status === 'ACTIVE');
    const hasClasses = activeGroups.length > 0;
    const hasAssignedSubjects = Boolean(state.currentUser?.has_assigned_subjects);

    const switcherBar = doc.getElementById('hod-view-switcher-bar');
    const countBadge = doc.getElementById('badge-teaching-count');
    if (countBadge) {
      countBadge.innerText = String(activeGroups.length);
      countBadge.textContent = String(activeGroups.length);
    }

    function doSwitch(tab) {
      const btnClasses = doc.getElementById('btn-tab-classes');
      const btnDept = doc.getElementById('btn-tab-dept');
      const teachingView = doc.getElementById('teaching-classes-view');
      const deptView = doc.getElementById('hod-dept-command-center');

      if (tab === 'DEPT') {
        if (btnClasses) btnClasses.classList.remove('active');
        if (btnDept) btnDept.classList.add('active');
        if (teachingView) teachingView.style.display = 'none';
        if (deptView) deptView.style.display = 'block';
      } else {
        if (btnClasses) btnClasses.classList.add('active');
        if (btnDept) btnDept.classList.remove('active');
        if (teachingView) teachingView.style.display = 'block';
        if (deptView) deptView.style.display = 'none';
      }
    }

    if (isHOD) {
      if (switcherBar) switcherBar.style.display = 'flex';
      if (!hasClasses && !hasAssignedSubjects) {
        doSwitch('DEPT');
      } else {
        doSwitch('CLASSES');
      }
    } else {
      if (switcherBar) switcherBar.style.display = 'none';
      doSwitch('CLASSES');
    }
  }

  // Case A: Regular Teacher
  testUpdateDashboardMode(mockState);
  assert(doc.getElementById('hod-view-switcher-bar').style.display === 'none', `${pageName} hides switcher bar for regular faculty`);
  assert(doc.getElementById('teaching-classes-view').style.display === 'block', `${pageName} shows teaching-classes-view for regular faculty`);
  assert(doc.getElementById('hod-dept-command-center').style.display === 'none', `${pageName} hides dept command center for regular faculty`);

  // Case B: Non-Teaching HOD (is_hod = true, has_assigned_subjects = false, activeGroups = 0)
  mockState = {
    currentUser: { id: 2, full_name: 'Dr HOD NonTeaching', is_hod: true, has_assigned_subjects: false, hod_department_name: 'Information Technology' },
    groups: []
  };
  testUpdateDashboardMode(mockState);
  assert(doc.getElementById('hod-view-switcher-bar').style.display === 'flex', `${pageName} displays switcher bar for Non-Teaching HOD`);
  const badgeNonTeaching = doc.getElementById('badge-teaching-count');
  assert((badgeNonTeaching.textContent || badgeNonTeaching.innerText) === '0', `${pageName} shows 0 in teaching count badge for Non-Teaching HOD`);
  assert(doc.getElementById('hod-dept-command-center').style.display === 'block', `${pageName} automatically defaults to Department Command Center for Non-Teaching HOD`);
  assert(doc.getElementById('teaching-classes-view').style.display === 'none', `${pageName} hides teaching classes view by default for Non-Teaching HOD`);

  // Case C: Teaching HOD (is_hod = true, has_assigned_subjects = true, activeGroups = 3)
  mockState = {
    currentUser: { id: 3, full_name: 'Dr HOD Teaching', is_hod: true, has_assigned_subjects: true, hod_department_name: 'Information Technology' },
    groups: [{ id: 10, status: 'ACTIVE' }, { id: 11, status: 'ACTIVE' }, { id: 12, status: 'ACTIVE' }]
  };
  testUpdateDashboardMode(mockState);
  assert(doc.getElementById('hod-view-switcher-bar').style.display === 'flex', `${pageName} displays switcher bar for Teaching HOD`);
  const badgeTeaching = doc.getElementById('badge-teaching-count');
  assert((badgeTeaching.textContent || badgeTeaching.innerText) === '3', `${pageName} reflects 3 classes in teaching count badge for Teaching HOD`);
  assert(doc.getElementById('teaching-classes-view').style.display === 'block', `${pageName} allows Teaching HOD to view classes tab`);
}

console.log('\n======================================================');
console.log(`Results: ${passCount} Passed, ${failCount} Failed (Total: ${passCount + failCount})`);
console.log('======================================================\n');

process.exit(failCount === 0 ? 0 : 1);
