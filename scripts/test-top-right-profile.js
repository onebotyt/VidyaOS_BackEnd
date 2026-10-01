const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

async function testTopRightProfile() {
  console.log('=== VERIFYING TOP-RIGHT PROFILE & SIDE NAV REMOVAL ===\n');

  // Read auth.js
  const authJsPath = path.join(__dirname, '../../frontend/shared/js/auth.js');
  const authJs = fs.readFileSync(authJsPath, 'utf-8');

  // Verify side nav drawer does NOT contain profile links
  if (authJs.includes("label: 'Admin Profile'") ||
      authJs.includes("label: 'My Profile & Google'") ||
      authJs.includes("label: 'My Profile & Password'")) {
    throw new Error('Profile links still present in drawer navItems!');
  }
  console.log('✓ Verified: Profile links successfully removed from side navigation drawer (navItems)');

  // Verify renderUserNav creates top-profile-pill
  if (!authJs.includes('top-profile-pill') || !authJs.includes('top-profile-avatar') || !authJs.includes('top-logout-btn')) {
    throw new Error('renderUserNav missing top-profile-pill or top-logout-btn');
  }
  console.log('✓ Verified: renderUserNav creates executive .top-profile-pill with avatar, role chip, and .top-logout-btn');

  // Test JSDOM execution of auth.js for all three roles
  const testCases = [
    {
      role: 'TEACHER',
      user: { id: 2, username: 'hod@gmail.com', full_name: 'Prof. Amit Verma', roles: ['TEACHER'], is_hod: 1 },
      expectedHref: '/faculty/profile.html',
      expectedRoleText: 'HOD',
      expectedInitials: 'AV'
    },
    {
      role: 'TEACHER',
      user: { id: 3, username: 'classteacher@gmail.com', full_name: 'Prof. Priya Mehta', roles: ['TEACHER'], is_class_teacher: 1 },
      expectedHref: '/faculty/profile.html',
      expectedRoleText: 'Class Teacher',
      expectedInitials: 'PM'
    },
    {
      role: 'STUDENT',
      user: { id: 5, username: 'student1@gmail.com', full_name: 'Aarav Sharma', roles: ['STUDENT'] },
      expectedHref: '/student/profile.html',
      expectedRoleText: 'Student',
      expectedInitials: '🎓'
    },
    {
      role: 'SYSTEM_ADMIN',
      user: { id: 1, username: 'admin@gmail.com', full_name: 'System Administrator', roles: ['SYSTEM_ADMIN'] },
      expectedHref: '/admin/profile.html',
      expectedRoleText: 'Admin',
      expectedInitials: 'SA'
    }
  ];

  for (const tc of testCases) {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <header class="app-header">
            <div id="user-nav" class="user-nav"></div>
          </header>
        </body>
      </html>
    `, {
      url: 'http://localhost:3000/faculty/dashboard.html',
      runScripts: 'dangerously'
    });

    // Mock localStorage and window
    dom.window.localStorage.setItem('access_token', 'mock_token');
    dom.window.localStorage.setItem('user', JSON.stringify(tc.user));

    // Execute auth.js in the DOM
    dom.window.eval(authJs);

    // Run renderUserNav
    dom.window.renderUserNav();

    const userNav = dom.window.document.getElementById('user-nav');
    const profileBtn = userNav.querySelector('#top-profile-btn');
    const dropdownMenu = userNav.querySelector('#user-dropdown-menu');
    const profileLink = userNav.querySelector('.user-dropdown-item[href]');
    const logoutBtn = userNav.querySelector('.top-logout-btn');
    const themeBtn = userNav.querySelector('button[onclick*="toggleAppTheme"]');
    const quickPassBtn = userNav.querySelector('button[onclick*="openQuickPasswordModal"]');

    if (!profileBtn) throw new Error(`Missing #top-profile-btn for role ${tc.role}`);
    if (!dropdownMenu) throw new Error(`Missing #user-dropdown-menu for role ${tc.role}`);
    if (!profileLink) throw new Error(`Missing profile link in dropdown for role ${tc.role}`);
    if (!logoutBtn) throw new Error(`Missing .top-logout-btn for role ${tc.role}`);
    if (!themeBtn) throw new Error(`Missing theme toggle button for role ${tc.role}`);
    if (!quickPassBtn) throw new Error(`Missing quick password button for role ${tc.role}`);

    const href = profileLink.getAttribute('href');
    if (href !== tc.expectedHref) {
      throw new Error(`Expected href ${tc.expectedHref}, got ${href} for role ${tc.role}`);
    }

    const roleChip = profileBtn.querySelector('.top-profile-chip');
    if (!roleChip || roleChip.textContent.trim() !== tc.expectedRoleText) {
      throw new Error(`Expected role chip ${tc.expectedRoleText}, got ${roleChip?.textContent} for role ${tc.role}`);
    }

    const avatarSpan = profileBtn.querySelector('.top-profile-avatar span');
    if (!avatarSpan || avatarSpan.textContent.trim() !== tc.expectedInitials) {
      throw new Error(`Expected avatar initials ${tc.expectedInitials}, got ${avatarSpan?.textContent} for role ${tc.role}`);
    }

    console.log(`✓ Role [${tc.expectedRoleText}]: Top-Right Profile correctly rendered:`);
    console.log(`   - Dropdown Target: ${href}`);
    console.log(`   - Avatar: ${tc.expectedInitials}`);
    console.log(`   - Name: ${tc.user.full_name}`);
  }

  console.log('\n======================================================================');
  console.log('🎉 TOP-RIGHT PROFILE WIDGET & FLOATING DROPDOWN VERIFIED SUCCESSFULLY!');
  console.log('======================================================================\n');
  process.exit(0);
}

testTopRightProfile().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
