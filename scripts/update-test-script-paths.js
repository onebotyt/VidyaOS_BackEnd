/**
 * Update test scripts to resolve HTML files from modular directories:
 * If frontend/section/page/index.html exists, read it; otherwise fallback to frontend/section/page.html
 */
const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname);
const scriptFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));

scriptFiles.forEach(file => {
  const filePath = path.join(scriptsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Pattern like: (fs.existsSync(path.join(__dirname, '../../frontend/faculty/sheets/index.html')) ? path.join(__dirname, '../../frontend/faculty/sheets/index.html') : path.join(__dirname, '../../frontend/faculty/sheets.html'))
  // or (fs.existsSync(path.join(__dirname, '../../frontend/faculty/registers/index.html')) ? path.join(__dirname, '../../frontend/faculty/registers/index.html') : path.join(repoRoot, 'frontend/faculty/registers.html'))
  const regex = /(path\.join\([^,]+,\s*['"`](?:\.\.\/\.\.\/frontend\/|frontend\/)([a-z-]+)\/([a-z-]+)\.html['"`]\))/g;

  if (regex.test(content)) {
    content = content.replace(regex, (match, p1, section, page) => {
      changed = true;
      // return helper call or inline check
      return `(fs.existsSync(path.join(__dirname, '../../frontend/${section}/${page}/index.html')) ? path.join(__dirname, '../../frontend/${section}/${page}/index.html') : ${match})`;
    });
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated test script: ${file}`);
  }
});

console.log('Finished updating test script path resolvers.');
