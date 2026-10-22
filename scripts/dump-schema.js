const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

async function dumpSchema() {
  console.log('Dumping current SQLite schema...');
  const rows = await query(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name`
  );

  let output = `-- =========================================================\n`;
  output += `-- College Attendance System — SQLite Database Schema\n`;
  output += `-- Generated: ${new Date().toISOString()}\n`;
  output += `-- Architecture: Unified Departments & Branches Catalog\n`;
  output += `-- =========================================================\n\n`;

  const tables = rows.filter(r => r.type === 'table');
  const indices = rows.filter(r => r.type === 'index');
  const triggers = rows.filter(r => r.type === 'trigger');

  output += `-- ─────────────────────────────────────────────────────────\n`;
  output += `-- TABLES (${tables.length})\n`;
  output += `-- ─────────────────────────────────────────────────────────\n\n`;

  for (const t of tables) {
    output += `${t.sql};\n\n`;
  }

  if (indices.length) {
    output += `-- ─────────────────────────────────────────────────────────\n`;
    output += `-- INDICES (${indices.length})\n`;
    output += `-- ─────────────────────────────────────────────────────────\n\n`;
    for (const idx of indices) {
      output += `${idx.sql};\n\n`;
    }
  }

  if (triggers.length) {
    output += `-- ─────────────────────────────────────────────────────────\n`;
    output += `-- TRIGGERS (${triggers.length})\n`;
    output += `-- ─────────────────────────────────────────────────────────\n\n`;
    for (const trg of triggers) {
      output += `${trg.sql};\n\n`;
    }
  }

  const outPath1 = path.join(__dirname, '../database/schema.sql');
  const outPath2 = path.join(__dirname, '../database/sqlite/schema.sql');
  fs.writeFileSync(outPath1, output, 'utf8');
  fs.writeFileSync(outPath2, output, 'utf8');
  console.log(`Schema saved to:\n  - ${outPath1}\n  - ${outPath2}`);
}

dumpSchema().catch(console.error);
