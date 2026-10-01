/**
 * Verification script for:
 * 1. Archive page UI and CSS linking (reset.css, variables.css, layout.css, components.css)
 * 2. Hardware Terminal multi-year assignment
 * 3. Automatic semester calculation (Years -> Semesters auto-derived)
 * 4. Backward compatibility & URL redirect for hod_archive.html
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';
const ROOT_URL = 'http://localhost:3000';

async function run() {
  console.log('================================================================');
  console.log(' TESTING MULTI-YEAR HARDWARE & ARCHIVE CSS REFACTOR');
  console.log('================================================================\n');

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

  // ------------------------------------------------------------------
  // 1. Check Archive Page CSS and Markup
  // ------------------------------------------------------------------
  console.log('[Step 1] Verifying hod-archive.html CSS and design system integration...');
  const archiveHtmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-archive.html');
  const archiveHtml = fs.readFileSync(archiveHtmlPath, 'utf-8');

  if (archiveHtml.includes('/css/style.css')) {
    throw new Error('hod-archive.html still links to non-existent /css/style.css');
  }
  const requiredCss = ['/css/reset.css', '/css/variables.css', '/css/layout.css', '/css/components.css'];
  for (const css of requiredCss) {
    if (!archiveHtml.includes(css)) {
      throw new Error(`hod-archive.html missing required stylesheet: ${css}`);
    }
  }
  console.log('✓ All 4 core stylesheets (reset.css, variables.css, layout.css, components.css) are linked in hod-archive.html.');

  // Check URL redirect for /faculty/hod_archive.html
  const redirRes = await fetch(`${ROOT_URL}/faculty/hod_archive.html`, { redirect: 'manual' });
  console.log(`  /faculty/hod_archive.html HTTP status: ${redirRes.status}`);
  if (redirRes.status === 301 || redirRes.status === 302) {
    console.log('✓ /faculty/hod_archive.html redirects cleanly to canonical URL:', redirRes.headers.get('location'));
  } else if (redirRes.status === 200) {
    console.log('✓ /faculty/hod_archive.html served successfully via forwarder.');
  } else {
    throw new Error(`Unexpected status for hod_archive.html: ${redirRes.status}`);
  }

  // ------------------------------------------------------------------
  // 2. Check DOM Structure for Multi-Year & Auto-Semester in hod-devices.html
  // ------------------------------------------------------------------
  console.log('\n[Step 2] Verifying hod-devices.html multi-year and auto-semester DOM structure...');
  const devicesHtmlPath = path.resolve(__dirname, '../../frontend/faculty/hod-devices.html');
  const devicesHtml = fs.readFileSync(devicesHtmlPath, 'utf-8');

  if (devicesHtml.includes('id="dev-year"') || devicesHtml.includes('id="dev-sem"')) {
    throw new Error('hod-devices.html should not contain legacy single select dropdowns id="dev-year" or id="dev-sem"');
  }
  if (!devicesHtml.includes('id="year-checkboxes-wrap"')) {
    throw new Error('hod-devices.html missing #year-checkboxes-wrap');
  }
  if (!devicesHtml.includes('id="auto-semesters-preview"')) {
    throw new Error('hod-devices.html missing #auto-semesters-preview');
  }
  if (!devicesHtml.includes('id="btn-select-all-years"')) {
    throw new Error('hod-devices.html missing #btn-select-all-years');
  }
  if (!devicesHtml.includes('onYearSelectionChange')) {
    throw new Error('hod-devices.html missing onYearSelectionChange handler');
  }
  console.log('✓ Verified: hod-devices.html contains multi-year selector chips, auto-semester preview badges, and select-all toggle.');

  // ------------------------------------------------------------------
  // 3. Test Multi-Year & Auto-Semester API Registration as HOD
  // ------------------------------------------------------------------
  console.log('\n[Step 3] Testing HOD Multi-Year & Auto-Semester Device Registration via API...');
  const hodToken = await login('hod@gmail.com', 'Password@123');

  // Register multi-year device where semesters are explicitly provided
  const testUid1 = `ESP32_MULTI_${Date.now().toString().slice(-4)}`;
  console.log(`  Registering multi-year terminal: ${testUid1} (Years 1, 2, 3)...`);
  const createRes1 = await fetch(`${BASE_URL}/hod/devices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_uid: testUid1,
      name: 'Department Entrance Main Kiosk',
      years: [1, 2, 3],
      semesters: [1, 2, 3, 4, 5, 6],
      secret_key: 'secret-multi-123'
    })
  });
  const createData1 = await createRes1.json();
  if (!createData1.success) throw new Error('Multi-year device creation failed: ' + JSON.stringify(createData1));
  console.log('✓ Multi-year hardware terminal registered successfully:', createData1.data);

  // Register device where ONLY years are sent -> Semesters must be AUTO-DERIVED by backend!
  const testUid2 = `ESP32_AUTOSEM_${Date.now().toString().slice(-4)}`;
  console.log(`  Registering terminal with ONLY years (Years 1, 2): ${testUid2}...`);
  const createRes2 = await fetch(`${BASE_URL}/hod/devices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hodToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_uid: testUid2,
      name: 'Common Lab Gateway Scanner',
      years: [1, 2],
      secret_key: 'secret-autosem-123'
    })
  });
  const createData2 = await createRes2.json();
  if (!createData2.success) throw new Error('Auto-semester device creation failed: ' + JSON.stringify(createData2));
  console.log('✓ Auto-semester hardware terminal registered successfully:', createData2.data);

  // Verify devices list in GET /api/v1/hod/devices
  console.log('\n[Step 4] Verifying registered devices in GET /api/v1/hod/devices...');
  const listRes = await fetch(`${BASE_URL}/hod/devices`, {
    headers: { Authorization: `Bearer ${hodToken}` }
  });
  const listData = await listRes.json();
  if (!listData.success) throw new Error('HOD devices fetch failed: ' + JSON.stringify(listData));

  const dev1 = listData.data.find(d => d.device_uid === testUid1);
  if (!dev1) throw new Error(`Device ${testUid1} not found in listing`);
  console.log(`  Found ${testUid1}:`, {
    assigned_years: dev1.assigned_years,
    assigned_semesters: dev1.assigned_semesters,
    cohort_scope_label: dev1.cohort_scope_label
  });

  if (!dev1.assigned_years.includes(1) || !dev1.assigned_years.includes(2) || !dev1.assigned_years.includes(3)) {
    throw new Error('Expected assigned_years to include [1, 2, 3]');
  }

  const dev2 = listData.data.find(d => d.device_uid === testUid2);
  if (!dev2) throw new Error(`Device ${testUid2} not found in listing`);
  console.log(`  Found ${testUid2} (auto-derived semesters):`, {
    assigned_years: dev2.assigned_years,
    assigned_semesters: dev2.assigned_semesters,
    cohort_scope_label: dev2.cohort_scope_label
  });

  // Verify backend automatically computed semesters: [1, 2, 3, 4] for years [1, 2]
  if (!dev2.assigned_semesters.includes(1) || !dev2.assigned_semesters.includes(2) || !dev2.assigned_semesters.includes(3) || !dev2.assigned_semesters.includes(4)) {
    throw new Error(`Expected auto-derived semesters [1, 2, 3, 4], got: ${JSON.stringify(dev2.assigned_semesters)}`);
  }
  console.log('✓ Verified: Backend accurately auto-calculated semesters [1, 2, 3, 4] for Years 1 & 2!');

  // Cleanup test devices
  console.log('\n[Step 5] Cleaning up test hardware devices...');
  await fetch(`${BASE_URL}/hod/devices/${dev1.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${hodToken}` } });
  await fetch(`${BASE_URL}/hod/devices/${dev2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${hodToken}` } });
  console.log('✓ Cleaned up test devices successfully.');

  console.log('\n================================================================');
  console.log(' ALL MULTI-YEAR HARDWARE & ARCHIVE CSS TESTS PASSED! 🎉');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
