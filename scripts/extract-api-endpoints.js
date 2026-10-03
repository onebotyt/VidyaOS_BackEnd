/**
 * extract-api-endpoints.js
 * Extracts all API endpoints from route files and outputs structured JSON
 */
const fs = require('fs');
const path = require('path');

const routeFiles = [
  { name: 'auth', prefix: '/api/v1/auth', color: '#e74c3c', icon: '🔐' },
  { name: 'students', prefix: '/api/v1/students', color: '#3498db', icon: '🎓' },
  { name: 'faculty', prefix: '/api/v1/faculty', color: '#2ecc71', icon: '👨‍🏫' },
  { name: 'hod', prefix: '/api/v1/hod', color: '#9b59b6', icon: '🏛️' },
  { name: 'attendance', prefix: '/api/v1/attendance', color: '#f39c12', icon: '📋' },
  { name: 'devices', prefix: '/api/v1/devices', color: '#1abc9c', icon: '📡' },
  { name: 'reports', prefix: '/api/v1/reports', color: '#e67e22', icon: '📊' },
  { name: 'admin', prefix: '/api/v1/admin', color: '#c0392b', icon: '⚙️' },
  { name: 'leave', prefix: '/api/v1/leave', color: '#27ae60', icon: '📅' },
  { name: 'timetable', prefix: '/api/v1/timetable', color: '#8e44ad', icon: '🗓️' },
  { name: 'assignments', prefix: '/api/v1/assignments', color: '#d35400', icon: '📝' },
  { name: 'exams', prefix: '/api/v1/exams', color: '#c0392b', icon: '📖' },
  { name: 'curriculum', prefix: '/api/v1/curriculum', color: '#16a085', icon: '📚' },
  { name: 'teachingGroups', prefix: '/api/v1/teaching-groups', color: '#2980b9', icon: '👥' },
  { name: 'notifications', prefix: '/api/v1/notifications', color: '#7f8c8d', icon: '🔔' },
];

const results = [];
const routesDir = path.join(__dirname, '../src/routes');

routeFiles.forEach(rf => {
  const filePath = path.join(routesDir, rf.name + '.js');
  if (!fs.existsSync(filePath)) return;

  const code = fs.readFileSync(filePath, 'utf8');
  const methods = ['get', 'post', 'put', 'delete', 'patch'];

  methods.forEach(method => {
    // Match router.METHOD('path', ...) or router.METHOD("path", ...)
    const re = new RegExp(`router\\.${method}\\(['"]([^'"]+)['"]`, 'g');
    let match;
    while ((match = re.exec(code)) !== null) {
      const routePath = match[1];
      const fullPath = rf.prefix + (routePath === '/' ? '' : routePath);

      // Try to extract a comment/description near this endpoint
      const lineStart = code.lastIndexOf('\n', match.index);
      const prevLines = code.substring(Math.max(0, lineStart - 300), lineStart);
      const commentMatch = prevLines.match(/\/\*\*[\s\S]*?\*\/\s*$/) || prevLines.match(/\/\/[^\n]*\n\s*$/);
      let description = '';
      if (commentMatch) {
        description = commentMatch[0]
          .replace(/\/\*\*|\*\/|\*|\/\//g, '')
          .trim()
          .replace(/\s+/g, ' ')
          .substring(0, 150);
      }

      results.push({
        id: `${rf.name}-${method}-${routePath.replace(/[^a-z0-9]/gi, '-')}`,
        module: rf.name,
        prefix: rf.prefix,
        method: method.toUpperCase(),
        path: routePath,
        fullPath,
        color: rf.color,
        icon: rf.icon,
        description: description || `${method.toUpperCase()} ${fullPath}`,
        requiresAuth: !code.substring(match.index - 100, match.index).includes('public'),
        hasParams: routePath.includes(':'),
      });
    }
  });
});

// Summary
const summary = {
  total: results.length,
  byModule: {},
  byMethod: {},
};
results.forEach(ep => {
  summary.byModule[ep.module] = (summary.byModule[ep.module] || 0) + 1;
  summary.byMethod[ep.method] = (summary.byMethod[ep.method] || 0) + 1;
});

const output = {
  extractedAt: new Date().toISOString(),
  summary,
  modules: routeFiles.map(rf => ({
    name: rf.name,
    prefix: rf.prefix,
    color: rf.color,
    icon: rf.icon,
    count: summary.byModule[rf.name] || 0,
  })),
  endpoints: results,
};

const outPath = path.join(__dirname, '../../../api-network-explorer/src/data/api-endpoints.json');
const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`✅ Extracted ${results.length} endpoints across ${routeFiles.length} modules`);
console.log(`📁 Written to: ${outPath}`);
console.log('By module:', JSON.stringify(summary.byModule, null, 2));
