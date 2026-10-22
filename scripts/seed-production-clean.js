/**
 * CLEAN INSTITUTIONAL PRODUCTION SEED SCRIPT — VidyaOS
 * 
 * Used for Production Deployments (Render / Cloud):
 * - ZERO demo students
 * - ZERO demo faculty (no fake HODs, no fake teachers)
 * - ZERO fake attendance sessions / scans / registers
 * - 6 Standard Polytechnic Departments (ECE, EE, IT, ME, CE, PHARM) ready for real HOD appointment
 * - Academic Year 2026-27 (Odd Semester)
 * - EXACTLY 1 user: System Administrator (admin@gmail.com / Admin@123)
 */

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');
const path = require('path');

const ADMIN_PASS = 'Admin@123';

function seedProductionClean(targetDb = null, options = {}) {
  const db = targetDb || new DatabaseSync(path.resolve(__dirname, '../college_attendance.sqlite'));
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA journal_mode = WAL;');

  const force = options.force || process.env.FORCE_PURGE_PRODUCTION === 'true' || process.env.FORCE_RESEED === 'true';

  // ─── Safety Shield: Check if existing active users exist ─────────────────
  try {
    const userCheck = db.prepare("SELECT count(*) as c FROM users").get();
    if (userCheck && userCheck.c > 0 && !force) {
      console.log('=================================================================');
      console.log(`🛡️  SAFETY SHIELD: Active database contains ${userCheck.c} existing user account(s).`);
      console.log('    Refusing destructive table wipe. Preserving all production students,');
      console.log('    teachers, attendance records, and registered data.');
      console.log('=================================================================\n');

      const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
      // Ensure master admin exists without overwriting existing data
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
        VALUES (1, 'admin@gmail.com', 'admin@gmail.com', ?, 0, 'ACTIVE')
      `).run(adminHash);
      db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (1, 'SYSTEM_ADMIN')`).run();

      const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
      const studentCount = db.prepare('SELECT count(*) as c FROM students').get().c;
      const deptCount = db.prepare('SELECT count(*) as c FROM departments').get().c;
      db.exec('PRAGMA foreign_keys = ON;');
      return { success: true, preserved: true, userCount, studentCount, deptCount };
    }
  } catch (_) {}

  console.log('=================================================================');
  console.log('🏛️  PROVISIONING CLEAN PRODUCTION ENVIRONMENT (ONLY 1 ADMIN LOGIN)');
  console.log('=================================================================\n');

  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);

  // ─── Step 1: Wipe all demo / transient data ──────────────────────────────
  console.log('[1] Purging all demo data, faculty, students, and registers (authorized force reset)...');

  const tablesToClear = [
    'classroom_posts',
    'teaching_group_members',
    'teaching_groups',
    'assessment_submissions',
    'assessments',
    'fingerprint_slots',
    'esp32_presence',
    'iot_attendance_events',
    'devices',
    'register_attendance',
    'attendance_corrections',
    'attendance_session_students',
    'attendance_sessions',
    'attendance_registers',
    'student_self_attendance',
    'student_department_enrollments',
    'enrollments',
    'students',
    'teacher_assignments',
    'subjects',
    'teachers',
    'departments',
    'academic_years',
    'notifications',
    'audit_logs',
    'user_sessions',
    'user_roles',
    'users',
    'faculty_registration_requests',
    'common_faculty_manager_assignments'
  ];

  for (const table of tablesToClear) {
    try {
      db.exec(`DELETE FROM ${table};`);
    } catch (_) {}
  }

  try {
    db.exec(`DELETE FROM sqlite_sequence;`);
  } catch (_) {}

  console.log('    ✓ All demo tables and sequences cleared cleanly.\n');

  // ─── Step 2: Academic Year & 6 Standard Polytechnic Departments ──────────
  console.log('[2] Initializing Active Academic Year and 6 Standard Departments...');

  db.prepare(`
    INSERT OR IGNORE INTO academic_years (id, label, start_date, end_date, is_current)
    VALUES (1, '2026-27 (Odd Semester)', '2026-07-01', '2027-06-30', 1)
  `).run();

  const standardDepts = [
    { id: 2, name: 'Electronics Engineering', code: 'ECE', duration: 3 },
    { id: 3, name: 'Electrical Engineering', code: 'EE', duration: 3 },
    { id: 4, name: 'Information Technology', code: 'IT', duration: 3 },
    { id: 5, name: 'Mechanical Engineering', code: 'ME', duration: 3 },
    { id: 6, name: 'Civil Engineering', code: 'CE', duration: 3 },
    { id: 7, name: 'Pharmacy', code: 'PHARM', duration: 2 }
  ];

  for (const sd of standardDepts) {
    db.prepare(`
      INSERT OR IGNORE INTO departments (id, name, code, is_active, degree_duration_years, active_term, hod_user_id)
      VALUES (?, ?, ?, 1, ?, '2026-27 (Odd Semester)', NULL)
    `).run(sd.id, sd.name, sd.code, sd.duration);
    console.log(`    ✓ Department: ${sd.name} (${sd.code}, id=${sd.id}) — HOD: Unassigned`);
  }

  // ─── Step 3: Exactly 1 Master Admin Account ──────────────────────────────
  console.log('\n[3] Creating Single System Administrator Account...');

  // User 1: admin / admin@gmail.com
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, must_change_password, status)
    VALUES (1, 'admin@gmail.com', 'admin@gmail.com', ?, 0, 'ACTIVE')
  `).run(adminHash);

  db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (1, 'SYSTEM_ADMIN')`).run();

  // Institutional Administrator teacher profile for foreign key stability
  db.prepare(`
    INSERT OR IGNORE INTO teachers (id, user_id, department_id, full_name, employee_id, phone)
    VALUES (1, 1, 4, 'System Administrator', 'ADMIN-01', '0000000000')
  `).run();

  console.log('    ✓ Master Admin provisioned: admin@gmail.com (Password: Admin@123)\n');

  // ─── Step 4: Verification ────────────────────────────────────────────────
  const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
  const teacherCount = db.prepare('SELECT count(*) as c FROM teachers').get().c;
  const studentCount = db.prepare('SELECT count(*) as c FROM students').get().c;
  const deptCount = db.prepare('SELECT count(*) as c FROM departments').get().c;

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               CLEAN INSTITUTIONAL PRODUCTION READY (RENDER)               ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ Users:        ${userCount} (admin@gmail.com only)                                   ║`);
  console.log(`║ Teachers:     ${teacherCount} (System Admin master profile only)                     ║`);
  console.log(`║ Students:     ${studentCount} (Zero demo students)                                    ║`);
  console.log(`║ Departments:  ${deptCount} standard polytechnic departments (HODs: Unassigned)       ║`);
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ CREDENTIALS:                                                               ║');
  console.log('║   Login URL:  https://vidyaos-pink.vercel.app/login/admin.html             ║');
  console.log('║   Identifier: admin@gmail.com (or admin)                                   ║');
  console.log('║   Password:   Admin@123                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  db.exec('PRAGMA foreign_keys = ON;');
  return { success: true, userCount, studentCount, deptCount };
}

if (require.main === module) {
  seedProductionClean();
}

module.exports = { seedProductionClean };
