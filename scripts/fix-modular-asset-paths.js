/**
 * Script to fix relative CSS & JS paths in all modular index.html files
 * Replaces ./page.css with /section/page/page.css and ./page.js with /section/page/page.js
 */
const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '../../frontend');
const sections = ['faculty', 'student', 'admin', 'login'];

let fixedCount = 0;

sections.forEach(section => {
  const secDir = path.join(frontendDir, section);
  if (!fs.existsSync(secDir)) return;

  const pages = fs.readdirSync(secDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  pages.forEach(page => {
    const indexPath = path.join(secDir, page, 'index.html');
    if (!fs.existsSync(indexPath)) return;

    let content = fs.readFileSync(indexPath, 'utf8');

    // Replace ./page.css with /section/page/page.css
    const cssRegex = new RegExp(`href=["']\\./${page}\\.css(?:\\?[^"']*)?["']`, 'g');
    content = content.replace(cssRegex, `href="/${section}/${page}/${page}.css?v=20261003"`);

    // Replace ./page.js with /section/page/page.js
    const jsRegex = new RegExp(`src=["']\\./${page}\\.js(?:\\?[^"']*)?["']`, 'g');
    content = content.replace(jsRegex, `src="/${section}/${page}/${page}.js?v=20261003"`);

    fs.writeFileSync(indexPath, content, 'utf8');
    fixedCount++;
    console.log(`✓ Fixed asset paths in ${section}/${page}/index.html`);
  });
});

console.log(`\nSuccessfully fixed asset paths in ${fixedCount} pages!`);
