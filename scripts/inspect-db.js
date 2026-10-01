const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, '../college_attendance.sqlite');
const db = new DatabaseSync(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

console.log(`=== Database: ${dbPath} ===`);
console.log(`Total Tables: ${tables.length}\n`);

tables.forEach(t => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get().c;
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name);
  console.log(`${t.name.padEnd(32)} | Rows: ${String(count).padStart(4)} | Cols: ${cols.join(', ')}`);
});
