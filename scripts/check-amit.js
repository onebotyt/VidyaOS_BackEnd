const { query } = require('../src/config/db');

async function check() {
  const teachers = await query("SELECT t.*, u.username, u.email FROM teachers t JOIN users u ON t.user_id = u.id WHERE t.full_name LIKE '%Amit%'");
  console.log('Teachers:', JSON.stringify(teachers, null, 2));
  if (teachers.length) {
    for (let t of teachers) {
      const assignments = await query('SELECT * FROM teacher_assignments WHERE teacher_id = ?', [t.id]);
      console.log(`Assignments for teacher ${t.id} (${t.full_name}):`, JSON.stringify(assignments, null, 2));
      const registers = await query('SELECT * FROM attendance_registers WHERE teacher_id = ?', [t.id]);
      console.log(`Registers for teacher ${t.id} (${t.full_name}):`, JSON.stringify(registers, null, 2));
    }
  }
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
