const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');

console.log('=== SYSTEMATIC SCAN FOR UNNECESSARY & DUPLICATE CODE FUNCTIONS ===\n');

// 1. Scan for identical or near-identical files
console.log('--- 1. File Name & Content Redundancy Check ---');
const adminFiles = fs.readdirSync(path.join(frontendDir, 'admin'));
console.log('Admin files:', adminFiles);

const pairsToCheck = [
  ['frontend/admin/whatsapp-gateway.html', 'frontend/admin/whatsapp_gateway.html'],
  ['frontend/admin/audit-logs.html', 'frontend/admin/audit.html'],
  ['frontend/faculty/assignments.html', 'frontend/faculty/registers.html'],
  ['frontend/faculty/hod-subjects.html', 'frontend/faculty/groups.html']
];

pairsToCheck.forEach(([f1, f2]) => {
  const p1 = path.join(rootDir, f1);
  const p2 = path.join(rootDir, f2);
  if (fs.existsSync(p1) && fs.existsSync(p2)) {
    const s1 = fs.statSync(p1).size;
    const s2 = fs.statSync(p2).size;
    console.log(`Pair: ${f1} (${s1} bytes) vs ${f2} (${s2} bytes)`);
  }
});

// 2. Scan for duplicated function names across all frontend HTML scripts
console.log('\n--- 2. Function Definitions Scan across Frontend HTML files ---');
function getAllHtmlFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getAllHtmlFiles(fullPath));
      }
    } else if (file.endsWith('.html')) {
      results.push(fullPath);
    }
  });
  return results;
}

const htmlFiles = getAllHtmlFiles(frontendDir);
const funcMap = new Map(); // funcName -> array of { file, signature, line }

htmlFiles.forEach(file => {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Regex for function foo(...) or async function foo(...) or const foo = (...) => or window.foo = function
    const match = line.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
    if (match) {
      const funcName = match[1];
      const params = match[2];
      if (!funcMap.has(funcName)) {
        funcMap.set(funcName, []);
      }
      funcMap.get(funcName).push({ file: relPath, line: idx + 1, params });
    }
  });
});

console.log(`Total unique function names found in HTML files: ${funcMap.size}`);

// Find functions defined in 3 or more HTML files
const highlyDuplicated = [];
funcMap.forEach((occurrences, funcName) => {
  if (occurrences.length >= 3) {
    highlyDuplicated.push({ funcName, count: occurrences.length, occurrences });
  }
});

highlyDuplicated.sort((a, b) => b.count - a.count);

console.log(`\nFunctions defined in 3 or more HTML files: ${highlyDuplicated.length}`);
highlyDuplicated.forEach(item => {
  console.log(`\n[${item.count} occurrences] function ${item.funcName}(${item.occurrences[0].params})`);
  item.occurrences.slice(0, 8).forEach(occ => {
    console.log(`   - ${occ.file}:${occ.line}`);
  });
  if (item.occurrences.length > 8) {
    console.log(`   ... and ${item.occurrences.length - 8} more files`);
  }
});

// 3. Scan Backend for duplicate functions across routes and services
console.log('\n--- 3. Function Definitions Scan across Backend JS files ---');
function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getAllJsFiles(fullPath));
      }
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  });
  return results;
}

const backendJsFiles = getAllJsFiles(path.join(backendDir, 'src'));
const backendFuncMap = new Map();

backendJsFiles.forEach(file => {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const match = line.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
    if (match) {
      const funcName = match[1];
      const params = match[2];
      if (!backendFuncMap.has(funcName)) {
        backendFuncMap.set(funcName, []);
      }
      backendFuncMap.get(funcName).push({ file: relPath, line: idx + 1, params });
    }
  });
});

console.log(`Total unique function names found in backend/src: ${backendFuncMap.size}`);
const backendDupes = [];
backendFuncMap.forEach((occurrences, funcName) => {
  if (occurrences.length >= 2) {
    backendDupes.push({ funcName, count: occurrences.length, occurrences });
  }
});

backendDupes.sort((a, b) => b.count - a.count);
console.log(`Backend functions defined in 2 or more files: ${backendDupes.length}`);
backendDupes.forEach(item => {
  console.log(`\n[${item.count} occurrences] function ${item.funcName}(${item.occurrences[0].params})`);
  item.occurrences.forEach(occ => {
    console.log(`   - ${occ.file}:${occ.line}`);
  });
});
