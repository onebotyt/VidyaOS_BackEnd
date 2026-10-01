/**
 * HOD Department Administration Routes (/api/v1/hod/*)
 *
 * Per ATTENDANCE_ARCHITECTURE_FREEZE.md — HOD is the Department Administrator:
 *   - Creates teachers within their department (Name, Gmail, Phone)
 *   - Creates subjects for their department (Code, Name, Branch, Year, Sem)
 *   - Assigns Subject Teachers with THEORY or PRACTICAL scope → auto-creates official register
 *   - Assigns Class Teachers to cohorts → grants exclusive student roster authority
 *   - Views department-wide attendance reports (own dept only)
 *   - Read-only view of department students (HOD oversight, not management)
 *
 * All routes enforce requireHOD() — teacher must have active HOD assignment.
 * Department scope is resolved from HOD's assignment (hod_department_id on req).
 */

const express = require('express');
const router = express.Router();
const { body, param, query: qv } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireHOD, requireHODOrClassTeacher } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const notificationService = require('../services/notificationService');
const { logAudit } = require('../services/auditService');

// All HOD/Department routes: must be authenticated TEACHER or SYSTEM_ADMIN with HOD or Class Teacher assignment
router.use(auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), requireHODOrClassTeacher());

// ─────────────────────────────────────────────────────────
// HOD DASHBOARD
// GET /api/v1/hod/dashboard
// ─────────────────────────────────────────────────────────

router.get('/dashboard', requireHOD(), async (req, res) => {
  try {
    const deptId = req.hod_department_id;

    const [teachersCount] = await query(
      `SELECT COUNT(*) as total FROM teachers WHERE department_id = ?`, [deptId]
    );
    const [subjectsCount] = await query(
      `SELECT COUNT(*) as total FROM subjects WHERE department_id = ? AND is_active = 1`, [deptId]
    );
    const [studentsCount] = await query(
      `SELECT COUNT(DISTINCT e.student_id) as total 
       FROM enrollments e WHERE e.department_id = ?`, [deptId]
    );
    const [activeRegisters] = await query(
      `SELECT COUNT(*) as total FROM attendance_registers 
       WHERE department_id = ? AND is_official = 1 AND is_active = 1`, [deptId]
    );

    // Dept-wide attendance average from finalized sessions
    const [avgAttendance] = await query(
      `SELECT ROUND(AVG(sub.pct), 1) as avg_pct FROM (
         SELECT 
           (SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(COUNT(ra.id), 0)) as pct
         FROM attendance_registers ar
         JOIN attendance_sessions s ON s.register_id = ar.id AND s.state = 'FINALIZED'
         JOIN register_attendance ra ON ra.session_id = s.id
         WHERE ar.department_id = ? AND ar.is_official = 1
       ) sub`, [deptId]
    );

    // Low attendance students (< threshold)
    const threshold = parseFloat(
      (await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'attendance_threshold'`))[0]?.setting_value || '75'
    );

    res.json({ success: true, data: {
      department_id: deptId,
      department_name: req.hod_department_name,
      total_teachers: teachersCount?.total || 0,
      total_subjects: subjectsCount?.total || 0,
      total_students: studentsCount?.total || 0,
      active_registers: activeRegisters?.total || 0,
      avg_attendance_pct: avgAttendance?.avg_pct || 0,
      attendance_threshold: threshold
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// TEACHER MANAGEMENT
// ─────────────────────────────────────────────────────────

/** GET /api/v1/hod/teachers — List teachers in HOD's department */
router.get('/teachers', async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.id, t.employee_id, t.full_name, t.phone,
              u.id as user_id, u.username as gmail, u.email, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.is_active = 1) as assignment_count,
              t.created_at
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.department_id = ?
       ORDER BY t.full_name`,
      [req.hod_department_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/teachers — Create teacher in HOD's department
 * Body: { full_name, email, phone?, employee_id? }
 * - Gmail is login ID. System auto-generates 8-char temp password.
 * - employee_id is OPTIONAL — do NOT generate synthetic IDs.
 * - department_id is set automatically from HOD's scope.
 */
router.post('/teachers', requireHOD(), [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('email').isEmail().withMessage('Valid institutional Gmail required'),
  body('password').trim().notEmpty().withMessage('Password required'),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], async (req, res) => {
  const { full_name, email, password, phone, employee_id } = req.body;
  const gmail = email.toLowerCase().trim();
  const deptId = req.hod_department_id;

  try {
    const tempPassword = password;
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
        [gmail, gmail, passwordHash, passwordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [userId]);

      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone) VALUES (?, ?, ?, ?, ?)`,
        [userId, deptId, employee_id || null, full_name, phone || null]
      );
      const teacherId = tRes.insertId ?? tRes.lastInsertRowid;

      return { teacher_id: teacherId, user_id: userId, full_name, gmail, department_id: deptId, temporary_password: tempPassword };
    });

    res.status(201).json({
      success: true,
      data: result,
      message: `Teacher account created in ${req.hod_department_name}. Share Gmail and temporary password with them to log in.`
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already registered in the system' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** GET /api/v1/hod/teachers/:id — Teacher detail + assignments */
router.get('/teachers/:id', [param('id').isInt(), validate], async (req, res) => {
  try {
    const teacherRows = await query(
      `SELECT t.id, t.employee_id, t.full_name, t.phone, t.department_id,
              u.id as user_id, u.username as gmail, u.email, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              t.created_at
       FROM teachers t JOIN users u ON t.user_id = u.id
       WHERE t.id = ? AND t.department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!teacherRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });

    const assignments = await query(
      `SELECT ta.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, ay.label as academic_year_label,
              ar.id as register_id, ar.name as register_name
       FROM teacher_assignments ta
       LEFT JOIN subjects s ON ta.subject_id = s.id
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.assignment_id = ta.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1
       ORDER BY ta.assignment_type, ta.created_at DESC`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...teacherRows[0], assignments } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** PUT /api/v1/hod/teachers/:id — Update teacher profile */
router.put('/teachers/:id', requireHOD(), [
  param('id').isInt(),
  body('full_name').optional().trim().notEmpty(),
  body('employee_id').optional().trim(),
  body('phone').optional().trim(),
  validate
], async (req, res) => {
  const { full_name, employee_id, phone } = req.body;
  try {
    const teacherRows = await query(
      `SELECT id, user_id FROM teachers WHERE id = ? AND department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!teacherRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });

    const sets = [], params = [];
    if (full_name) { sets.push('full_name = ?'); params.push(full_name); }
    if (employee_id !== undefined) { sets.push('employee_id = ?'); params.push(employee_id || null); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
    if (!sets.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
    params.push(req.params.id);
    await query(`UPDATE teachers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    res.json({ success: true, message: 'Teacher profile updated' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Employee ID already assigned to another teacher' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** POST /api/v1/hod/teachers/:id/reset-password */
router.post('/teachers/:id/reset-password', requireHOD(), [
  param('id').isInt(),
  body('new_password').trim().notEmpty().withMessage('New password is required'),
  validate
], async (req, res) => {
  try {
    const teacherRows = await query(
      `SELECT user_id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!teacherRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });

    if (teacherRows[0].user_id === req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'HOD password can only be reset from your Profile page or by an Admin.' } });
    }

    const newPass = req.body.new_password;
    const newPassHash = await bcrypt.hash(newPass, 12);
    await query(
      `UPDATE users SET password_hash = ?, temp_password_hash = ?, must_change_password = 0,
       status = 'ACTIVE', google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newPassHash, newPassHash, teacherRows[0].user_id]
    );
    await query(`UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?`, [teacherRows[0].user_id]);
    res.json({ success: true, message: `Password for ${teacherRows[0].full_name} has been updated successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** DELETE /api/v1/hod/teachers/:id — Delete teacher */
router.delete('/teachers/:id', requireHOD(), [param('id').isInt(), validate], async (req, res) => {
  try {
    const teacherRows = await query(
      `SELECT user_id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!teacherRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });

    const userId = teacherRows[0].user_id;

    if (userId === req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' } });
    }
    
    await withTransaction(async (conn) => {
      await conn.execute(`DELETE FROM teacher_assignments WHERE teacher_id = ?`, [req.params.id]);
      await conn.execute(`DELETE FROM attendance_registers WHERE teacher_id = ?`, [req.params.id]);
      await conn.execute(`DELETE FROM teachers WHERE id = ?`, [req.params.id]);
      await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
      await conn.execute(`DELETE FROM user_sessions WHERE user_id = ?`, [userId]);
      await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]);
    });

    res.json({ success: true, message: `Teacher ${teacherRows[0].full_name} and their assignments have been deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// SUBJECT MANAGEMENT
// HOD creates subjects for their dept. No Theory/Practical here —
// that is determined at assignment time.
// ─────────────────────────────────────────────────────────

/** GET /api/v1/hod/subjects — Enriched with assigned teachers and finalized session counts */
router.get('/subjects', async (req, res) => {
  try {
    const deptId = req.hod_department_id;
    const subjects = await query(
      `SELECT s.*, d.name as branch_name, d.code as branch_code, d.name as department_name
       FROM subjects s
       JOIN departments d ON s.department_id = d.id
       WHERE s.department_id = ? AND s.is_active = 1
       ORDER BY s.year, s.semester, s.code`,
      [deptId]
    );

    // Fetch active assignments and session counts for all subjects
    const subjectIds = subjects.map(s => s.id);
    let assignments = [];
    if (subjectIds.length) {
      assignments = await query(
        `SELECT ta.id as assignment_id, ta.subject_id, ta.session_type_scope, ta.teacher_id,
                t.full_name as teacher_name, t.employee_id,
                ar.id as register_id,
                (SELECT COUNT(*) FROM attendance_sessions asess WHERE asess.register_id = ar.id AND asess.state = 'FINALIZED') as finalized_sessions
         FROM teacher_assignments ta
         JOIN teachers t ON ta.teacher_id = t.id
         LEFT JOIN attendance_registers ar ON ar.assignment_id = ta.id
         WHERE ta.subject_id IN (${subjectIds.map(() => '?').join(',')}) AND ta.is_active = 1`,
        subjectIds
      );
    }

    const data = subjects.map(s => {
      const subAssignments = assignments.filter(a => a.subject_id === s.id);
      const totalSessions = subAssignments.reduce((sum, a) => sum + (a.finalized_sessions || 0), 0);
      return {
        ...s,
        assignments: subAssignments,
        total_finalized_sessions: totalSessions
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/subjects — Create subject in HOD's department
 * Body: { name, code, branch_id, year, semester }
 * NOTE: No has_practical / Theory/Practical flags.
 * Theory and Practical components are selected at assignment time.
 */
router.post('/subjects', requireHOD(), [
  body('name').trim().notEmpty().withMessage('Subject name required'),
  body('code').trim().notEmpty().withMessage('Subject code required'),
  body('branch_id').optional(),
  body('year').isInt({ min: 1, max: 4 }).withMessage('Year 1-4 required'),
  body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester 1-8 required'),
  validate
], async (req, res) => {
  const { name, code, year, semester } = req.body;
  const deptId = req.hod_department_id;

  try {
    const deptDurationRow = (await query(`SELECT degree_duration_years FROM departments WHERE id = ?`, [deptId]))[0];
    const maxYears = deptDurationRow?.degree_duration_years || 3;
    if (year > maxYears || semester > maxYears * 2) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Year ${year} or Semester ${semester} exceeds department degree duration of ${maxYears} Years (Max Semester ${maxYears * 2})` }
      });
    }

    const result = await query(
      `INSERT INTO subjects (name, code, department_id, year, semester) VALUES (?, ?, ?, ?, ?)`,
      [name, code.toUpperCase(), deptId, year, semester]
    );
    const id = result[0]?.insertId ?? result.lastInsertRowid;
    res.status(201).json({ success: true, data: { id, name, code: code.toUpperCase(), department_id: deptId, branch_id: deptId, year, semester } });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Subject code already exists for this cohort in your department' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** PUT /api/v1/hod/subjects/:id */
router.put('/subjects/:id', requireHOD(), [
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('code').optional().trim().notEmpty(),
  body('year').optional().isInt({ min: 1, max: 4 }),
  body('semester').optional().isInt({ min: 1, max: 8 }),
  body('is_active').optional().isBoolean(),
  validate
], async (req, res) => {
  const { name, code, year, semester, is_active } = req.body;
  try {
    const subjectRows = await query(
      `SELECT id FROM subjects WHERE id = ? AND department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!subjectRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject not found in your department' } });

    const sets = [], params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (code !== undefined) { sets.push('code = ?'); params.push(code.toUpperCase()); }
    if (year !== undefined) { sets.push('year = ?'); params.push(year); }
    if (semester !== undefined) { sets.push('semester = ?'); params.push(semester); }
    if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
    params.push(req.params.id);
    await query(`UPDATE subjects SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    res.json({ success: true, message: 'Subject updated successfully' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Subject code already exists for this cohort in your department' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** DELETE /api/v1/hod/subjects/:id — Deactivate subject */
router.delete('/subjects/:id', requireHOD(), [param('id').isInt(), validate], async (req, res) => {
  try {
    const subjectRows = await query(
      `SELECT id, name FROM subjects WHERE id = ? AND department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!subjectRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject not found in your department' } });
    }

    // Check if there are finalized sessions
    const hasFinalized = await query(
      `SELECT COUNT(*) as count 
       FROM attendance_sessions asess
       JOIN attendance_registers ar ON asess.register_id = ar.id
       WHERE ar.subject_id = ? AND asess.state = 'FINALIZED'`,
      [req.params.id]
    );
    if (hasFinalized[0]?.count > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'CONFLICT', message: `Cannot delete subject with ${hasFinalized[0].count} finalized attendance sessions. Deactivate it instead.` }
      });
    }

    await withTransaction(async (conn) => {
      await conn.execute(`UPDATE subjects SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id]);
      await conn.execute(`UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE subject_id = ?`, [req.params.id]);
      await conn.execute(`UPDATE attendance_registers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE subject_id = ?`, [req.params.id]);
    });

    res.json({ success: true, message: `Subject "${subjectRows[0].name}" and linked assignments removed.` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// TEACHER ASSIGNMENTS + AUTO REGISTER CREATION
// ─────────────────────────────────────────────────────────

/** GET /api/v1/hod/assignments — All active assignments in HOD's dept */
router.get('/assignments', async (req, res) => {
  try {
    const rows = await query(
      `SELECT ta.id, ta.assignment_type, ta.session_type_scope, ta.year, ta.semester,
              ta.subject_id, ta.is_active, ta.created_at,
              t.id as teacher_id, t.full_name as teacher_name, t.employee_id,
              s.name as subject_name, s.code as subject_code,
              d.name as branch_name, d.code as branch_code,
              ay.label as academic_year_label,
              ar.id as register_id, ar.name as register_name
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       LEFT JOIN subjects s ON ta.subject_id = s.id
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.assignment_id = ta.id
       WHERE ta.department_id = ? AND ta.is_active = 1
       ORDER BY ta.assignment_type, d.code, ta.year, ta.semester`,
      [req.hod_department_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/assignments/subject-teacher
 * Assign a Subject Teacher with THEORY or PRACTICAL scope.
 * Automatically creates the official attendance register.
 *
 * Body: { teacher_id, subject_id, session_type_scope ('THEORY'|'PRACTICAL'), branch_id?, year?, semester? }
 *
 * Per architecture: NO 'ALL' scope. Always THEORY or PRACTICAL.
 * If one teacher teaches both, HOD makes two separate assignments.
 */
router.post('/assignments/subject-teacher', requireHOD(), [
  body('teacher_id').isInt().withMessage('Teacher ID required'),
  body('subject_id').isInt().withMessage('Subject ID required'),
  body('session_type_scope').isIn(['THEORY', 'PRACTICAL']).withMessage('session_type_scope must be THEORY or PRACTICAL'),
  body('branch_id').optional(),
  body('year').optional().isInt({ min: 1, max: 4 }),
  body('semester').optional().isInt({ min: 1, max: 8 }),
  validate
], async (req, res) => {
  const { teacher_id, subject_id, session_type_scope, year, semester } = req.body;
  const deptId = req.hod_department_id;

  try {
    // Verify teacher belongs to HOD's department
    const teacherCheck = await query(
      `SELECT id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
      [teacher_id, deptId]
    );
    if (!teacherCheck.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Teacher does not belong to your department' } });

    // Verify subject exists and is active
    const subjectCheck = await query(
      `SELECT s.id, s.name, s.code, s.department_id, s.year, s.semester 
       FROM subjects s 
       WHERE s.id = ? AND s.is_active = 1`,
      [subject_id]
    );
    if (!subjectCheck.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject not found or is inactive' } });

    const targetSubject = subjectCheck[0];
    const targetDeptId = targetSubject.department_id;
    const targetYear = year || targetSubject.year;
    const targetSem = semester || targetSubject.semester;

    const ayId = (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    if (!ayId) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year configured' } });

    const ayLabel = (await query(`SELECT label FROM academic_years WHERE id = ?`, [ayId]))[0]?.label;

    const result = await withTransaction(async (conn) => {
      // Create assignment record under the target subject's department
      const [aRes] = await conn.execute(
        `INSERT INTO teacher_assignments 
         (teacher_id, subject_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, ?, 'SUBJECT_TEACHER', ?, ?, ?, ?, ?, ?)`,
        [teacher_id, subject_id, session_type_scope, targetDeptId, targetYear, targetSem, ayId, req.user.id]
      );
      const assignmentId = aRes.insertId ?? aRes.lastInsertRowid;

      // Create official attendance register linked to this assignment
      const registerName = `${targetSubject.name} — ${session_type_scope} — ${ayLabel || 'Academic Year'}`;
      const [rRes] = await conn.execute(
        `INSERT INTO attendance_registers 
         (teacher_id, name, subject_id, assignment_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [teacher_id, registerName, subject_id, assignmentId, targetDeptId, targetYear, targetSem, ayId, session_type_scope]
      );
      const registerId = rRes.insertId ?? rRes.lastInsertRowid;

      return { assignment_id: assignmentId, register_id: registerId, register_name: registerName };
    });

    res.status(201).json({
      success: true,
      data: result,
      message: `${teacherCheck[0].full_name} assigned as ${session_type_scope} teacher for ${targetSubject.name}. Official register "${result.register_name}" auto-created.`
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'This teacher already has an assignment for this subject and scope in this academic year' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/assignments/class-teacher
 * Assign a Class Teacher to a cohort (year + semester).
 * Body: { teacher_id, branch_id?, year, semester }
 */
router.post('/assignments/class-teacher', requireHOD(), [
  body('teacher_id').isInt().withMessage('Teacher ID required'),
  body('branch_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 4 }).withMessage('Year 1-4 required'),
  body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester 1-8 required'),
  validate
], async (req, res) => {
  const { teacher_id, branch_id, year, semester } = req.body;
  const deptId = req.hod_department_id;

  try {
    const teacherCheck = await query(
      `SELECT id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
      [teacher_id, deptId]
    );
    if (!teacherCheck.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Teacher does not belong to your department' } });

    const branchName = req.hod_department_name;
    const ayId = (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    if (!ayId) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year configured' } });

    let assignmentId;
    await withTransaction(async (conn) => {
      // Deactivate any existing active class teacher for this department cohort (ensuring strictly 1 Class Teacher per cohort)
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'CLASS_TEACHER' AND year = ? AND semester = ? AND is_active = 1`,
        [deptId, year, semester]
      );

      const [res] = await conn.execute(
        `INSERT INTO teacher_assignments 
         (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'CLASS_TEACHER', 'THEORY', ?, ?, ?, ?, ?)`,
        [teacher_id, deptId, year, semester, ayId, req.user.id]
      );
      assignmentId = res.insertId ?? res.lastInsertRowid;
    });

    res.status(201).json({
      success: true,
      data: { assignment_id: assignmentId },
      message: `${teacherCheck[0].full_name} assigned as Class Teacher for ${branchName} Year ${year} Sem ${semester}. Previous Class Teacher role reassigned successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** DELETE /api/v1/hod/assignments/:id — Deactivate assignment (archives linked register) */
router.delete('/assignments/:id', requireHOD(), [param('id').isInt(), validate], async (req, res) => {
  try {
    const assignment = await query(
      `SELECT ta.id 
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       WHERE ta.id = ? AND (ta.department_id = ? OR t.department_id = ?)`,
      [req.params.id, req.hod_department_id, req.hod_department_id]
    );
    if (!assignment.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found in your department' } });

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.params.id]
      );
      await conn.execute(
        `UPDATE attendance_registers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE assignment_id = ?`,
        [req.params.id]
      );
    });
    res.json({ success: true, message: 'Assignment and linked official register archived' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD & CLASS TEACHER DEPARTMENT REPORTS (own dept only, read-only)
// GET /api/v1/hod/reports
// ─────────────────────────────────────────────────────────

router.get('/reports', async (req, res) => {
  const { branch_id, year, semester, date_preset, date_from, date_to, search } = req.query;
  const deptId = req.hod_department_id;

  try {
    const whereClauses = [`d.id = ?`];
    const params = [deptId];

    if (branch_id) {
      whereClauses.push(`d.id = ?`);
      params.push(branch_id);
    }
    if (year) {
      whereClauses.push(`COALESCE(e.year, dev.year) = ?`);
      params.push(year);
    }
    if (semester) {
      whereClauses.push(`COALESCE(e.semester, dev.semester) = ?`);
      params.push(semester);
    }

    if (date_preset === 'today') {
      whereClauses.push(`DATE(ep.scan_time) = CURRENT_DATE`);
    } else if (date_preset === '7days') {
      whereClauses.push(`DATE(ep.scan_time) >= DATE(datetime('now', '-7 days'))`);
    } else if (date_preset === '30days') {
      whereClauses.push(`DATE(ep.scan_time) >= DATE(datetime('now', '-30 days'))`);
    } else if (date_from && date_to) {
      whereClauses.push(`DATE(ep.scan_time) BETWEEN ? AND ?`);
      params.push(date_from, date_to);
    }

    if (search && search.trim()) {
      whereClauses.push(`(st.full_name LIKE ? OR st.official_enrollment_no LIKE ? OR dev.device_uid LIKE ?)`);
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    const whereSql = whereClauses.join(' AND ');

    // 1. KPI Summary
    const kpiRows = await query(
      `SELECT 
         COUNT(ep.id) as total_scans,
         COUNT(DISTINCT ep.student_id) as unique_students,
         COUNT(DISTINCT dev.id) as active_terminals,
         SUM(CASE WHEN DATE(ep.scan_time) = CURRENT_DATE THEN 1 ELSE 0 END) as today_scans
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}`,
      params
    );

    const kpis = {
      total_scans: Number(kpiRows[0]?.total_scans) || 0,
      unique_students: Number(kpiRows[0]?.unique_students) || 0,
      active_terminals: Number(kpiRows[0]?.active_terminals) || 0,
      today_scans: Number(kpiRows[0]?.today_scans) || 0
    };

    // 2. Daily Trend for Visual Charts
    const trendRows = await query(
      `SELECT 
         DATE(ep.scan_time) as date,
         COUNT(ep.id) as scan_count,
         COUNT(DISTINCT ep.student_id) as unique_students
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY DATE(ep.scan_time)
       ORDER BY date ASC
       LIMIT 30`,
      params
    );

    // 3. Cohort Distribution
    const cohortRows = await query(
      `SELECT 
         d.name as branch_name,
         d.code as branch_code,
         COALESCE(e.year, dev.year) as cohort_year,
         COALESCE(e.semester, dev.semester) as cohort_semester,
         COUNT(ep.id) as scan_count
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY d.id, COALESCE(e.year, dev.year), COALESCE(e.semester, dev.semester)
       ORDER BY scan_count DESC`,
      params
    );

    // 4. Detailed ESP Attendance Records
    const records = await query(
      `SELECT 
         ep.id as scan_id,
         ep.event_id,
         ep.scan_time,
         st.id as student_id,
         st.full_name as student_name,
         st.official_enrollment_no,
         e.class_roll_no,
         d.name as department_name,
         d.code as department_code,
         d.name as branch_name,
         d.code as branch_code,
         COALESCE(e.year, dev.year) as year,
         COALESCE(e.semester, dev.semester) as semester,
         dev.id as device_id,
         dev.device_uid,
         dev.name as device_name,
         'PRESENT' as status
       FROM esp32_presence ep
       JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       WHERE ${whereSql}
       ORDER BY ep.scan_time DESC
       LIMIT 300`,
      params
    );

    // 5. Department & Cohort Attendance Summary (Aggregated from ESP Attendance)
    let cohortWhere = ["e.status = 'ENROLLED'", 'e.department_id = ?'];
    let cohortParams = [deptId];
    if (year) {
      cohortWhere.push('e.year = ?');
      cohortParams.push(year);
    }
    if (semester) {
      cohortWhere.push('e.semester = ?');
      cohortParams.push(semester);
    }

    const cohortList = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         COUNT(DISTINCT e.student_id) as enrolled_students
       FROM enrollments e
       JOIN departments d ON e.department_id = d.id
       WHERE ${cohortWhere.join(' AND ')}
       GROUP BY d.id, e.year, e.semester
       ORDER BY e.year, e.semester`,
      cohortParams
    );

    const scanStatsRows = await query(
      `SELECT 
         d.id as department_id,
         d.id as branch_id,
         COALESCE(e.year, dev.year) as year,
         COALESCE(e.semester, dev.semester) as semester,
         COUNT(DISTINCT ep.student_id) as present_students,
         COUNT(ep.id) as total_scans,
         COUNT(DISTINCT dev.id) as active_terminals,
         GROUP_CONCAT(DISTINCT dev.device_uid) as terminal_uids,
         MAX(ep.scan_time) as last_scan_time
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY d.id, COALESCE(e.year, dev.year), COALESCE(e.semester, dev.semester)`,
      params
    );

    const scanStatsMap = new Map();
    scanStatsRows.forEach(row => {
      const key = `${row.year}_${row.semester}`;
      scanStatsMap.set(key, row);
    });

    const cohort_summary = cohortList.map(c => {
      const key = `${c.year}_${c.semester}`;
      const stats = scanStatsMap.get(key) || {};
      const enrolled = Number(c.enrolled_students) || 0;
      const present = Number(stats.present_students) || 0;
      const totalScans = Number(stats.total_scans) || 0;
      const attendancePct = enrolled > 0 ? Math.round((present / enrolled) * 1000) / 10 : 0;
      const activeTerminals = Number(stats.active_terminals) || 0;
      const terminalUids = stats.terminal_uids ? stats.terminal_uids.split(',').filter(Boolean) : [];

      return {
        department_id: c.department_id,
        department_name: c.department_name,
        department_code: c.department_code,
        branch_id: c.branch_id,
        branch_name: c.branch_name,
        branch_code: c.branch_code,
        year: c.year,
        semester: c.semester,
        enrolled_students: enrolled,
        present_students: present,
        attendance_percentage: attendancePct,
        total_scans: totalScans,
        active_terminals: activeTerminals,
        terminal_uids: terminalUids,
        last_scan_time: stats.last_scan_time || null,
        status: attendancePct >= 75 ? 'HEALTHY' : (attendancePct >= 50 ? 'AVERAGE' : 'DEFICIENT')
      };
    });

    res.json({
      success: true,
      data: {
        department_id: deptId,
        department_name: req.hod_department_name,
        is_class_teacher: !!req.is_class_teacher,
        is_hod: !!req.is_hod,
        kpis,
        daily_trend: trendRows.map(r => ({
          date: r.date,
          scan_count: Number(r.scan_count) || 0,
          unique_students: Number(r.unique_students) || 0
        })),
        cohort_distribution: cohortRows.map(r => ({
          branch_name: r.branch_name,
          branch_code: r.branch_code,
          year: r.cohort_year,
          semester: r.cohort_semester,
          scan_count: Number(r.scan_count) || 0
        })),
        records,
        cohort_summary
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD HARDWARE & ESP32 TERMINAL MANAGEMENT
// ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/hod/devices
 * List registered ESP32 terminals for HOD's department
 */
router.get('/devices', async (req, res) => {
  const deptId = req.hod_department_id;
  try {
    const devices = await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              d.department_id, d.department_id as branch_id, d.year, d.semester, d.secret_hash,
              d.assigned_years, d.assigned_semesters,
              dept.name as department_name, dept.code as department_code,
              dept.name as branch_name, dept.code as branch_code,
              (SELECT COUNT(*) FROM fingerprint_slots fs WHERE fs.device_id = d.id AND fs.is_active = 1) as enrolled_count,
              (SELECT COUNT(*) FROM esp32_presence ep WHERE ep.device_id = d.id) as total_scans
       FROM devices d
       LEFT JOIN departments dept ON d.department_id = dept.id
       WHERE d.department_id = ?
       ORDER BY d.name ASC`,
      [deptId]
    );

    const now = new Date();
    const formatted = devices.map(d => {
      let isOnline = false;
      let minutesSinceHeartbeat = null;
      if (d.last_heartbeat_at) {
        const hbTime = new Date(d.last_heartbeat_at);
        minutesSinceHeartbeat = Math.round((now - hbTime) / 60000);
        isOnline = minutesSinceHeartbeat <= 5;
      }

      const yrs = d.assigned_years ? d.assigned_years.split(',').map(y => parseInt(y, 10)).filter(Boolean) : [d.year];
      const sems = d.assigned_semesters ? d.assigned_semesters.split(',').map(s => parseInt(s, 10)).filter(Boolean) : [d.semester];
      
      let cohortScopeLabel = '';
      if (yrs.length > 1) {
        cohortScopeLabel = `Years ${yrs.join(', ')} (Sems ${sems.join(', ')})`;
      } else {
        cohortScopeLabel = `Year ${yrs[0] || d.year} (Sem ${sems.join(', ')})`;
      }

      return {
        ...d,
        assigned_years: yrs,
        assigned_semesters: sems,
        cohort_scope_label: cohortScopeLabel,
        is_online: isOnline,
        minutes_since_heartbeat: minutesSinceHeartbeat,
        total_slots: 1000
      };
    });

    res.json({
      success: true,
      data: formatted,
      department_name: req.hod_department_name
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/devices
 * Register new ESP32 terminal for HOD's department (supports multiple assigned years and automatic semester derivation)
 */
router.post('/devices', requireHOD(), [
  body('device_uid').trim().notEmpty().withMessage('Hardware Device UID is required (e.g. ESP32_IT_01)'),
  body('name').trim().notEmpty().withMessage('Terminal location name is required (e.g. IT Lab 2)'),
  body('branch_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 6 }),
  body('semester').optional().isInt({ min: 1, max: 12 }),
  body('years').optional(),
  body('semesters').optional(),
  validate
], async (req, res) => {
  const deptId = req.hod_department_id;
  let { device_uid, name, branch_id, year = 1, semester = 1, years, semesters, secret_key } = req.body;

  try {
    const existing = await query(`SELECT id FROM devices WHERE device_uid = ?`, [device_uid.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `Hardware terminal with UID "${device_uid}" is already registered` }
      });
    }

    const ayId = (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id || 1;
    const finalSecret = secret_key && secret_key.trim() ? secret_key.trim() : 'secret_' + crypto.randomBytes(4).toString('hex');

    // Parse multi-year assignment
    let assignedYearsStr = null;
    let assignedSemestersStr = null;
    let parsedYears = [];
    let parsedSemesters = [];

    if (Array.isArray(years) && years.length > 0) {
      parsedYears = [...new Set(years.map(y => parseInt(y, 10)).filter(y => !isNaN(y) && y > 0))].sort((a, b) => a - b);
      assignedYearsStr = parsedYears.join(',');
      year = parsedYears[0];
    } else if (typeof years === 'string' && years.trim()) {
      parsedYears = [...new Set(years.trim().split(',').map(y => parseInt(y, 10)).filter(y => !isNaN(y) && y > 0))].sort((a, b) => a - b);
      assignedYearsStr = parsedYears.join(',');
      year = parsedYears[0] || parseInt(year, 10) || 1;
    } else {
      year = parseInt(year, 10) || 1;
      parsedYears = [year];
      assignedYearsStr = String(year);
    }

    // Automatically calculate semesters from parsedYears if not explicitly provided
    if (Array.isArray(semesters) && semesters.length > 0) {
      parsedSemesters = [...new Set(semesters.map(s => parseInt(s, 10)).filter(s => !isNaN(s) && s > 0))].sort((a, b) => a - b);
      assignedSemestersStr = parsedSemesters.join(',');
      semester = parsedSemesters[0];
    } else if (typeof semesters === 'string' && semesters.trim()) {
      parsedSemesters = [...new Set(semesters.trim().split(',').map(s => parseInt(s, 10)).filter(s => !isNaN(s) && s > 0))].sort((a, b) => a - b);
      assignedSemestersStr = parsedSemesters.join(',');
      semester = parsedSemesters[0] || parseInt(semester, 10) || 1;
    } else {
      parsedSemesters = [];
      parsedYears.forEach(y => {
        parsedSemesters.push((y * 2) - 1, y * 2);
      });
      parsedSemesters = [...new Set(parsedSemesters)].sort((a, b) => a - b);
      assignedSemestersStr = parsedSemesters.join(',');
      semester = parsedSemesters[0] || 1;
    }

    const result = await query(
      `INSERT INTO devices (device_uid, name, department_id, year, semester, assigned_years, assigned_semesters, academic_year_id, secret_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [device_uid.trim(), name.trim(), deptId, parseInt(year, 10), parseInt(semester, 10), assignedYearsStr, assignedSemestersStr, ayId, finalSecret]
    );
    const newId = result.insertId ?? result.lastInsertRowid;

    // Log to audit trail
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
       VALUES (?, 'DEVICE_REGISTERED', 'devices', ?, ?)`,
      [req.user.id, String(newId), JSON.stringify({ device_uid: device_uid.trim(), name: name.trim(), department_id: deptId })]
    );

    res.status(201).json({
      success: true,
      message: `ESP32 Terminal "${name}" (${device_uid}) registered successfully for ${req.hod_department_name}.`,
      data: {
        id: newId,
        device_uid: device_uid.trim(),
        name: name.trim(),
        department_id: deptId,
        secret_key: finalSecret
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * PATCH /api/v1/hod/devices/:id/toggle
 * Toggle terminal active / disabled status
 */
router.patch('/devices/:id/toggle', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  const devId = req.params.id;

  try {
    const dev = await query(`SELECT id, is_active, name FROM devices WHERE id = ? AND department_id = ?`, [devId, deptId]);
    if (!dev.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found in your department' } });
    }

    const newStatus = dev[0].is_active ? 0 : 1;
    await query(`UPDATE devices SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newStatus, devId]);

    res.json({
      success: true,
      message: `Device "${dev[0].name}" is now ${newStatus ? 'active' : 'disabled'}.`,
      data: { id: devId, is_active: newStatus }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * DELETE /api/v1/hod/devices/:id
 * Remove hardware terminal from department
 */
router.delete('/devices/:id', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  const devId = req.params.id;

  try {
    const dev = await query(`SELECT id, name, device_uid FROM devices WHERE id = ? AND department_id = ?`, [devId, deptId]);
    if (!dev.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found in your department' } });
    }

    await withTransaction(async (conn) => {
      await conn.execute(`DELETE FROM fingerprint_slots WHERE device_id = ?`, [devId]);
      await conn.execute(`DELETE FROM devices WHERE id = ?`, [devId]);
    });

    res.json({
      success: true,
      message: `Device "${dev[0].name}" (${dev[0].device_uid}) was removed from your department.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD STUDENT VISIBILITY (read-only, own dept, all cohorts)
// GET /api/v1/hod/students?branch_id=&year=&semester=
// ─────────────────────────────────────────────────────────

router.get('/students', async (req, res) => {
  const { branch_id, year, semester, academic_year_id } = req.query;
  const deptId = req.hod_department_id;

  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;

    let filter = `e.department_id = ?`;
    const params = [deptId];
    if (ayId) { filter += ` AND e.academic_year_id = ?`; params.push(ayId); }
    if (branch_id) { filter += ` AND e.department_id = ?`; params.push(branch_id); }
    if (year) { filter += ` AND e.year = ?`; params.push(year); }
    if (semester) { filter += ` AND e.semester = ?`; params.push(semester); }
    if (req.query.status) {
      filter += ` AND e.status = ?`;
      params.push(req.query.status);
    } else {
      filter += ` AND e.status != 'WITHDRAWN'`;
    }

    const students = await query(
      `SELECT st.id, st.full_name, u.email, st.official_enrollment_no, st.official_enrollment_no as enrollment_no, st.registration_no,
              COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
              e.year, e.semester, e.status as enrollment_status,
              d.name as branch_name, d.code as branch_code,
              u.status as account_status,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked
       FROM students st
       JOIN users u ON st.user_id = u.id
       JOIN enrollments e ON e.student_id = st.id
       JOIN departments d ON e.department_id = d.id
       WHERE ${filter}
       ORDER BY e.year, e.semester, e.class_roll_no`,
      params
    );

    res.json({ success: true, data: students, total: students.length });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HELPER: Re-index Class Roll Numbers Alphabetically (1..N)
// ─────────────────────────────────────────────────────────
async function reindexCohortRollNumbers(deptId, year, semester, academicYearId, conn = null) {
  const q = conn ? (sql, params) => conn.execute(sql, params) : query;
  
  const rows = await q(
    `SELECT e.id, s.id as student_id, s.full_name 
     FROM enrollments e
     JOIN students s ON e.student_id = s.id
     WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
     ORDER BY s.full_name COLLATE NOCASE ASC, s.official_enrollment_no ASC`,
    [deptId, year, semester, academicYearId]
  );
  
  const enrollments = Array.isArray(rows[0]) && Array.isArray(rows) && rows[0].id === undefined ? rows[0] : rows;
  if (!enrollments || !enrollments.length) return 0;

  // Step 1: Temporarily negate roll numbers with distinct negative values to avoid unique constraint collisions
  for (let i = 0; i < enrollments.length; i++) {
    const tempNeg = -((enrollments[i].id * 1000) + i + 1);
    await q(`UPDATE enrollments SET class_roll_no = ? WHERE id = ?`, [tempNeg, enrollments[i].id]);
  }

  // Step 2: Assign clean sequential positive numbers 1, 2, 3... N to enrollments & students
  for (let i = 0; i < enrollments.length; i++) {
    const newRoll = i + 1;
    await q(`UPDATE enrollments SET class_roll_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newRoll, enrollments[i].id]);
    await q(`UPDATE students SET class_roll_no = ? WHERE id = ?`, [newRoll, enrollments[i].student_id]);
    await q(
      `UPDATE student_department_enrollments SET class_roll_no = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
      [newRoll, enrollments[i].student_id, deptId]
    );
  }
  return enrollments.length;
}

// ─────────────────────────────────────────────────────────
// HOD STUDENT MANAGEMENT: ADD STUDENT (SINGLE)
// POST /api/v1/hod/students
// ─────────────────────────────────────────────────────────
router.post('/students', requireHOD(), [
  body('official_enrollment_no').trim().notEmpty().withMessage('Official enrollment number required'),
  body('full_name').trim().notEmpty().withMessage('Student full name required'),
  body('email').optional().trim().isEmail().withMessage('Valid email required'),
  body('initial_password').optional().trim(),
  body('academic_year_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  body('is_lateral_entry').optional().isBoolean(),
  validate
], async (req, res) => {
  const { official_enrollment_no, registration_no, full_name, email, year, semester, is_lateral_entry, academic_year_id, initial_password } = req.body;
  const deptId = req.hod_department_id;

  try {
    const deptRows = await query('SELECT degree_duration_years FROM departments WHERE id = ?', [deptId]);
    const maxYears = deptRows[0]?.degree_duration_years || 3;
    if (year > maxYears || semester > maxYears * 2) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Year ${year} or Semester ${semester} exceeds department degree duration of ${maxYears} Years (Max Semester ${maxYears * 2})` }
      });
    }

    let ayId = academic_year_id;
    if (ayId) {
      const checkAy = await query('SELECT id FROM academic_years WHERE id = ?', [ayId]);
      if (!checkAy.length) ayId = null;
    }
    if (!ayId) {
      const ayRow = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
      if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
      ayId = ayRow.id;
    }

    const existingUser = await query('SELECT id FROM users WHERE username = ?', [official_enrollment_no.trim()]);
    if (existingUser.length > 0) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Enrollment number "${official_enrollment_no}" already exists` } });
    }

    const tempPassword = (initial_password && initial_password.trim()) ? initial_password.trim() : 'Password@123';
    const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

    const newStudent = await withTransaction(async (conn) => {
      // 1. Create User
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, 1, 'PROVISIONED')`,
        [official_enrollment_no.trim(), email?.trim() || null, tempPasswordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      // 2. Assign Role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

      // 3. Create Student Profile with UBTER registration_no
      const [sRes] = await conn.execute(
        `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, entry_mode, is_lateral_entry, admission_year)
         VALUES (?, ?, ?, ?, 'hod_provisioned', ?, ?)`,
        [userId, official_enrollment_no.trim(), (registration_no || '').trim() || null, full_name.trim(), is_lateral_entry ? 1 : 0, new Date().getFullYear()]
      );
      const studentId = sRes.insertId ?? sRes.lastInsertRowid;

      // 4. Create Initial Enrollment with unique negative placeholder roll to prevent collision
      const tempRoll = -((userId * 1000) + 1);
      const [eRes] = await conn.execute(
        `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
        [studentId, deptId, year, semester, ayId, tempRoll]
      );

      // 5. Automatically re-index roll numbers in alphabetical order
      await reindexCohortRollNumbers(deptId, year, semester, ayId, conn);

      // Fetch assigned class roll number
      const [assignedRow] = await conn.execute('SELECT class_roll_no FROM enrollments WHERE id = ?', [eRes.insertId ?? eRes.lastInsertRowid]);
      const class_roll_no = (Array.isArray(assignedRow) ? assignedRow[0] : assignedRow)?.class_roll_no;

      return {
        student_id: studentId,
        official_enrollment_no: official_enrollment_no.trim(),
        enrollment_no: official_enrollment_no.trim(),
        registration_no: (registration_no || '').trim() || null,
        full_name: full_name.trim(),
        class_roll_no,
        temp_password: tempPassword,
        year,
        semester
      };
    });

    res.status(201).json({
      success: true,
      message: `Student "${full_name}" enrolled with Class Roll #${newStudent.class_roll_no}`,
      data: newStudent
    });
  } catch (err) {
    console.error('HOD POST /students error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD STUDENT MANAGEMENT: BULK CSV PROVISIONING
// POST /api/v1/hod/students/bulk
// ─────────────────────────────────────────────────────────
router.post('/students/bulk', requireHOD(), [
  body('academic_year_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  body('students').isArray({ min: 1 }).withMessage('Students list required'),
  validate
], async (req, res) => {
  const { year, semester, students, academic_year_id } = req.body;
  const deptId = req.hod_department_id;

  try {
    let ayId = academic_year_id;
    if (ayId) {
      const checkAy = await query('SELECT id FROM academic_years WHERE id = ?', [ayId]);
      if (!checkAy.length) ayId = null;
    }
    if (!ayId) {
      const ayRow = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
      if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
      ayId = ayRow.id;
    }

    const createdList = [];
    const errors = [];

    await withTransaction(async (conn) => {
      for (const st of students) {
        const enrollNo = (st.official_enrollment_no || '').trim();
        const name = (st.full_name || '').trim();
        if (!enrollNo || !name) {
          errors.push('Skipped record: missing enrollment number or name');
          continue;
        }

        const [existing] = await conn.execute('SELECT id FROM users WHERE username = ?', [enrollNo]);
        if (existing && existing.length > 0) {
          errors.push(`Enrollment "${enrollNo}" already exists`);
          continue;
        }

        const tempPass = (st.initial_password && st.initial_password.trim()) ? st.initial_password.trim() : 'Password@123';
        const passHash = await bcrypt.hash(tempPass, 12);

        const [uRes] = await conn.execute(
          `INSERT INTO users (username, email, temp_password_hash, must_change_password, status)
           VALUES (?, ?, ?, 1, 'PROVISIONED')`,
          [enrollNo, st.email?.trim() || null, passHash]
        );
        const userId = uRes.insertId ?? uRes.lastInsertRowid;

        await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

        const regNo = (st.registration_no || '').trim() || null;
        const [sRes] = await conn.execute(
          `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, entry_mode, is_lateral_entry, admission_year)
           VALUES (?, ?, ?, ?, 'hod_provisioned', ?, ?)`,
          [userId, enrollNo, regNo, name, st.is_lateral_entry ? 1 : 0, new Date().getFullYear()]
        );
        const studentId = sRes.insertId ?? sRes.lastInsertRowid;

        const tempRoll = -((studentId * 1000) + createdList.length + 1);
        await conn.execute(
          `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
           VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
          [studentId, deptId, year, semester, ayId, tempRoll]
        );

        createdList.push({
          student_id: studentId,
          official_enrollment_no: enrollNo,
          enrollment_no: enrollNo,
          registration_no: regNo,
          full_name: name,
          temp_password: tempPass
        });
      }

      // Re-index all students in cohort alphabetically
      await reindexCohortRollNumbers(deptId, year, semester, ayId, conn);
    });

    res.status(201).json({
      success: true,
      message: `Successfully provisioned ${createdList.length} students with alphabetical roll numbers.`,
      data: { count: createdList.length, students: createdList, errors }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD STUDENT MANAGEMENT: DELETE STUDENT (LEFT COLLEGE)
// & AUTOMATIC ROLL NUMBER RE-INDEXING (NO GAPS)
// DELETE /api/v1/hod/students/:id
// ─────────────────────────────────────────────────────────
router.delete('/students/:id', requireHOD(), [
  param('id').isInt(),
  validate
], async (req, res) => {
  const studentId = req.params.id;
  const deptId = req.hod_department_id;

  try {
    const studentRows = await query(
      `SELECT s.id, s.user_id, s.full_name, s.official_enrollment_no, e.year, e.semester, e.academic_year_id, e.class_roll_no
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE s.id = ? AND e.department_id = ? AND e.status = 'ENROLLED'
       ORDER BY e.id DESC LIMIT 1`,
      [studentId, deptId]
    );

    if (!studentRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Active enrolled student not found in your department' } });
    }

    const st = studentRows[0];

    await withTransaction(async (conn) => {
      // 1. Cleanly delete dependent student records
      await conn.execute(`DELETE FROM leave_applications WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM attendance_session_students WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM register_attendance WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM student_self_attendance WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM esp32_presence WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM fingerprint_slots WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM enrollments WHERE student_id = ?`, [studentId]);
      await conn.execute(`DELETE FROM students WHERE id = ?`, [studentId]);
      await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [st.user_id]);
      await conn.execute(`DELETE FROM users WHERE id = ?`, [st.user_id]);

      // 2. Automatically re-index remaining students in this cohort sequentially without gaps
      await reindexCohortRollNumbers(deptId, st.year, st.semester, st.academic_year_id, conn);
    });

    res.json({
      success: true,
      message: `Student "${st.full_name}" (${st.official_enrollment_no}) deleted from database. Class roll numbers for Year ${st.year} Semester ${st.semester} were automatically re-indexed without gaps.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD STUDENT MANAGEMENT: RESET STUDENT PASSWORD
// POST /api/v1/hod/students/:id/reset-password
// ─────────────────────────────────────────────────────────
router.post('/students/:id/reset-password', requireHOD(), [
  param('id').isInt(),
  body('new_password').trim().notEmpty().withMessage('New password is required'),
  validate
], async (req, res) => {
  try {
    const studentRows = await query(
      `SELECT st.id, st.user_id, st.full_name, st.official_enrollment_no, e.department_id
       FROM students st
       JOIN enrollments e ON e.student_id = st.id
       WHERE st.id = ? AND e.department_id = ?`,
      [req.params.id, req.hod_department_id]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found in your department' } });
    }

    const newPass = req.body.new_password;
    const newPassHash = await bcrypt.hash(newPass, 12);
    await query(
      `UPDATE users SET password_hash = ?, temp_password_hash = ?, must_change_password = 1,
       status = 'PROVISIONED', google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newPassHash, newPassHash, studentRows[0].user_id]
    );
    await query(`UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?`, [studentRows[0].user_id]);

    res.json({
      success: true,
      message: `Password for ${studentRows[0].full_name} (${studentRows[0].official_enrollment_no}) has been reset successfully.`,
      data: {
        student_id: studentRows[0].id,
        official_enrollment_no: studentRows[0].official_enrollment_no,
        full_name: studentRows[0].full_name,
        temp_password: newPass
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});


// ─────────────────────────────────────────────────────────
// HOD: RE-INDEX ROLL NUMBERS ALPHABETICALLY ON-DEMAND
// POST /api/v1/hod/students/reindex-roll
// ─────────────────────────────────────────────────────────
router.post('/students/reindex-roll', requireHOD(), [
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  validate
], async (req, res) => {
  const { year, semester } = req.body;
  const deptId = req.hod_department_id;

  try {
    const ayRow = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });

    const count = await reindexCohortRollNumbers(deptId, year, semester, ayRow.id);
    res.json({
      success: true,
      message: `Successfully re-indexed ${count} students alphabetically for Year ${year} Semester ${semester}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD: DEPARTMENT SETTINGS & POLICIES
// GET /api/v1/hod/settings
// PUT /api/v1/hod/settings
// ─────────────────────────────────────────────────────────
router.get('/settings', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  try {
    const deptRows = await query(
      `SELECT d.id, d.name, d.code, d.degree_duration_years, d.active_term,
              COALESCE(t.full_name, u.username) as hod_name, u.email as hod_email, u.username as hod_username
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       WHERE d.id = ?`,
      [deptId]
    );
    if (!deptRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

    // Defaulter threshold from system_settings or default 75
    const threshRow = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [`dept_${deptId}_attendance_threshold`]);
    const threshold = threshRow.length ? parseInt(threshRow[0].setting_value, 10) : 75;

    // Counts
    const teachersCount = (await query(`SELECT COUNT(*) as cnt FROM teacher_assignments WHERE department_id = ? AND is_active = 1`, [deptId]))[0]?.cnt || 0;
    const studentsCount = (await query(`SELECT COUNT(DISTINCT student_id) as cnt FROM enrollments WHERE department_id = ? AND status = 'ENROLLED'`, [deptId]))[0]?.cnt || 0;
    const terminalsCount = (await query(`SELECT COUNT(*) as cnt FROM devices WHERE department_id = ? AND is_active = 1`, [deptId]))[0]?.cnt || 0;
    const currentAy = (await query('SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    const defaultTerm = currentAy?.label || 'Active Session';

    res.json({
      success: true,
      data: {
        department_id: deptId,
        department_name: deptRows[0].name,
        department_code: deptRows[0].code,
        degree_duration_years: deptRows[0].degree_duration_years || 3,
        active_term: deptRows[0].active_term || defaultTerm,
        defaulter_threshold_percent: threshold,
        hod_name: deptRows[0].hod_name || req.user.full_name || 'HOD In-Charge',
        hod_email: deptRows[0].hod_email || req.user.email,
        teachers_count: teachersCount,
        students_count: studentsCount,
        terminals_count: terminalsCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/settings', requireHOD(), [
  body('degree_duration_years').optional().isInt({ min: 1, max: 4 }),
  body('active_term').optional().isString().trim().notEmpty(),
  body('defaulter_threshold_percent').optional().isInt({ min: 50, max: 100 }),
  validate
], async (req, res) => {
  const deptId = req.hod_department_id;
  const { degree_duration_years, active_term, defaulter_threshold_percent } = req.body;

  try {
    if (degree_duration_years) {
      await query(`UPDATE departments SET degree_duration_years = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [degree_duration_years, deptId]);
    }
    if (active_term) {
      await query(`UPDATE departments SET active_term = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [active_term, deptId]);
    }
    if (defaulter_threshold_percent) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [`dept_${deptId}_attendance_threshold`, String(defaulter_threshold_percent), req.user.id]
      );
    }

    res.json({
      success: true,
      message: 'Department settings and policies updated successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD: DEGREE DURATION SETTINGS
// GET /api/v1/hod/settings/duration
// POST /api/v1/hod/settings/duration (2-step verification)
// ─────────────────────────────────────────────────────────
router.get('/settings/duration', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  try {
    const rows = await query('SELECT degree_duration_years, active_term, name, code FROM departments WHERE id = ?', [deptId]);
    if (!rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });
    const currentAy = (await query('SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    const defaultTerm = currentAy?.label || 'Active Session';
    res.json({
      success: true,
      data: {
        degree_duration_years: rows[0].degree_duration_years || 3,
        active_term: rows[0].active_term || defaultTerm,
        department_name: rows[0].name,
        department_code: rows[0].code
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.post('/settings/duration', requireHOD(), [
  body('duration_years').isInt({ min: 1, max: 4 }).withMessage('Duration years must be between 1 and 4'),
  body('confirm_code').trim().notEmpty().withMessage('Confirmation code required'),
  validate
], async (req, res) => {
  const deptId = req.hod_department_id;
  const { duration_years, confirm_code } = req.body;

  try {
    const rows = await query('SELECT code, name FROM departments WHERE id = ?', [deptId]);
    if (!rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

    if (confirm_code.toUpperCase() !== rows[0].code.toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Confirmation code does not match department code "${rows[0].code}". Change aborted.` }
      });
    }

    await query('UPDATE departments SET degree_duration_years = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [duration_years, deptId]);
    res.json({
      success: true,
      message: `Degree duration successfully updated to ${duration_years} Years (Semesters 1 to ${duration_years * 2}).`,
      data: { degree_duration_years: duration_years }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// HOD: SEMESTER PROMOTION & DEMOTION CONTROL ENGINE
// GET /api/v1/hod/promotion/preview?action=promote|demote
// POST /api/v1/hod/promotion/execute
// ─────────────────────────────────────────────────────────
router.get('/promotion/preview', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  const action = req.query.action === 'demote' ? 'demote' : 'promote';

  try {
    const deptRow = (await query('SELECT degree_duration_years, active_term, code, name FROM departments WHERE id = ?', [deptId]))[0];
    const durationYears = deptRow?.degree_duration_years || 3;
    const activeTerm = deptRow?.active_term || 'ODD';
    const maxSem = durationYears * 2;

    const ayRow = (await query('SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
    const ayId = ayRow.id;

    if (action === 'demote') {
      // Fetch students in this department: active enrolled, recently graduated/completed, or detained
      const enrollments = await query(
        `SELECT e.id, e.student_id, e.year, e.semester, e.class_roll_no, e.status, s.full_name, s.official_enrollment_no, s.is_lateral_entry
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status IN ('ENROLLED', 'COMPLETED', 'DETAINED')
         ORDER BY e.status, e.year DESC, e.semester DESC, e.class_roll_no`,
        [deptId, ayId]
      );

      const cohortsMap = {};
      let eligibleCount = 0;

      enrollments.forEach(st => {
        let key, currentYear, currentSem, targetYear, targetSem, canDemote = true, note = '';

        if (st.status === 'COMPLETED') {
          key = 'COMPLETED_ALUMNI';
          currentYear = durationYears;
          currentSem = maxSem;
          targetYear = durationYears;
          targetSem = maxSem;
          note = 'Revert from Graduated to Active Final Semester';
          eligibleCount++;
        } else if (st.status === 'DETAINED') {
          key = `DETAINED_Y${st.year}_S${st.semester}`;
          currentYear = st.year;
          currentSem = st.semester;
          targetYear = st.year;
          targetSem = st.semester;
          note = 'Reactivate Detained Student in Current Semester';
          eligibleCount++;
        } else if (st.semester > 1) {
          key = `Y${st.year}_S${st.semester}`;
          currentYear = st.year;
          currentSem = st.semester;
          targetSem = st.semester - 1;
          targetYear = Math.floor((targetSem - 1) / 2) + 1;
          note = `Demote: Year ${currentYear} Sem ${currentSem} → Year ${targetYear} Sem ${targetSem}`;
          eligibleCount++;
        } else {
          key = `BASE_Y1_S1`;
          currentYear = 1;
          currentSem = 1;
          targetYear = 1;
          targetSem = 1;
          canDemote = false;
          note = 'Already at base Semester 1 (Cannot demote further)';
        }

        if (!cohortsMap[key]) {
          cohortsMap[key] = {
            current_year: currentYear,
            current_sem: currentSem,
            current_status: st.status,
            target_year: targetYear,
            target_sem: targetSem,
            can_demote: canDemote,
            note: note,
            students: []
          };
        }

        cohortsMap[key].students.push({
          id: st.id,
          student_id: st.student_id,
          official_enrollment_no: st.official_enrollment_no,
          full_name: st.full_name,
          class_roll_no: st.class_roll_no,
          status: st.status,
          can_demote: canDemote,
          is_lateral_entry: !!st.is_lateral_entry
        });
      });

      return res.json({
        success: true,
        data: {
          action: 'demote',
          department_name: deptRow.name,
          department_code: deptRow.code,
          degree_duration_years: durationYears,
          academic_year_label: ayRow.label,
          total_students: enrollments.length,
          eligible_count: eligibleCount,
          cohorts: Object.values(cohortsMap)
        }
      });
    }

    // Default: 'promote' action
    const enrollments = await query(
      `SELECT e.id, e.student_id, e.year, e.semester, e.class_roll_no, s.full_name, s.official_enrollment_no, s.is_lateral_entry
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY e.year, e.semester, e.class_roll_no`,
      [deptId, ayId]
    );

    const isMidYear = activeTerm === 'ODD';
    const cohortsMap = {};

    enrollments.forEach(st => {
      const sem = st.semester;
      const yr = st.year;
      const key = `Y${yr}_S${sem}`;

      if (!cohortsMap[key]) {
        let targetYear = yr;
        let targetSem = sem + 1;
        let isGraduating = false;

        if (sem >= maxSem) {
          isGraduating = true;
          targetYear = 'GRADUATED';
          targetSem = 'ALUMNI';
        } else if (sem % 2 === 1) {
          // Odd to Even: Year stays same, Semester increments by 1
          targetYear = yr;
          targetSem = sem + 1;
        } else {
          // Even to Next Year Odd: Both Year & Semester increment by 1
          targetYear = yr + 1;
          targetSem = sem + 1;
        }

        cohortsMap[key] = {
          current_year: yr,
          current_sem: sem,
          target_year: targetYear,
          target_sem: targetSem,
          is_graduating: isGraduating,
          students: []
        };
      }

      cohortsMap[key].students.push({
        id: st.id,
        student_id: st.student_id,
        official_enrollment_no: st.official_enrollment_no,
        full_name: st.full_name,
        class_roll_no: st.class_roll_no,
        is_lateral_entry: !!st.is_lateral_entry
      });
    });

    const cohorts = Object.values(cohortsMap);
    const graduatingCount = cohorts.filter(c => c.is_graduating).reduce((sum, c) => sum + c.students.length, 0);
    const continuingCount = enrollments.length - graduatingCount;

    res.json({
      success: true,
      data: {
        action: 'promote',
        department_name: deptRow.name,
        department_code: deptRow.code,
        degree_duration_years: durationYears,
        current_active_term: activeTerm,
        target_term: activeTerm === 'ODD' ? 'EVEN' : 'ODD',
        academic_year_label: ayRow.label,
        is_mid_year: isMidYear,
        total_students: enrollments.length,
        graduating_count: graduatingCount,
        continuing_count: continuingCount,
        cohorts
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.post('/promotion/execute', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  const { action = 'promote', exceptions = [], confirm_code } = req.body;

  try {
    const deptRow = (await query('SELECT degree_duration_years, active_term, code FROM departments WHERE id = ?', [deptId]))[0];
    const durationYears = deptRow?.degree_duration_years || 3;
    const maxSem = durationYears * 2;

    // Accidental modification safety check: Require matching department code
    const expectedCode = (deptRow?.code || '').trim().toUpperCase();
    const providedCode = (confirm_code || '').trim().toUpperCase();

    if (!providedCode || providedCode !== expectedCode) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Safety confirmation failed: Please enter your Department Code ("${expectedCode}") to confirm cohort changes.`
        }
      });
    }

    const ayRow = (await query('SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
    const ayId = ayRow.id;

    // ─── DEMOTION / ROLLBACK EXECUTION ───────────────────────
    if (action === 'demote') {
      const enrollments = await query(
        `SELECT e.id, e.student_id, e.year, e.semester, e.status, s.user_id 
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status IN ('ENROLLED', 'COMPLETED', 'DETAINED')`,
        [deptId, ayId]
      );

      const skippedIds = new Set((exceptions || []).map(Number));
      let demotedCount = 0;
      const cohortsToReindex = new Set();

      await withTransaction(async (conn) => {
        // Temporarily negate roll numbers to prevent unique constraint collisions
        await conn.execute(
          `UPDATE enrollments SET class_roll_no = -(id * 1000) WHERE department_id = ? AND academic_year_id = ? AND status = 'ENROLLED'`,
          [deptId, ayId]
        );

        for (const en of enrollments) {
          if (skippedIds.has(en.student_id)) {
            continue; // Skipped / exempted from demotion
          }

          if (en.status === 'COMPLETED') {
            // Revert from graduated alumni to active enrolled in final year/semester
            await conn.execute(`UPDATE enrollments SET status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
            await conn.execute(`UPDATE users SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.user_id]);
            await conn.execute(`UPDATE students SET graduation_year = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.student_id]);
            await conn.execute(
              `UPDATE student_department_enrollments SET status = 'ACTIVE', end_date = NULL, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ?`,
              [en.student_id, deptId]
            );
            cohortsToReindex.add(`${durationYears}_${maxSem}`);
            demotedCount++;
          } else if (en.status === 'DETAINED') {
            // Restore detained student back to active enrolled in current cohort
            await conn.execute(`UPDATE enrollments SET status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
            await conn.execute(
              `UPDATE student_department_enrollments SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ?`,
              [en.student_id, deptId]
            );
            cohortsToReindex.add(`${en.year}_${en.semester}`);
            demotedCount++;
          } else if (en.semester > 1) {
            // Demote by one semester
            const targetSem = en.semester - 1;
            const targetYr = Math.floor((targetSem - 1) / 2) + 1;
            await conn.execute(
              `UPDATE enrollments SET year = ?, semester = ?, status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [targetYr, targetSem, en.id]
            );
            await conn.execute(
              `UPDATE student_department_enrollments SET year = ?, semester = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
              [targetYr, targetSem, en.student_id, deptId]
            );
            cohortsToReindex.add(`${targetYr}_${targetSem}`);
            demotedCount++;
          }
        }

        // Re-index roll numbers alphabetically for each modified target cohort
        for (const cKey of cohortsToReindex) {
          const [yStr, sStr] = cKey.split('_');
          await reindexCohortRollNumbers(deptId, parseInt(yStr, 10), parseInt(sStr, 10), ayId, conn);
        }
      });

      // Audit log demotion execution
      await logAudit({
        actorId: req.user.id,
        actorRole: 'HOD',
        eventType: 'STUDENT_DEMOTION_EXECUTED',
        action: 'STUDENT_DEMOTION_EXECUTED',
        targetType: 'departments',
        targetId: String(deptId),
        details: {
          department_code: expectedCode,
          demoted_count: demotedCount
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.json({
        success: true,
        message: `Demotion / Reversal successfully executed! Reverted ${demotedCount} students to their previous semester.`,
        data: {
          demoted_count: demotedCount,
          action: 'demote'
        }
      });
    }

    // ─── PROMOTION EXECUTION ─────────────────────────────────
    const enrollments = await query(
      `SELECT e.id, e.student_id, e.year, e.semester, s.user_id 
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'`,
      [deptId, ayId]
    );

    const detainedIds = new Set((exceptions || []).map(Number));
    let promotedCount = 0;
    let graduatedCount = 0;
    let detainedCount = 0;

    const promotedStudents = [];
    const graduatedStudents = [];
    const detainedStudents = [];

    const cohortsToReindex = new Set();

    await withTransaction(async (conn) => {
      // Temporarily negate roll numbers to prevent any unique constraint collisions during mid-step transitions
      await conn.execute(
        `UPDATE enrollments SET class_roll_no = -(id * 1000) WHERE department_id = ? AND academic_year_id = ? AND status = 'ENROLLED'`,
        [deptId, ayId]
      );

      for (const en of enrollments) {
        if (detainedIds.has(en.student_id)) {
          // Detained in current sem
          await conn.execute(`UPDATE enrollments SET status = 'DETAINED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'DETAINED', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          detainedCount++;
          detainedStudents.push({ student_id: en.student_id, user_id: en.user_id, sem: en.semester });
          continue;
        }

        if (en.semester >= maxSem) {
          // Graduated completely -> Archive as ALUMNI
          const gradYear = new Date().getFullYear();
          await conn.execute(`UPDATE enrollments SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
          await conn.execute(`UPDATE users SET status = 'ALUMNI', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.user_id]);
          await conn.execute(`UPDATE students SET graduation_year = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [gradYear, en.student_id]);
          // Free up ESP32 reader hardware slot for incoming freshers
          await conn.execute(`UPDATE fingerprint_slots SET is_active = 0 WHERE student_id = ?`, [en.student_id]);
          // Close active time-aware department enrollment
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'GRADUATED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          graduatedCount++;
          graduatedStudents.push({ student_id: en.student_id, user_id: en.user_id });
        } else if (en.semester % 2 === 1) {
          // Odd -> Even: Year stays same, Semester increments by 1
          const nextSem = en.semester + 1;
          await conn.execute(`UPDATE enrollments SET semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextSem, en.id]);
          // Close old active enrollment entry
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          // Open new active enrollment entry for next semester
          await conn.execute(
            `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
            [en.student_id, deptId, ayId, en.year, nextSem, en.class_roll_no || null]
          );
          cohortsToReindex.add(`${en.year}_${nextSem}`);
          promotedCount++;
          promotedStudents.push({ student_id: en.student_id, user_id: en.user_id, nextYr: en.year, nextSem });
        } else {
          // Even -> Next Odd: Both Year & Semester increment by 1
          const nextYr = en.year + 1;
          const nextSem = en.semester + 1;
          await conn.execute(`UPDATE enrollments SET year = ?, semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextYr, nextSem, en.id]);
          // Close old active enrollment entry
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          // Open new active enrollment entry for next semester
          await conn.execute(
            `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
            [en.student_id, deptId, ayId, nextYr, nextSem, en.class_roll_no || null]
          );
          cohortsToReindex.add(`${nextYr}_${nextSem}`);
          promotedCount++;
          promotedStudents.push({ student_id: en.student_id, user_id: en.user_id, nextYr, nextSem });
        }
      }

      // Re-index roll numbers alphabetically for each target cohort (also syncs student_department_enrollments)
      for (const cKey of cohortsToReindex) {
        const [yStr, sStr] = cKey.split('_');
        await reindexCohortRollNumbers(deptId, parseInt(yStr, 10), parseInt(sStr, 10), ayId, conn);
      }
    });

    // Audit log promotion execution
    await logAudit({
      actorId: req.user.id,
      actorRole: 'HOD',
      eventType: 'STUDENT_PROMOTION_EXECUTED',
      action: 'STUDENT_PROMOTION_EXECUTED',
      targetType: 'departments',
      targetId: String(deptId),
      details: {
        department_code: expectedCode,
        promoted_count: promotedCount,
        graduated_count: graduatedCount,
        detained_count: detainedCount
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // In-app notifications to affected students
    for (const ps of promotedStudents) {
      notificationService.sendNotification({
        userId: ps.user_id,
        type: 'ENROLLMENT_CHANGE',
        title: '🎓 Semester Promoted',
        message: `Congratulations! You have been promoted to Year ${ps.nextYr}, Semester ${ps.nextSem}.`,
        link: '/student/dashboard.html'
      }).catch(() => {});
    }

    for (const gs of graduatedStudents) {
      notificationService.sendNotification({
        userId: gs.user_id,
        type: 'ENROLLMENT_CHANGE',
        title: '🎉 Curriculum Completed',
        message: 'Congratulations! You have successfully completed your academic program and graduated as Alumni.',
        link: '/student/profile.html'
      }).catch(() => {});
    }

    for (const ds of detainedStudents) {
      notificationService.sendNotification({
        userId: ds.user_id,
        type: 'ENROLLMENT_CHANGE',
        title: '⚠️ Semester Detention Notice',
        message: `You have been detained in Semester ${ds.sem}. Please consult your Department HOD for guidance.`,
        link: '/student/dashboard.html'
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Promotion successfully executed! Promoted: ${promotedCount}, Graduated: ${graduatedCount}${detainedCount > 0 ? `, Detained: ${detainedCount}` : ''}.`,
      data: {
        promoted_count: promotedCount,
        graduated_count: graduatedCount,
        detained_count: detainedCount,
        action: 'promote'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD HIERARCHY (for dropdowns — branches and subjects in HOD's dept)
// ─────────────────────────────────────────────────────────

router.get('/hierarchy', async (req, res) => {
  try {
    const deptId = req.hod_department_id;
    const [branches, subjects, teachers, academicYears, deptInfo] = await Promise.all([
      query(
        `SELECT d.id, d.id as department_id, d.name, d.code, d.name as department_name, d.code as department_code 
         FROM departments d 
         WHERE (${deptId ? 'd.id = ?' : '1=1'}) AND d.is_active = 1 
         ORDER BY d.name`,
        deptId ? [deptId] : []
      ),
      query(
        `SELECT s.*, d.name as branch_name, d.code as branch_code, d.name as department_name 
         FROM subjects s 
         JOIN departments d ON s.department_id = d.id 
         WHERE (${deptId ? 's.department_id = ?' : '1=1'}) AND s.is_active = 1 
         ORDER BY s.year, s.semester, s.code`,
        deptId ? [deptId] : []
      ),
      query(
        `SELECT t.id, t.full_name, t.employee_id, u.username as gmail 
         FROM teachers t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.department_id = ? 
         ORDER BY t.full_name`,
        [deptId]
      ),
      query(`SELECT * FROM academic_years ORDER BY start_date DESC`),
      query(`SELECT degree_duration_years, active_term FROM departments WHERE id = ?`, [deptId])
    ]);

    const defaultBranch = branches.find(b => b.department_id === deptId) || branches[0];
    const user_branch_id = defaultBranch ? defaultBranch.id : null;
    const deptMeta = deptInfo[0] || {};
    const currentAy = academicYears.find(ay => ay.is_current === 1) || academicYears[0];
    const defaultTerm = currentAy?.label || 'Active Session';

    res.json({ success: true, data: {
      department_id: deptId,
      department_name: req.hod_department_name,
      department_code: defaultBranch ? defaultBranch.department_code : null,
      user_branch_id,
      degree_duration_years: deptMeta.degree_duration_years || 3,
      active_term: deptMeta.active_term || defaultTerm,
      branches,
      subjects,
      teachers,
      academicYears
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD ARCHIVE: GET GRADUATION BATCHES (YEARS)
// GET /api/v1/hod/archive/batches
// ─────────────────────────────────────────────────────────
router.get('/archive/batches', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  try {
    const rows = await query(
      `SELECT DISTINCT s.graduation_year 
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE e.department_id = ? AND (e.status = 'COMPLETED' OR s.graduation_year IS NOT NULL)
       ORDER BY s.graduation_year DESC`,
      [deptId]
    );
    const batches = rows.map(r => r.graduation_year).filter(Boolean);
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD ARCHIVE: GET PASSOUT / ALUMNI STUDENTS ROSTER & STATS
// GET /api/v1/hod/archive?batch_year=&search=
// ─────────────────────────────────────────────────────────
router.get('/archive', requireHOD(), async (req, res) => {
  const deptId = req.hod_department_id;
  const { batch_year, search } = req.query;

  try {
    let filter = `e.department_id = ? AND (e.status = 'COMPLETED' OR u.status = 'ALUMNI')`;
    const params = [deptId];

    if (batch_year) {
      filter += ` AND (s.graduation_year = ? OR strftime('%Y', e.updated_at) = ?)`;
      params.push(parseInt(batch_year, 10), String(batch_year));
    }

    if (search) {
      filter += ` AND (s.full_name LIKE ? OR s.official_enrollment_no LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const students = await query(
      `SELECT s.id as student_id, s.user_id, s.official_enrollment_no, s.full_name,
              s.admission_year, COALESCE(s.graduation_year, CAST(strftime('%Y', e.updated_at) AS INTEGER)) as graduation_year,
              s.entry_mode, s.is_lateral_entry,
              e.id as enrollment_id, e.year as final_year, e.semester as final_semester, e.class_roll_no as final_class_roll_no,
              e.status as enrollment_status, u.email, u.status as user_status,
              d.name as department_name, d.code as department_code,
              (CASE WHEN s.fingerprint_template IS NOT NULL THEN 1 ELSE 0 END) as has_fingerprint,
              COALESCE(att.total_sessions, 0) as total_sessions,
              COALESCE(att.attended_sessions, 0) as attended_sessions,
              COALESCE(att.attendance_percentage, 0) as attendance_percentage
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON s.id = e.student_id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN (
         SELECT ra.student_id,
                COUNT(ra.id) as total_sessions,
                SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as attended_sessions,
                ROUND(SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1.0 ELSE 0.0 END) * 100.0 / MAX(COUNT(ra.id), 1), 1) as attendance_percentage
         FROM register_attendance ra
         GROUP BY ra.student_id
       ) att ON att.student_id = s.id
       WHERE ${filter}
       ORDER BY s.graduation_year DESC, s.full_name ASC`,
      params
    );

    // Compute KPI aggregates
    const totalGraduated = students.length;
    const batches = [...new Set(students.map(s => s.graduation_year).filter(Boolean))];
    const avgAttendance = totalGraduated > 0
      ? Math.round((students.reduce((sum, s) => sum + Number(s.attendance_percentage || 0), 0) / totalGraduated) * 10) / 10
      : 0;

    res.json({
      success: true,
      data: students,
      kpis: {
        total_graduated: totalGraduated,
        batches_count: batches.length,
        batches,
        avg_attendance: avgAttendance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// DEPARTMENT FACULTY REGISTRATION APPROVALS (redesign.md Case A)
// ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/hod/registrations/pending-faculty
 * List pending faculty registrations for the HOD's department
 */
router.get('/registrations/pending-faculty', async (req, res) => {
  try {
    const deptId = req.hod_department_id;
    let sql = `
      SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
             frr.account_type, frr.department_id, frr.created_at,
             d.name as department_name, d.code as department_code
      FROM faculty_registration_requests frr
      JOIN departments d ON frr.department_id = d.id
      WHERE frr.approval_type = 'DEPT_HOD' AND frr.status = 'PENDING'
    `;
    const params = [];
    if (deptId) {
      sql += ` AND frr.department_id = ?`;
      params.push(deptId);
    }
    sql += ` ORDER BY frr.created_at DESC`;

    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/registrations/faculty/:id/approve
 * Department HOD approves pending department faculty member
 */
router.post('/registrations/faculty/:id/approve', async (req, res) => {
  const reqId = Number(req.params.id);
  const deptId = req.hod_department_id;

  try {
    let sql = `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'DEPT_HOD' AND status = 'PENDING'`;
    const params = [reqId];
    if (deptId) {
      sql += ` AND department_id = ?`;
      params.push(deptId);
    }
    const reqRows = await query(sql, params);
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending faculty registration request not found in your department' } });
    }
    const r = reqRows[0];

    let createdUserId = null;
    let createdTeacherId = null;

    await withTransaction(async (conn) => {
      // 1. Create active user account
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, must_change_password, status)
         VALUES (?, ?, ?, 0, 'ACTIVE')`,
        [r.email.toLowerCase(), r.email.toLowerCase(), r.password_hash]
      );
      createdUserId = uRes.insertId ?? uRes.lastInsertRowid;

      // 2. Assign TEACHER role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [createdUserId]);

      // 3. Create teacher profile linked to department
      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [createdUserId, r.department_id, r.employee_id || null, r.full_name, r.phone || null]
      );
      createdTeacherId = tRes.insertId ?? tRes.lastInsertRowid;

      // 4. Update request status to APPROVED
      await conn.execute(
        `UPDATE faculty_registration_requests 
         SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [req.user.id, reqId]
      );

      // 5. Audit log
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'FACULTY_APPROVED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [req.user.id, String(createdTeacherId), JSON.stringify({ department_id: r.department_id, email: r.email, approved_from_request: reqId })]
      );
    });

    try {
      await notificationService.sendNotification({
        userId: createdUserId,
        type: notificationService.NOTIFICATION_TYPES.FACULTY_APPROVAL,
        title: 'Faculty Registration Approved',
        message: `Welcome to the faculty portal! Your registration for Department has been approved by the HOD.`,
        linkUrl: '/faculty/registers.html'
      });
    } catch (_) {}

    res.status(200).json({
      success: true,
      message: `Faculty registration for ${r.full_name} has been approved successfully.`,
      data: {
        request_id: reqId,
        user_id: createdUserId,
        teacher_id: createdTeacherId,
        department_id: r.department_id,
        status: 'APPROVED'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/hod/registrations/faculty/:id/reject
 * Department HOD rejects pending department faculty member
 */
router.post('/registrations/faculty/:id/reject', [
  body('reason').optional().trim(),
  validate
], async (req, res) => {
  const reqId = Number(req.params.id);
  const deptId = req.hod_department_id;
  const { reason } = req.body;

  try {
    let sql = `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'DEPT_HOD' AND status = 'PENDING'`;
    const params = [reqId];
    if (deptId) {
      sql += ` AND department_id = ?`;
      params.push(deptId);
    }
    const reqRows = await query(sql, params);
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending faculty registration request not found in your department' } });
    }

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by Department HOD', req.user.id, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, String(reqId), JSON.stringify({ reason: reason || 'Rejected by Department HOD', email: reqRows[0].email })]
    );

    res.json({ success: true, message: 'Faculty registration request rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD: FACULTY REGISTRATION GATE (Anti-Spam Protection)
// GET  /api/v1/hod/faculty-registration-status
// POST /api/v1/hod/faculty-registration-toggle
// ─────────────────────────────────────────────────────────
router.get('/faculty-registration-status', requireHOD(), async (req, res) => {
  try {
    const deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id;
    if (!deptId) {
      return res.status(400).json({ success: false, error: { code: 'NO_DEPARTMENT', message: 'HOD has no assigned department' } });
    }
    const settingKey = `faculty_reg_dept_${deptId}`;
    const setting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [settingKey]);
    const isOpen = setting.length > 0 && setting[0].setting_value === '1';
    res.json({
      success: true,
      data: {
        is_open: isOpen,
        department_id: deptId
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.post('/faculty-registration-toggle', requireHOD(), [
  body('open').isBoolean().withMessage('open flag (boolean) is required'),
  validate
], async (req, res) => {
  try {
    const deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id;
    if (!deptId) {
      return res.status(400).json({ success: false, error: { code: 'NO_DEPARTMENT', message: 'HOD has no assigned department' } });
    }
    const isOpen = Boolean(req.body.open);
    const settingKey = `faculty_reg_dept_${deptId}`;
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
       VALUES (?, ?, 'Department Faculty Self-Registration Open/Closed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key)
       DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [settingKey, isOpen ? '1' : '0', req.user.id]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REGISTRATION_TOGGLED', 'departments', ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, String(deptId), JSON.stringify({ is_open: isOpen, department_id: deptId })]
    );

    res.json({
      success: true,
      message: `Faculty self-registration for this department is now ${isOpen ? 'OPEN' : 'CLOSED'}`,
      data: { is_open: isOpen, department_id: deptId }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;

