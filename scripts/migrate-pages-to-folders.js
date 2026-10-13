/**
 * ══════════════════════════════════════════════════════════════
 * SCRIPT: MIGRATE ALL PAGES TO MODULAR FOLDER-PER-PAGE ARCHITECTURE
 * Creates dedicated folder for every page with index.html, [page].css, [page].js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const facultyDir = path.join(__dirname, '../../frontend/faculty');

const facultyPages = [
  'dashboard',
  'registers',
  'group-detail',
  'sheets',
  'tests',
  'timetable',
  'students',
  'profile',
  'groups',
  'reports',
  'evaluation',
  'leave-approvals',
  'common-teachers',
  'hod-teachers',
  'hod-students',
  'hod-devices',
  'hod-reports',
  'hod-settings',
  'hod-archive'
];

facultyPages.forEach(pageName => {
  const htmlFile = path.join(facultyDir, `${pageName}.html`);
  if (!fs.existsSync(htmlFile)) {
    console.log(`Skipping ${pageName}.html (not found)`);
    return;
  }

  const content = fs.readFileSync(htmlFile, 'utf8');
  const targetDir = path.join(facultyDir, pageName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Extract CSS
  const styleMatches = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  let extractedCss = `/* ══════════════════════════════════════════════════════════════\n   PAGE STYLES: ${pageName.toUpperCase()}\n   frontend/faculty/${pageName}/${pageName}.css\n══════════════════════════════════════════════════════════════ */\n\n`;
  styleMatches.forEach(m => {
    extractedCss += m[1].trim() + '\n\n';
  });

  // 2. Extract Page JS
  const scriptMatches = [...content.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
  let extractedJs = `/**\n * ══════════════════════════════════════════════════════════════\n * PAGE LOGIC: ${pageName.toUpperCase()}\n * frontend/faculty/${pageName}/${pageName}.js\n * ══════════════════════════════════════════════════════════════\n */\n\n`;
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

  console.log(`✅ Created modular package for: faculty/${pageName}/ (index.html, ${pageName}.css, ${pageName}.js)`);
});

console.log('\nAll faculty pages successfully converted to folder-per-page structure!');
