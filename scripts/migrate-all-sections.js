/**
 * ══════════════════════════════════════════════════════════════
 * SCRIPT: MIGRATE ALL SECTIONS TO MODULAR FOLDER-PER-PAGE ARCHITECTURE
 * Migrates student, admin, and login sections
 * ══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const sections = [
  {
    dir: path.join(__dirname, '../../frontend/student'),
    pages: ['assignments', 'attendance', 'dashboard', 'groups', 'leave', 'profile', 'scores', 'timetable']
  },
  {
    dir: path.join(__dirname, '../../frontend/admin'),
    pages: ['academic-structure', 'assignments', 'audit-logs', 'audit', 'dashboard', 'faculty', 'profile', 'reports', 'settings', 'students']
  },
  {
    dir: path.join(__dirname, '../../frontend/login'),
    pages: ['faculty-register', 'faculty', 'index', 'register', 'student-register', 'student']
  }
];

sections.forEach(({ dir, pages }) => {
  const sectionName = path.basename(dir);
  console.log(`\n--- Migrating ${sectionName} Pages ---`);

  pages.forEach(pageName => {
    const htmlFile = path.join(dir, `${pageName}.html`);
    if (!fs.existsSync(htmlFile)) {
      console.log(`Skipping ${sectionName}/${pageName}.html (not found)`);
      return;
    }

    const content = fs.readFileSync(htmlFile, 'utf8');
    const targetDir = path.join(dir, pageName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 1. Extract CSS
    const styleMatches = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
    let extractedCss = `/* ══════════════════════════════════════════════════════════════\n   PAGE STYLES: ${pageName.toUpperCase()}\n   frontend/${sectionName}/${pageName}/${pageName}.css\n══════════════════════════════════════════════════════════════ */\n\n`;
    styleMatches.forEach(m => {
      extractedCss += m[1].trim() + '\n\n';
    });

    // 2. Extract Page JS
    const scriptMatches = [...content.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
    let extractedJs = `/**\n * ══════════════════════════════════════════════════════════════\n * PAGE LOGIC: ${pageName.toUpperCase()}\n * frontend/${sectionName}/${pageName}/${pageName}.js\n * ══════════════════════════════════════════════════════════════\n */\n\n`;
    scriptMatches.forEach(m => {
      extractedJs += m[1].trim() + '\n\n';
    });

    // 3. Create clean index.html
    let cleanHtml = content;
    // Remove inline style blocks
    cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Remove inline script blocks (keep external src scripts)
    cleanHtml = cleanHtml.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi, '');

    // Add stylesheet link before </head>
    const cssLink = `  <link rel="stylesheet" href="/components/modal/modal.css?v=20261003">\n  <link rel="stylesheet" href="./${pageName}.css?v=20261003">\n</head>`;
    cleanHtml = cleanHtml.replace('</head>', cssLink);

    // Add component JS and page JS before </body>
    const jsScripts = `  <script src="/components/modal/modal.js?v=20261003"></script>\n  <script src="./${pageName}.js?v=20261003"></script>\n</body>`;
    cleanHtml = cleanHtml.replace('</body>', jsScripts);

    // Clean empty lines in HTML
    cleanHtml = cleanHtml.replace(/\n\s*\n\s*\n/g, '\n\n');

    // Write files
    fs.writeFileSync(path.join(targetDir, `${pageName}.css`), extractedCss, 'utf8');
    fs.writeFileSync(path.join(targetDir, `${pageName}.js`), extractedJs, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'index.html'), cleanHtml, 'utf8');

    console.log(`✅ Created modular package for: ${sectionName}/${pageName}/ (index.html, ${pageName}.css, ${pageName}.js)`);
  });
});

console.log('\nAll student, admin, and login pages successfully converted to folder-per-page structure!');
