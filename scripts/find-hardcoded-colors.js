const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(full));
    } else if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js')) {
      results.push(full);
    }
  });
  return results;
}

const files = walk('frontend');
const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;

console.log('=== HARDCODED COLORS SCAN IN FRONTEND ===\n');

files.forEach(file => {
  if (file.endsWith('variables.css')) return;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    if (line.includes('@media print') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
    
    const matches = line.match(hexRegex);
    if (matches) {
      const nonFallback = matches.filter(m => {
        const regexWithVar = new RegExp(`var\\([^)]*${m}[^)]*\\)`);
        return !regexWithVar.test(line);
      });

      if (nonFallback.length > 0) {
        if (/background|color|border|fill|stroke|box-shadow/i.test(line)) {
          console.log(`${file}:${idx + 1} [${nonFallback.join(', ')}] -> ${line.trim()}`);
        }
      }
    }
  });
});
