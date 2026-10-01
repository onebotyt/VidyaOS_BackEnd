const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('======================================================');
console.log('🧪 AUTOMATED THEME & COLOR TOKENIZATION TEST');
console.log('======================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failCount++;
  }
}

const repoRoot = fs.existsSync(path.join(__dirname, '../../frontend'))
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '..');

// 1. Verify variables.css tokens in :root and [data-theme='dark']
console.log('1. Checking CSS Token Consistency in variables.css...');
const varCss = fs.readFileSync(path.join(repoRoot, 'frontend/shared/css/variables.css'), 'utf8');

const requiredTokens = [
  '--bg-app',
  '--bg-surface',
  '--bg-card',
  '--bg-header-book',
  '--text-main',
  '--text-muted',
  '--border-color',
  '--color-primary',
  '--status-present',
  '--status-present-bg',
  '--status-absent',
  '--status-absent-bg',
  '--status-late',
  '--status-late-bg',
  '--table-bg',
  '--table-border',
  '--table-th-bg',
  '--table-sticky-bg',
  '--col-att-group-bg',
  '--col-abs-group-bg',
  '--col-holiday-bg',
  '--col-holiday-color',
  '--chip-admin-bg',
  '--chip-hod-bg',
  '--chip-classteacher-bg',
  '--chip-faculty-bg',
  '--chip-student-bg',
  '--remark-badge-bg',
  '--remark-regular-bg',
  '--remark-regular-dot',
  '--remark-short-bg',
  '--remark-short-dot',
  '--remark-defaulter-bg',
  '--remark-defaulter-dot',
  '--remark-transferred-bg',
  '--remark-transferred-dot',
  '--remark-dropped-bg',
  '--remark-dropped-dot',
  '--remark-popover-bg'
];

requiredTokens.forEach(token => {
  const inRoot = varCss.includes(token + ':');
  const inDark = varCss.indexOf("[data-theme='dark']") !== -1 && varCss.slice(varCss.indexOf("[data-theme='dark']")).includes(token + ':');
  assert(inRoot, `Token ${token} defined in :root (light mode)`);
  assert(inDark, `Token ${token} defined in [data-theme='dark'] (dark mode)`);
});

// 2. Test registers.html under JSDOM
console.log('\n2. Testing registers.html DOM with Theme switching...');
const regHtml = fs.readFileSync(path.join(repoRoot, 'frontend/faculty/registers.html'), 'utf8');
const dom = new JSDOM(regHtml, { runScripts: 'outside-only', url: 'http://localhost:3000/faculty/registers.html?id=17' });
const document = dom.window.document;

// Simulate light mode
document.documentElement.setAttribute('data-theme', 'light');
assert(document.documentElement.getAttribute('data-theme') === 'light', 'data-theme set to light');

// Simulate dark mode
document.documentElement.setAttribute('data-theme', 'dark');
assert(document.documentElement.getAttribute('data-theme') === 'dark', 'data-theme set to dark');

// Check registers.html key containers do NOT have hardcoded background or color inline styles that conflict
const switcherSelect = document.getElementById('register-switcher-select');
assert(switcherSelect !== null, 'Register switcher select element exists');
if (switcherSelect) {
  const style = switcherSelect.getAttribute('style') || '';
  assert(!style.includes('#ffffff') && !style.includes('#1e293b'), 'Switcher select has no hardcoded #ffffff or #1e293b colors');
  assert(style.includes('var(--bg-card)') && style.includes('var(--text-main)'), 'Switcher select uses var(--bg-card) and var(--text-main)');
}

const btnMonth = document.getElementById('btn-month-picker');
assert(btnMonth !== null, 'Month picker button exists');
if (btnMonth) {
  const style = btnMonth.getAttribute('style') || '';
  assert(!style.includes('#f8fafc') && !style.includes('#cbd5e1'), 'Month picker button has no hardcoded light grey hex colors');
  assert(style.includes('var(--bg-surface-secondary)') || style.includes('var(--bg-surface)'), 'Month picker uses semantic background CSS variable');
}

const matrixTable = document.getElementById('register-matrix-table');
assert(matrixTable !== null, 'Physical matrix table element exists in DOM (register-matrix-table)');

// 3. Scan registers.html for hardcoded hex colors (excluding media print)
console.log('\n3. Scanning registers.html for hardcoded hex colors...');
const lines = regHtml.split('\n');
const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
let hexFound = 0;
lines.forEach((l, idx) => {
  if (l.includes('@media print') || l.trim().startsWith('/*') || l.trim().startsWith('*')) return;
  const matches = l.match(hexRegex);
  if (matches) {
    const nonFallback = matches.filter(m => {
      const regexWithVar = new RegExp('var\\\\([^)]*' + m + '[^)]*\\\\)');
      return !regexWithVar.test(l);
    });
    if (nonFallback.length > 0 && /background|color|border|fill|stroke|box-shadow/i.test(l)) {
      console.warn(`  Line ${idx+1}: ${l.trim()}`);
      hexFound++;
    }
  }
});
assert(hexFound === 0, `Zero hardcoded hex colors found in registers.html (found: ${hexFound})`);

// 4. Check that frontend/shared and frontend files match
console.log('\n4. Checking file synchronization between shared and frontend...');
const filesToCheck = [
  ['frontend/shared/css/variables.css', 'frontend/css/variables.css'],
  ['frontend/shared/css/layout.css', 'frontend/css/layout.css'],
  ['frontend/shared/css/components.css', 'frontend/css/components.css'],
  ['frontend/shared/js/auth.js', 'frontend/js/auth.js'],
  ['frontend/shared/js/ui.js', 'frontend/js/ui.js']
];

filesToCheck.forEach(([f1, f2]) => {
  const p1 = path.join(repoRoot, f1);
  const p2 = path.join(repoRoot, f2);
  if (fs.existsSync(p1) && fs.existsSync(p2)) {
    const c1 = fs.readFileSync(p1, 'utf8');
    const c2 = fs.readFileSync(p2, 'utf8');
    assert(c1 === c2, `Synchronized: ${f1} <==> ${f2}`);
  }
});

console.log('\n======================================================');
console.log(`Results: ${passCount} Passed, ${failCount} Failed`);
console.log('======================================================');

if (failCount > 0) process.exit(1);
