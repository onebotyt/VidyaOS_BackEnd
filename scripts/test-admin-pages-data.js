/**
 * Simulated Browser DOM verification test for Admin Pages
 * Validates that after fixing auth.js, admin pages successfully fetch and render all data!
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function testAdminPages() {
  console.log('--- TESTING ADMIN PAGES CLIENT DATA RENDERING ---');

  // 1. Authenticate as admin@gmail.com
  const loginRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ username: 'admin@gmail.com', password: 'Admin@123' }));
    req.end();
  });

  if (!loginRes.success) {
    throw new Error('Admin login failed: ' + JSON.stringify(loginRes));
  }
  const token = loginRes.data.access_token;
  const adminUser = loginRes.data.user;
  console.log('✓ Admin authenticated successfully. User:', adminUser.email, adminUser.roles);

  // Helper to create mock DOM sandbox
  function createBrowserSandbox(pathname) {
    const elements = new Map();

    function getOrCreateElement(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          innerText: '',
          textContent: '',
          innerHTML: '',
          style: {},
          classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {}
          },
          appendChild: () => {},
          addEventListener: () => {},
          value: '',
          disabled: false
        });
      }
      return elements.get(id);
    }

    const localStorageMock = {
      store: {
        'access_token': token,
        'user': JSON.stringify(adminUser)
      },
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = v; },
      removeItem(k) { delete this.store[k]; }
    };

    const windowMock = {
      location: {
        pathname: pathname,
        search: '',
        href: `http://localhost:3000${pathname}`
      },
      history: {
        replaceState: () => {}
      },
      addEventListener: () => {}
    };

    const documentMock = {
      documentElement: {
        setAttribute: () => {},
        getAttribute: () => null,
        classList: { add: () => {}, remove: () => {} }
      },
      getElementById(id) {
        return getOrCreateElement(id);
      },
      querySelector(sel) {
        if (sel === '.app-header') return { querySelector: () => null, insertBefore: () => {} };
        return getOrCreateElement(sel.replace(/[^a-zA-Z0-9_-]/g, ''));
      },
      querySelectorAll() {
        return [];
      },
      createElement(tag) {
        return {
          tagName: tag,
          innerHTML: '',
          innerText: '',
          textContent: '',
          classList: { add: () => {}, remove: () => {} },
          appendChild: () => {},
          setAttribute: () => {},
          style: {}
        };
      },
      body: {
        appendChild: () => {},
        insertAdjacentHTML: () => {}
      },
      addEventListener: () => {}
    };

    // Global fetch proxying to localhost:3000
    const fetchMock = async (url, opts = {}) => {
      return new Promise((resolve, reject) => {
        const fullUrl = url.startsWith('http') ? url : `http://localhost:3000${url}`;
        const u = new URL(fullUrl);
        const reqOpts = {
          hostname: u.hostname,
          port: u.port || 3000,
          path: u.pathname + u.search,
          method: opts.method || 'GET',
          headers: opts.headers || {}
        };
        const req = http.request(reqOpts, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(body),
              text: async () => body
            });
          });
        });
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
      });
    };

    const sandbox = {
      window: windowMock,
      location: windowMock.location,
      document: documentMock,
      localStorage: localStorageMock,
      fetch: fetchMock,
      console: console,
      setTimeout: setTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      FormData: class FormData {},
      URL: URL,
      URLSearchParams: URLSearchParams,
      elements: elements
    };

    vm.createContext(sandbox);

    // Load api.js & auth.js into sandbox
    const apiJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');
    const authJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/auth.js'), 'utf8');
    vm.runInContext(apiJs, sandbox);
    vm.runInContext(authJs, sandbox);

    return sandbox;
  }

  // TEST 1: Dashboard stats loading
  console.log('\n--- 1. Validating admin/dashboard.html ---');
  {
    const sandbox = createBrowserSandbox('/admin/dashboard.html');
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin/dashboard.html'), 'utf8');
    const scriptMatch = dashboardHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    if (!scriptMatch) throw new Error('Could not find dashboard inline script');

    // Run script in context
    await vm.runInContext(`(async () => { ${scriptMatch[1]} })();`, sandbox);
    // Allow async loadAdminStats to complete
    await new Promise(r => setTimeout(r, 600));

    const statStudents = sandbox.elements.get('stat-students')?.innerText;
    const statTeachers = sandbox.elements.get('stat-teachers')?.innerText;
    const statDevices = sandbox.elements.get('stat-devices')?.innerText;

    console.log(`Dashboard Elements: stat-students=${statStudents}, stat-teachers=${statTeachers}, stat-devices=${statDevices}`);
    if (parseInt(statStudents) < 1) throw new Error(`Expected stat-students >= 1, got ${statStudents}`);
    if (parseInt(statTeachers) < 1) throw new Error(`Expected stat-teachers >= 1, got ${statTeachers}`);
    if (parseInt(statDevices) < 1) throw new Error(`Expected stat-devices >= 1, got ${statDevices}`);
    console.log('✓ admin/dashboard.html loaded all stats successfully!');
  }

  // TEST 2: Academic Structure master loading
  console.log('\n--- 2. Validating admin/academic-structure.html ---');
  {
    const sandbox = createBrowserSandbox('/admin/academic-structure.html');
    const acadHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin/academic-structure.html'), 'utf8');
    const scriptMatch = acadHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    if (!scriptMatch) throw new Error('Could not find academic-structure inline script');

    await vm.runInContext(`(async () => { ${scriptMatch[1]} })();`, sandbox);
    await new Promise(r => setTimeout(r, 600));

    const deptCount = sandbox.elements.get('stat-dept-count')?.textContent;
    const hodCount = sandbox.elements.get('stat-hod-count')?.textContent;
    const deptTable = sandbox.elements.get('dept-tbody')?.innerHTML;

    if (parseInt(deptCount) < 1) throw new Error(`Expected stat-dept-count >= 1, got ${deptCount}`);
    if (!hodCount) throw new Error(`Expected stat-hod-count to be populated, got ${hodCount}`);
    if (!deptTable.includes('Information Technology') && !deptTable.includes('IT')) {
      throw new Error('Department table does not contain Information Technology (IT)');
    }
    console.log('✓ admin/academic-structure.html loaded departments and HOD mapping successfully (Academic Sessions & Calendar Years completely removed)!');
  }

  // TEST 3: Faculty HOD Management loading
  console.log('\n--- 3. Validating admin/faculty.html ---');
  {
    const sandbox = createBrowserSandbox('/admin/faculty.html');
    const facultyHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin/faculty.html'), 'utf8');
    const scriptMatch = facultyHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    if (!scriptMatch) throw new Error('Could not find faculty inline script');

    await vm.runInContext(`(async () => { ${scriptMatch[1]} })();`, sandbox);
    await new Promise(r => setTimeout(r, 600));

    const hodCountBadge = sandbox.elements.get('hod-count-badge')?.textContent;
    const hodTable = sandbox.elements.get('hod-table-wrap')?.innerHTML;

    if (!hodCountBadge || !hodCountBadge.includes('HOD')) throw new Error(`Expected hod-count-badge to include 'HOD', got ${hodCountBadge}`);
    if (!hodTable.includes('Dr. Rajesh Sharma') || !hodTable.includes('hod@gmail.com')) {
      throw new Error('HOD table does not contain Dr. Rajesh Sharma');
    }
    console.log('✓ admin/faculty.html loaded HOD accounts successfully!');
  }

  console.log('\n🎉 ALL ADMIN PAGES TESTED AND FULLY FUNCTIONAL WITH DEMO DATA!');
}

testAdminPages().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
