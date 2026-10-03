const fs = require('fs');
const path = require('path');
const hod = fs.readFileSync(path.resolve(__dirname, '../src/routes/hod.js'), 'utf8');
const students = fs.readFileSync(path.resolve(__dirname, '../src/routes/students.js'), 'utf8');

function getEndpoints(code, prefix) {
  const matches = [];
  const lines = code.split('\n');
  lines.forEach(l => {
    const m = l.match(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) matches.push({ method: m[1].toUpperCase(), path: prefix + m[2] });
  });
  return matches;
}

console.log('--- HOD Routes matching student (total ' + getEndpoints(hod, '/hod').length + ') ---');
getEndpoints(hod, '/hod').filter(e => e.path.includes('student')).forEach(e => console.log(' ', e.method, e.path));

console.log('\n--- Students Routes (total ' + getEndpoints(students, '/students').length + ') ---');
getEndpoints(students, '/students').forEach(e => console.log(' ', e.method, e.path));
