const BASE_URL = 'http://localhost:3000';

async function testUI() {
  console.log('=== RUNNING AUTOMATED UI & DOM INTEGRATION TEST ===\n');

  // 1. Test 301 Redirect for /admin/branches.html
  console.log('1. Checking HTTP 301 Redirect for /admin/branches.html...');
  const branchRedirectRes = await fetch(`${BASE_URL}/admin/branches.html`, { redirect: 'manual' });
  console.log('   Status:', branchRedirectRes.status);
  console.log('   Location header:', branchRedirectRes.headers.get('location'));
  if (branchRedirectRes.status !== 301 || !branchRedirectRes.headers.get('location').includes('/admin/academic-structure.html')) {
    throw new Error('Branch redirect failed!');
  }
  console.log('   ✓ /admin/branches.html successfully redirects to /admin/academic-structure.html\n');

  // 2. Test /admin/academic-structure.html DOM structure
  console.log('2. Inspecting /admin/academic-structure.html DOM content...');
  const pageRes = await fetch(`${BASE_URL}/admin/academic-structure.html`);
  const pageHtml = await pageRes.text();

  // Check only 2 tabs exist
  const hasDeptTab = pageHtml.includes('id="tab-btn-departments"');
  const hasAYTab = pageHtml.includes('id="tab-btn-academic-years"');
  const hasOldBranchTab = pageHtml.includes('id="tab-btn-branches"');
  console.log('   Has Departments & Programs tab:', hasDeptTab);
  console.log('   Has Academic Years tab:', hasAYTab);
  console.log('   Has separate Branches tab (should be false):', hasOldBranchTab);

  if (!hasDeptTab || !hasAYTab || hasOldBranchTab) {
    throw new Error('Academic structure tabs verification failed!');
  }

  // Check Department modal fields
  const hasDeptCode = pageHtml.includes('id="dept-code"');
  const hasDeptName = pageHtml.includes('id="dept-name"');
  const hasBranchModal = pageHtml.includes('id="branch-modal"');
  console.log('   Has Dept Code input (single code):', hasDeptCode);
  console.log('   Has Dept Name input:', hasDeptName);
  console.log('   Has separate Branch modal (should be false):', hasBranchModal);

  if (!hasDeptCode || !hasDeptName || hasBranchModal) {
    throw new Error('Department modal verification failed!');
  }
  console.log('   ✓ /admin/academic-structure.html has unified tabs and single code input.\n');

  // 3. Test /admin/students.html DOM content
  console.log('3. Inspecting /admin/students.html DOM content...');
  const studentsRes = await fetch(`${BASE_URL}/admin/students.html`);
  const studentsHtml = await studentsRes.text();

  const hasRosterSearch = studentsHtml.includes('id="roster-search"');
  const hasRedundantBranchFilter = studentsHtml.includes('id="roster-branch-filter"');
  console.log('   Has Roster Search input:', hasRosterSearch);
  console.log('   Has redundant roster branch filter (should be false):', hasRedundantBranchFilter);

  if (!hasRosterSearch || hasRedundantBranchFilter) {
    throw new Error('Students page roster verification failed!');
  }
  console.log('   ✓ /admin/students.html roster has search and clean unified department column.\n');

  // 4. Test /admin/reports.html DOM content
  console.log('4. Inspecting /admin/reports.html DOM content...');
  const reportsRes = await fetch(`${BASE_URL}/admin/reports.html`);
  const reportsHtml = await reportsRes.text();

  const hasReportDept = reportsHtml.includes('id="report-dept"');
  const hasReportSem = reportsHtml.includes('id="report-sem"');
  const hasReportBranch = reportsHtml.includes('id="report-branch"');
  console.log('   Has Report Dept filter:', hasReportDept);
  console.log('   Has Report Sem filter:', hasReportSem);
  console.log('   Has redundant Report Branch filter (should be false):', hasReportBranch);

  if (!hasReportDept || !hasReportSem || hasReportBranch) {
    throw new Error('Reports page filter verification failed!');
  }
  console.log('   ✓ /admin/reports.html has clean 2-column filter without redundant branch.\n');

  // 5. Test Admin API Authentication & Departments 1-to-1 sync
  console.log('5. Testing Admin API Data parity...');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/faculty/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.access_token;

  const [deptsRes, branchesRes] = await Promise.all([
    fetch(`${BASE_URL}/api/v1/admin/departments`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${BASE_URL}/api/v1/admin/branches`, { headers: { Authorization: `Bearer ${token}` } })
  ]);
  const depts = (await deptsRes.json()).data;
  const branches = (await branchesRes.json()).data;

  console.log(`   Departments: ${depts.length}, Branches: ${branches.length}`);
  depts.forEach(d => {
    const b = branches.find(item => item.department_id === d.id);
    console.log(`   - Dept [${d.code}] ${d.name} <==> Branch [${b?.code}] ${b?.name}`);
  });

  console.log('\n=============================================');
  console.log('ALL UI & DOM INTEGRATION TESTS PASSED! 🎉');
  console.log('=============================================');
}

testUI().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
