const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const frontendDir = path.join(rootDir, 'frontend');

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
const funcMap = new Map();

htmlFiles.forEach(file => {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  // Skip mirrored files for cleaner analysis
  if (relPath.includes('hod-students.html') || relPath.includes('hod-teachers.html')) return;

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const match = line.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
    if (match) {
      const funcName = match[1];
      const params = match[2].trim();
      if (!funcMap.has(funcName)) {
        funcMap.set(funcName, []);
      }
      funcMap.get(funcName).push({ file: relPath, line: idx + 1, params });
    }
  });
});

console.log('=== DUPLICATE FRONTEND JAVASCRIPT FUNCTIONS (excluding mirrored files) ===\n');

const duplicates = [];
funcMap.forEach((occurrences, funcName) => {
  if (occurrences.length >= 2) {
    duplicates.push({ funcName, count: occurrences.length, occurrences });
  }
});

duplicates.sort((a, b) => b.count - a.count);

duplicates.forEach(d => {
  console.log(`[${d.count} files] function ${d.funcName}(${d.occurrences[0].params})`);
  d.occurrences.forEach(o => {
    console.log(`    - ${o.file}:${o.line}`);
  });
});
