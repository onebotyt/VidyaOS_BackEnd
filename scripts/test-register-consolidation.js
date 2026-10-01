const http = require('http');
const fs = require('fs');
const path = require('path');

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: body
      }));
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runTests() {
  console.log('=== RUNNING CONSOLIDATION TESTS: REGISTERS WORKSPACE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name}`);
      failed++;
    }
  }

  try {
    // 1. Test Routing Architecture (Standalone Pages & Legacy Redirects)
    console.log('--- 1. HTTP Routing & 301 Redirect Tests ---');
    const r1 = await request('/faculty/assignments.html');
    assert(r1.statusCode === 200, 'GET /faculty/assignments.html returns 200 OK (standalone coursework page)');

    const r2 = await request('/faculty/assignments');
    assert(r2.statusCode === 301, 'GET /faculty/assignments returns 301 redirect');
    assert(r2.headers.location === '/faculty/assignments.html', `Location header matches /faculty/assignments.html (got ${r2.headers.location})`);

    const r3 = await request('/faculty/tests.html');
    assert(r3.statusCode === 200, 'GET /faculty/tests.html returns 200 OK (standalone tests studio page)');

    const r4 = await request('/faculty/marks.html');
    assert(r4.statusCode === 301, 'GET /faculty/marks.html returns 301 redirect to tests');
    assert(r4.headers.location.startsWith('/faculty/tests.html'), `Location header redirects to /faculty/tests.html (got ${r4.headers.location})`);

    const r5 = await request('/faculty/marks.html?id=7');
    assert(r5.statusCode === 301, 'GET /faculty/marks.html?id=7 returns 301');
    assert(r5.headers.location === '/faculty/tests.html?id=7', `Location header preserves id in marks redirect (got ${r5.headers.location})`);

    // 2. Test Login & Scoped API Filtering
    console.log('\n--- 2. Scoped API Filtering Tests ---');
    const loginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
    });
    const loginData = JSON.parse(loginRes.body);
    assert(loginData.success === true, 'Teacher login successful');
    const token = loginData.data?.access_token || loginData.data?.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const regRes = await request('/api/v1/faculty/registers', { headers: authHeaders });
    const regData = JSON.parse(regRes.body);
    assert(regData.success === true && Array.isArray(regData.data), 'GET /faculty/registers returns registers list');

    if (regData.data.length > 0) {
      const reg = regData.data[0];
      const assignRes = await request(`/api/v1/assignments?subject_id=${reg.subject_id}`, { headers: authHeaders });
      const assignData = JSON.parse(assignRes.body);
      assert(assignRes.statusCode === 200 && assignData.success === true, 'GET /assignments?subject_id=... returns 200 success');

      const examRes = await request(`/api/v1/exams?subject_id=${reg.subject_id}`, { headers: authHeaders });
      const examData = JSON.parse(examRes.body);
      assert(examRes.statusCode === 200 && examData.success === true, 'GET /exams?subject_id=... returns 200 success');
    }

    // 3. Frontend DOM Verification
    console.log('\n--- 3. Frontend registers.html DOM Verification ---');
    const regHtmlPath = path.join(__dirname, '../../frontend/faculty/registers.html');
    const regHtml = fs.readFileSync(regHtmlPath, 'utf8');

    assert(regHtml.includes('id="tab-btn-matrix"'), 'registers.html contains matrix tab button');
    assert(regHtml.includes('id="tab-btn-assignments"'), 'registers.html contains assignments tab button');
    assert(regHtml.includes('id="tab-btn-exams"'), 'registers.html contains exams tab button');

    assert(regHtml.includes('id="tab-panel-matrix"'), 'registers.html contains matrix tab panel');
    assert(regHtml.includes('id="tab-panel-assignments"'), 'registers.html contains assignments tab panel');
    assert(regHtml.includes('id="tab-panel-exams"'), 'registers.html contains exams tab panel');

    assert(regHtml.includes('id="create-assignment-form"'), 'registers.html contains coursework creation form');
    assert(regHtml.includes('id="create-exam-form"'), 'registers.html contains exam creation form');
    assert(regHtml.includes('id="create-assignment-modal"'), 'registers.html contains create-assignment-modal');
    assert(regHtml.includes('id="create-exam-modal"'), 'registers.html contains create-exam-modal');
    assert(regHtml.includes('openCreateAssignmentModal'), 'registers.html contains openCreateAssignmentModal function');
    assert(regHtml.includes('openCreateExamModal'), 'registers.html contains openCreateExamModal function');
    assert(regHtml.includes('switchRegisterTab'), 'registers.html contains switchRegisterTab function');
    assert(regHtml.includes('loadRegisterAssignments'), 'registers.html contains loadRegisterAssignments function');
    assert(regHtml.includes('loadRegisterExams'), 'registers.html contains loadRegisterExams function');

    // 4. Navigation Drawer Deep Linking
    console.log('\n--- 4. Navigation Drawer Verification ---');
    const sharedAuthPath = path.join(__dirname, '../../frontend/shared/js/auth.js');
    const sharedAuth = fs.readFileSync(sharedAuthPath, 'utf8');
    assert(sharedAuth.includes("href: '/faculty/assignments.html'"), 'shared auth.js links to /faculty/assignments.html');
    assert(sharedAuth.includes("href: '/faculty/tests.html'"), 'shared auth.js links to /faculty/tests.html');

    console.log('\n--- 5. Minimized ESP32 Action Bar Verification ---');
    assert(regHtml.includes('class="esp-toolbar no-print"'), 'registers.html contains esp-toolbar');
    assert(regHtml.includes('id="btn-esp-sync"'), 'registers.html contains btn-esp-sync');
    assert(regHtml.includes('function triggerEspDaySync'), 'registers.html contains triggerEspDaySync function');
    assert(regHtml.includes('function checkEspStatus'), 'registers.html contains checkEspStatus function');
    assert(regHtml.includes('function submitEspConfirmation'), 'registers.html contains submitEspConfirmation function');

    console.log('\n--- 6. Unified Live QR & PIN Roll Call Studio Verification ---');
    assert(regHtml.includes('id="rc-tab-btn-live"'), 'registers.html contains Live QR & PIN tab button');
    assert(regHtml.includes('id="rc-tab-btn-manual"'), 'registers.html contains Manual Roll Call tab button');
    assert(regHtml.includes('id="rc-view-live"'), 'registers.html contains unified live QR & PIN view');
    assert(regHtml.includes('id="rc-qr-code-wrapper"'), 'registers.html contains dynamic QR frame');
    assert(regHtml.includes('id="rc-qr-pin-display"'), 'registers.html contains PIN display below QR code');
    assert(regHtml.includes('id="pin-digits-container"'), 'registers.html contains 6-digit PIN boxes container');
    assert(regHtml.includes('id="rc-claim-count"'), 'registers.html contains live check-in counter');
    assert(regHtml.includes('id="rc-claims-roster"'), 'registers.html contains live student check-ins roster');
    assert(regHtml.includes('function initLiveAttendanceTogether'), 'registers.html contains initLiveAttendanceTogether function');
    assert(regHtml.includes('function generateNewQr'), 'registers.html contains generateNewQr function');
    assert(regHtml.includes('function generateNewPin'), 'registers.html contains generateNewPin function');
    assert(regHtml.includes('function finalizeClaimsAttendance'), 'registers.html contains finalizeClaimsAttendance function');

    console.log(`\n========================================`);
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
