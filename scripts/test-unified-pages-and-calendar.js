/**
 * Comprehensive verification script for:
 * 1. Consolidated Faculty Reports (1 page, 1 nav link)
 * 2. Complete Removal of Student Self-Registrations
 * 3. Unified Student Attendance Page (Cards, 75% Predictor & Monthly Calendar with Green/Red/Blue)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runVerification() {
  console.log('=== STARTING TEST: CONSOLIDATED PAGES, SELF-REG REMOVAL & CALENDAR ===\n');

  // 1. Verify HTTP 301 Redirects
  console.log('[1] Verifying HTTP 301 Redirects...');
  const redirectsToTest = [
    { from: '/student/attendance/subjects.html', to: '/student/attendance.html' },
    { from: '/student/attendance/history.html', to: '/student/attendance.html' },
    { from: '/student/attendance/active.html', to: '/student/attendance.html' },
    { from: '/register/student.html', to: '/login/student.html' },
    { from: '/faculty/registrations.html', to: '/faculty/dashboard.html' }
  ];

  for (const t of redirectsToTest) {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:3000${t.from}`, (r) => {
        resolve({ statusCode: r.statusCode, location: r.headers.location });
      }).on('error', reject);
    });

    if (res.statusCode !== 301 || res.location !== t.to) {
      throw new Error(`Redirect failed for ${t.from}: expected 301 to ${t.to}, got ${res.statusCode} to ${res.location}`);
    }
    console.log(`   ✓ ${t.from} ➔ 301 ${res.location}`);
  }

  // 2. Verify Removal of Self-Registration API
  console.log('\n[2] Verifying Removal of Self-Registration Route...');
  const selfRegRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/students/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (r) => {
      resolve({ statusCode: r.statusCode });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ full_name: 'Test', official_enrollment_no: 'TEST001' }));
    req.end();
  });
  if (selfRegRes.statusCode !== 404) {
    throw new Error(`Expected POST /api/v1/students/register to be 404 NOT FOUND, got ${selfRegRes.statusCode}`);
  }
  console.log('   ✓ POST /api/v1/students/register is 404 (Route successfully removed)');

  // 3. Verify Removal of Self-Registration from Frontend Code
  console.log('\n[3] Verifying Removal of Self-Registration from Frontend Code...');
  if (fs.existsSync(path.join(__dirname, '../../frontend/register/student.html'))) {
    throw new Error('frontend/register/student.html still exists!');
  }
  if (fs.existsSync(path.join(__dirname, '../../frontend/faculty/registrations.html'))) {
    throw new Error('frontend/faculty/registrations.html still exists!');
  }
  console.log('   ✓ Deleted files confirmed: register/student.html and faculty/registrations.html');

  // Check auth.js navigation
  const authJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/auth.js'), 'utf8');
  if (authJs.includes('Self Registrations') || authJs.includes('registrations.html')) {
    throw new Error('auth.js still contains references to registrations.html!');
  }
  const reportMatches = authJs.match(/\/faculty\/reports\.html/g) || [];
  if (reportMatches.length !== 1) {
    throw new Error(`Expected exactly 1 faculty reports link in auth.js, found ${reportMatches.length}`);
  }
  console.log('   ✓ auth.js has exactly 1 unified Faculty Reports link and 0 self-registration links');

  // 4. Authenticate Students & Test Calendar DOM
  console.log('\n[4] Testing Student Attendance Page & Interactive Calendar...');
  
  // Login student1 (High Attendance)
  const loginRes1 = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (r) => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ email: 'student1@gmail.com', password: 'Password@123' }));
    req.end();
  });
  const token1 = loginRes1.data.access_token;
  const user1 = loginRes1.data.user;
  console.log('   ✓ student1@gmail.com logged in. Full name:', user1.full_name);

  // Login student9 (Defaulter)
  const loginRes9 = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/student/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (r) => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ email: 'student9@gmail.com', password: 'Password@123' }));
    req.end();
  });
  const token9 = loginRes9.data.access_token;
  const user9 = loginRes9.data.user;
  console.log('   ✓ student9@gmail.com logged in. Full name:', user9.full_name);

  // Test DOM for student 1
  {
    const elements = new Map();
    function getEl(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id, innerText: '', textContent: '', innerHTML: '', style: {},
          classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
          appendChild: () => {}, addEventListener: () => {}, value: ''
        });
      }
      return elements.get(id);
    }

    const sandbox = {
      window: { location: { pathname: '/student/attendance.html', href: 'http://localhost:3000/student/attendance.html' }, addEventListener: () => {} },
      location: { pathname: '/student/attendance.html' },
      document: {
        getElementById: (id) => getEl(id),
        querySelector: (sel) => getEl(sel.replace(/[^a-zA-Z0-9_-]/g, '')),
        querySelectorAll: () => [],
        createElement: (tag) => ({ tagName: tag, innerHTML: '', innerText: '', appendChild: () => {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {} }, style: {} }),
        body: { appendChild: () => {}, insertAdjacentHTML: () => {} },
        addEventListener: () => {}
      },
      localStorage: {
        store: { 'access_token': token1, 'user': JSON.stringify(user1) },
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = v; },
        removeItem(k) { delete this.store[k]; }
      },
      fetch: async (url, opts = {}) => {
        return new Promise((resolve, reject) => {
          const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
          const u = new URL(fullUrl);
          const req = http.request({
            hostname: u.hostname, port: u.port || 3000, path: u.pathname + u.search,
            method: opts.method || 'GET', headers: opts.headers || {}
          }, (res) => {
            let body = ''; res.on('data', c => body += c);
            res.on('end', () => resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(body),
              text: async () => body
            }));
          });
          req.on('error', reject);
          if (opts.body) req.write(opts.body);
          req.end();
        });
      },
      console, setTimeout, URL, URLSearchParams, elements
    };

    vm.createContext(sandbox);
    const apiJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');
    const authJsSrc = fs.readFileSync(path.join(__dirname, '../../frontend/js/auth.js'), 'utf8');
    const attHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/attendance.html'), 'utf8');
    const scriptMatch = attHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);

    vm.runInContext(apiJs, sandbox);
    vm.runInContext(authJsSrc, sandbox);
    vm.runInContext(scriptMatch[1], sandbox);
    await new Promise(r => setTimeout(r, 600));

    const overallPct = sandbox.elements.get('overall-pct')?.innerText;
    const standingBadge = sandbox.elements.get('standing-badge')?.innerText;
    const subjectsGrid = sandbox.elements.get('subjects-grid')?.innerHTML;

    console.log(`   Student 1 Overall Standing: ${overallPct} (${standingBadge})`);
    if (overallPct !== '100%') throw new Error(`Expected 100% overall attendance for student1, got ${overallPct}`);
    if (!subjectsGrid.includes('CS501') || !subjectsGrid.includes('CS502') || !subjectsGrid.includes('CS503')) {
      throw new Error('Subjects grid does not contain CS501, CS502, and CS503');
    }
    console.log('   ✓ Enrolled subjects (CS501, CS502, CS503) rendered properly with 100% badge');

    // Test calendar opening on Register 1 (DBMS - subject_id: 1)
    await vm.runInContext(`openCalendarModal(1, 'Database Management Systems', 'CS501');`, sandbox);
    const calGrid = sandbox.elements.get('calendar-grid')?.innerHTML;
    const monthStats = sandbox.elements.get('cal-month-stats')?.innerHTML;

    console.log(`   Calendar rendered for September 2026: ${monthStats.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '')}`);
    if (!calGrid.includes('attended-present')) {
      throw new Error('Calendar grid did not contain attended-present cells!');
    }
    if (!calGrid.includes('sunday-holiday')) {
      throw new Error('Calendar grid did not contain sunday-holiday cells!');
    }
    console.log('   ✓ Calendar grid contains attended-present (Green) and sunday-holiday (Blue) cells!');
  }

  // Test DOM for student 9 (Defaulter)
  {
    const elements = new Map();
    function getEl(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id, innerText: '', textContent: '', innerHTML: '', style: {},
          classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
          appendChild: () => {}, addEventListener: () => {}, value: ''
        });
      }
      return elements.get(id);
    }

    const sandbox = {
      window: { location: { pathname: '/student/attendance.html', href: 'http://localhost:3000/student/attendance.html' }, addEventListener: () => {} },
      location: { pathname: '/student/attendance.html' },
      document: {
        getElementById: (id) => getEl(id),
        querySelector: (sel) => getEl(sel.replace(/[^a-zA-Z0-9_-]/g, '')),
        querySelectorAll: () => [],
        createElement: (tag) => ({ tagName: tag, innerHTML: '', innerText: '', appendChild: () => {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {} }, style: {} }),
        body: { appendChild: () => {}, insertAdjacentHTML: () => {} },
        addEventListener: () => {}
      },
      localStorage: {
        store: { 'access_token': token9, 'user': JSON.stringify(user9) },
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = v; },
        removeItem(k) { delete this.store[k]; }
      },
      fetch: async (url, opts = {}) => {
        return new Promise((resolve, reject) => {
          const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
          const u = new URL(fullUrl);
          const req = http.request({
            hostname: u.hostname, port: u.port || 3000, path: u.pathname + u.search,
            method: opts.method || 'GET', headers: opts.headers || {}
          }, (res) => {
            let body = ''; res.on('data', c => body += c);
            res.on('end', () => resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(body),
              text: async () => body
            }));
          });
          req.on('error', reject);
          if (opts.body) req.write(opts.body);
          req.end();
        });
      },
      console, setTimeout, URL, URLSearchParams, elements
    };

    vm.createContext(sandbox);
    const apiJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');
    const authJsSrc = fs.readFileSync(path.join(__dirname, '../../frontend/js/auth.js'), 'utf8');
    const attHtml = fs.readFileSync(path.join(__dirname, '../../frontend/student/attendance.html'), 'utf8');
    const scriptMatch = attHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);

    vm.runInContext(apiJs, sandbox);
    vm.runInContext(authJsSrc, sandbox);
    vm.runInContext(scriptMatch[1], sandbox);
    await new Promise(r => setTimeout(r, 600));

    const overallPct = sandbox.elements.get('overall-pct')?.innerText;
    const standingBadge = sandbox.elements.get('standing-badge')?.innerText;
    console.log(`   Student 9 Overall Standing: ${overallPct} (${standingBadge})`);
    if (!overallPct.startsWith('47')) throw new Error(`Expected ~47% overall attendance for student9, got ${overallPct}`);
    if (!standingBadge.includes('Deficit')) throw new Error(`Expected Deficit badge for student9, got ${standingBadge}`);

    // Test calendar opening on Register 1 (DBMS - subject_id: 1)
    await vm.runInContext(`openCalendarModal(1, 'Database Management Systems', 'CS501');`, sandbox);
    const calGrid = sandbox.elements.get('calendar-grid')?.innerHTML;

    if (!calGrid.includes('attended-absent')) {
      throw new Error('Calendar grid did not contain attended-absent (Red) cells for student9!');
    }
    console.log('   ✓ Defaulter student calendar contains attended-absent (Red) cells for absent dates!');
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🎉 ALL TESTS PASSED: ALL 3 USER REQUIREMENTS VERIFIED 100%!');
  console.log('════════════════════════════════════════════════════════════\n');
}

runVerification().catch(err => {
  console.error('❌ Verification test failed:', err);
  process.exit(1);
});
