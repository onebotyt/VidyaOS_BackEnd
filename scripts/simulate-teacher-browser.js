const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function testPages() {
  console.log('--- Testing Pure Teacher JSDOM Page Simulation ---');
  
  const facultyDir = path.join(__dirname, '../../frontend/faculty');
  const jsDir = path.join(__dirname, '../../frontend/js');
  
  const user = {
    id: 3,
    teacher_id: 3,
    full_name: 'Prof. Amit Verma',
    username: 'teacher@gmail.com',
    email: 'teacher@gmail.com',
    roles: ['TEACHER'],
    has_assigned_subjects: false,
    is_hod: false,
    is_class_teacher: false
  };

  const authJsCode = fs.readFileSync(path.join(jsDir, 'auth.js'), 'utf8');

  // 1. Test dashboard.html
  {
    const html = fs.readFileSync(path.join(facultyDir, 'dashboard.html'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000/faculty/dashboard.html',
      beforeParse(window) {
        window.localStorage.setItem('user', JSON.stringify(user));
        window.localStorage.setItem('access_token', 'mock_token');
        window.eval(authJsCode);
        window.fetchApi = async (url) => {
          if (url === '/faculty/registers') return { success: true, data: [] };
          if (url === '/leave?status=PENDING') return { success: true, data: [] };
          return { success: true, data: [] };
        };
        window.fetch = async () => ({ ok: false, status: 403 });
      }
    });

    await dom.window.initDashboard();

    const doc = dom.window.document;
    const regTile = doc.getElementById('teaching-registers-tile');
    const assignTile = doc.getElementById('teaching-assignments-tile');
    const repTile = doc.getElementById('teaching-reports-tile');
    const noSubBanner = doc.getElementById('no-subjects-banner');

    assert.strictEqual(regTile.style.display, 'none', 'Register tile should be hidden');
    assert.strictEqual(assignTile.style.display, 'none', 'Assignment tile should be hidden');
    assert.strictEqual(repTile.style.display, 'none', 'Reports tile should be hidden');
    assert.strictEqual(noSubBanner.style.display, 'block', 'No subjects banner should be visible');
    console.log('✓ dashboard.html: Teaching tiles hidden, banner displayed');

    // Check navigation drawer
    dom.window.renderHamburgerNav();
    const drawer = doc.getElementById('app-nav-backdrop');
    assert(drawer, 'Drawer should exist');
    const drawerText = drawer.innerHTML;
    assert(!drawerText.includes('Take Attendance & Registers'), 'Drawer should not contain Registers');
    assert(!drawerText.includes('Assignments & Test Marks'), 'Drawer should not contain Assignments');
    assert(!drawerText.includes('Attendance Reports & Analytics'), 'Drawer should not contain Reports');
    assert(!drawerText.includes('My Students (Cohort)'), 'Drawer should not contain Cohort for non-class-teacher');
    console.log('✓ auth.js drawer: All subject & cohort links hidden for teacher without subjects');
  }

  // 2. Test registers.html
  {
    const html = fs.readFileSync(path.join(facultyDir, 'registers.html'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000/faculty/registers.html',
      beforeParse(window) {
        window.localStorage.setItem('user', JSON.stringify(user));
        window.localStorage.setItem('access_token', 'mock_token');
        window.eval(authJsCode);
        window.fetchApi = async (url) => {
          if (url === '/faculty/registers') return { success: true, data: [] };
          return { success: true, data: [] };
        };
      }
    });

    await dom.window.loadRegistersList();

    const doc = dom.window.document;
    const containerText = doc.getElementById('view-cards-container').innerHTML;
    assert(containerText.includes('No Teaching Registers Allocated Yet'), 'registers.html should show empty banner');
    assert(containerText.includes('← Back to Dashboard'), 'registers.html should offer back to dashboard');
    console.log('✓ registers.html: Empty state banner displayed');
  }

  // 3. Test assignments.html
  {
    const html = fs.readFileSync(path.join(facultyDir, 'assignments.html'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000/faculty/assignments.html',
      beforeParse(window) {
        window.localStorage.setItem('user', JSON.stringify(user));
        window.localStorage.setItem('access_token', 'mock_token');
        window.eval(authJsCode);
        window.fetchApi = async (url) => {
          if (url === '/faculty/my-classes') return { success: true, data: [] };
          return { success: true, data: [] };
        };
      }
    });

    const hasClasses = await dom.window.loadClasses();
    assert.strictEqual(hasClasses, false, 'hasClasses should be false');

    const doc = dom.window.document;
    const mainText = doc.querySelector('main.container').innerHTML;
    assert(mainText.includes('No Teaching Classes Assigned Yet'), 'assignments.html should show empty banner');
    assert(mainText.includes('← Back to Dashboard'), 'assignments.html should offer back to dashboard');
    console.log('✓ assignments.html: Empty state banner displayed');
  }

  // 4. Test reports.html
  {
    const html = fs.readFileSync(path.join(facultyDir, 'reports.html'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000/faculty/reports.html',
      beforeParse(window) {
        window.localStorage.setItem('user', JSON.stringify(user));
        window.localStorage.setItem('access_token', 'mock_token');
        window.eval(authJsCode);
        window.fetchApi = async (url) => {
          if (url === '/reports/analytics') return { success: true, data: { classes: [], defaulter_count: 0 } };
          return { success: true, data: [] };
        };
      }
    });

    await dom.window.loadAnalytics();

    const doc = dom.window.document;
    const mainText = doc.querySelector('main.container').innerHTML;
    assert(mainText.includes('No Teaching Subjects Allocated Yet'), 'reports.html should show empty banner');
    assert(mainText.includes('← Back to Dashboard'), 'reports.html should offer back to dashboard');
    console.log('✓ reports.html: Empty state banner displayed');
  }

  console.log('🎉 ALL JSDOM SIMULATIONS PASSED 100%!');
}

testPages().catch(err => {
  console.error('❌ JSDOM Test failed:', err);
  process.exit(1);
});
