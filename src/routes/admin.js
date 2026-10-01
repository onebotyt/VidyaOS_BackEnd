/**
 * Institutional Master Data Administration Routes (/api/v1/admin/*)
 *
 * Admin's 3 core jobs ONLY (per ATTENDANCE_ARCHITECTURE_FREEZE.md):
 *   1. College Setup: Departments, Branches, Academic Years
 *   2. HOD Management: Create HOD accounts, assign HOD → Department
 *   3. Institutional Reporting: Dept-wide attendance reports, audit log
 *
 * Admin does NOT: create normal teachers, create subjects, assign teachers,
 * manage students, or create attendance registers.
 * All operational delegation flows to HOD → Teacher → Class Teacher.
 */

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const sessionService = require('../services/sessionService');
const departmentService = require('../services/departmentService');
const auditService = require('../services/auditService');

// All admin routes require SYSTEM_ADMIN role
router.use(auth, requireRole('SYSTEM_ADMIN'));

// ─────────────────────────────────────────────────────────
// SYSTEM OVERVIEW
// ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/stats */
router.get('/stats', async (req, res) => {
  try {
    const [studentsCount] = await query(`SELECT COUNT(*) as total FROM students`);
    const [teachersCount] = await query(`SELECT COUNT(*) as total FROM teachers`);
    const [hodsCount] = await query(
      `SELECT COUNT(DISTINCT teacher_id) as total FROM teacher_assignments WHERE assignment_type = 'HOD' AND is_active = 1`
    );
    const [deptsCount] = await query(`SELECT COUNT(*) as total FROM departments WHERE is_active = 1`);
    const [devicesCount] = await query(`SELECT COUNT(*) as total FROM devices WHERE is_active = 1`);
    const [todaySessions] = await query(
      `SELECT COUNT(*) as total FROM attendance_sessions WHERE session_date = DATE('now')`
    );
    const [openSessions] = await query(
      `SELECT COUNT(*) as total FROM attendance_sessions WHERE state = 'OPEN'`
    );

    res.json({ success: true, data: {
      total_students: studentsCount?.total || 0,
      total_teachers: teachersCount?.total || 0,
      total_hods: hodsCount?.total || 0,
      total_departments: deptsCount?.total || 0,
      active_terminals: devicesCount?.total || 0,
      today_sessions: todaySessions?.total || 0,
      open_sessions: openSessions?.total || 0,
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// DEPARTMENTS
// ─────────────────────────────────────────────────────────

router.get('/departments', async (req, res) => {
  const rows = await query(
    `SELECT d.*, u.username as hod_gmail, t.full_name as hod_name
     FROM departments d
     LEFT JOIN users u ON d.hod_user_id = u.id
     LEFT JOIN teachers t ON t.user_id = u.id
     ORDER BY d.name`
  );
  const flagged = rows.map(r => ({
    ...r,
    is_hardcoded: departmentService.isHardcodedDepartment(r.code) ? 1 : 0
  }));
  res.json({ success: true, data: flagged });
});

router.post('/departments', [
  body('name').trim().notEmpty().withMessage('Department name required'),
  body('code').trim().notEmpty().withMessage('Department code required'),
  body('degree_duration_years').optional().isInt({ min: 1, max: 6 }),
  validate
], async (req, res) => {
  try {
    const code = req.body.code.toUpperCase();
    const name = req.body.name;
    const duration = parseInt(req.body.degree_duration_years, 10) || 3;
    const activeSession = await sessionService.getActiveSession();
    const activeTerm = activeSession?.label || 'Current Session';
    const result = await query(
      `INSERT INTO departments (name, code, degree_duration_years, active_term) VALUES (?, ?, ?, ?)`,
      [name, code, duration, activeTerm]
    );
    const id = result[0]?.insertId ?? result.lastInsertRowid;
    res.status(201).json({ success: true, data: { id, name, code, degree_duration_years: duration } });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Department code already exists' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/departments/:id', [
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('code').optional().trim().notEmpty(),
  body('is_active').optional().isBoolean(),
  body('degree_duration_years').optional().isInt({ min: 1, max: 6 }),
  validate
], async (req, res) => {
  const { name, code, is_active, degree_duration_years } = req.body;
  const sets = [], params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (code !== undefined) { sets.push('code = ?'); params.push(code.toUpperCase()); }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (degree_duration_years !== undefined) { sets.push('degree_duration_years = ?'); params.push(parseInt(degree_duration_years, 10)); }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
  params.push(req.params.id);
  try {
    await query(`UPDATE departments SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    res.json({ success: true, message: 'Department and unified program updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** POST /api/v1/admin/departments/:id/archive — Archive a department and its data */
router.post('/departments/:id/archive', [
  param('id').isInt(),
  validate
], async (req, res) => {
  const deptId = parseInt(req.params.id, 10);
  try {
    const deptRows = await query('SELECT * FROM departments WHERE id = ?', [deptId]);
    if (!deptRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });
    }
    const dept = deptRows[0];

    if (departmentService.isHardcodedDepartment(dept.code)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Standard institutional department "${dept.name}" (${dept.code}) is protected and cannot be archived or deleted.`
        }
      });
    }

    await withTransaction(async (conn) => {
      // 1. Mark department as archived and inactive
      await conn.execute(
        `UPDATE departments SET is_archived = 1, is_active = 0, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [deptId]
      );
      // 2. Archive linked registers
      await conn.execute(
        `UPDATE attendance_registers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE department_id = ?`,
        [deptId]
      );
    });

    res.json({
      success: true,
      message: `Department "${dept.name}" (${dept.code}) and all associated records have been archived. Permanent deletion is now unlocked with typed confirmation.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.delete('/departments/:id', [
  param('id').isInt(),
  validate
], async (req, res) => {
  const deptId = parseInt(req.params.id, 10);
  try {
    const deptRows = await query('SELECT * FROM departments WHERE id = ?', [deptId]);
    if (!deptRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });
    }
    const dept = deptRows[0];

    // Protected institutional departments cannot be deleted
    if (departmentService.isHardcodedDepartment(dept.code)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Standard institutional department "${dept.name}" (${dept.code}) is protected and cannot be deleted.`
        }
      });
    }

    const isForce = req.query.force === 'true' || req.body?.force === true;

    // Rule: Department MUST be archived before it can be deleted!
    if (dept.is_archived !== 1 && !isForce) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_ARCHIVED',
          message: `Department "${dept.name}" (${dept.code}) must be archived before it can be deleted. Please archive the department first.`
        }
      });
    }

    // Rule: No 1-click delete — require typed confirmation of department code!
    const confirmCode = (req.body?.confirm_code || req.query?.confirm_code || '').trim().toUpperCase();
    if (!isForce && confirmCode !== dept.code.toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONFIRMATION',
          message: `Deletion requires typed confirmation. Please type "${dept.code}" to confirm permanent deletion.`
        }
      });
    }

    await withTransaction(async (conn) => {
      // 1. Unlink any teachers/HODs
      await conn.execute('UPDATE teachers SET department_id = NULL WHERE department_id = ?', [deptId]);
      await conn.execute('UPDATE departments SET hod_user_id = NULL WHERE id = ?', [deptId]);
      // 2. Delete teacher assignments for this department
      await conn.execute('DELETE FROM teacher_assignments WHERE department_id = ?', [deptId]);
      // 3. Cleanly delete assessments & submissions
      await conn.execute('DELETE FROM assessment_submissions WHERE assessment_id IN (SELECT id FROM assessments WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM assessments WHERE department_id = ?', [deptId]);
      // 4. Cleanly delete attendance records, sessions, registers, and enrollments
      await conn.execute('DELETE FROM register_attendance WHERE session_id IN (SELECT id FROM attendance_sessions WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM attendance_session_students WHERE session_id IN (SELECT id FROM attendance_sessions WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM attendance_sessions WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM attendance_registers WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM enrollments WHERE department_id = ?', [deptId]);
      // 5. Delete department
      await conn.execute('DELETE FROM departments WHERE id = ?', [deptId]);
    });

    res.json({ success: true, message: `Department "${dept.code}" (${dept.name}) deleted successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// READ-ONLY COMPATIBILITY ALIAS FOR LEGACY CONSUMERS
// (Department is the single authoritative controller)
// ─────────────────────────────────────────────────────────

router.get('/branches', async (req, res) => {
  const rows = await query(
    `SELECT d.id, d.id as department_id, d.name, d.code, d.is_active,
            d.name as department_name, d.code as department_code 
     FROM departments d ORDER BY d.code, d.name`
  );
  res.json({ success: true, data: rows });
});

// ─────────────────────────────────────────────────────────
// ACADEMIC YEARS
// ─────────────────────────────────────────────────────────

router.get('/academic-years', async (req, res) => {
  const rows = await query(`SELECT * FROM academic_years ORDER BY start_date DESC`);
  res.json({ success: true, data: rows });
});

router.post('/academic-years', [
  body('label').trim().notEmpty().withMessage('Label required (e.g. 2026-27 (Winter))'),
  body('start_date').isDate().withMessage('start_date required (YYYY-MM-DD)'),
  body('end_date').isDate().withMessage('end_date required (YYYY-MM-DD)'),
  validate
], async (req, res) => {
  try {
    const result = await query(
      `INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 0)`,
      [req.body.label, req.body.start_date, req.body.end_date]
    );
    const id = result[0]?.insertId ?? result.lastInsertRowid;
    res.status(201).json({ success: true, data: { id, ...req.body } });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Academic year label already exists' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/academic-years/:id', [
  param('id').isInt(),
  body('label').optional().trim().notEmpty(),
  body('start_date').optional().isDate(),
  body('end_date').optional().isDate(),
  validate
], async (req, res) => {
  const { label, start_date, end_date } = req.body;
  const sets = [], params = [];
  if (label !== undefined) { sets.push('label = ?'); params.push(label); }
  if (start_date !== undefined) { sets.push('start_date = ?'); params.push(start_date); }
  if (end_date !== undefined) { sets.push('end_date = ?'); params.push(end_date); }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
  params.push(req.params.id);
  try {
    await query(`UPDATE academic_years SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    res.json({ success: true, message: 'Academic year updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/academic-years/:id/set-current', [param('id').isInt(), validate], async (req, res) => {
  try {
    await withTransaction(async (conn) => {
      await conn.execute(`UPDATE academic_years SET is_current = 0`);
      await conn.execute(`UPDATE academic_years SET is_current = 1 WHERE id = ?`, [req.params.id]);
    });
    res.json({ success: true, message: 'Academic year set as current' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// AUTOMATED ACADEMIC SESSION ENGINE ("2026 Session" Model)
// ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/session/status — Status of active automated session */
router.get('/session/status', async (req, res) => {
  try {
    const status = await sessionService.getSessionStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** POST /api/v1/admin/session/sync — Force instant session synchronization */
router.post('/session/sync', async (req, res) => {
  try {
    const result = await sessionService.syncAcademicSession();
    res.json({ success: true, message: `Academic Session successfully synchronized to ${result.active_session}`, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** PUT /api/v1/admin/session/config — Update session automation settings */
router.put('/session/config', [
  body('start_month').optional().isInt({ min: 1, max: 12 }),
  body('start_day').optional().isInt({ min: 1, max: 31 }),
  body('auto_enabled').optional().isBoolean(),
  validate
], async (req, res) => {
  try {
    const { start_month, start_day, auto_enabled } = req.body;
    if (start_month !== undefined) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('academic_year_start_month', ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [String(start_month), req.user.id]
      );
    }
    if (start_day !== undefined) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('academic_year_start_day', ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [String(start_day), req.user.id]
      );
    }
    if (auto_enabled !== undefined) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('auto_session_enabled', ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [String(auto_enabled), req.user.id]
      );
    }

    // Trigger immediate re-sync with new settings
    const syncRes = await sessionService.syncAcademicSession();
    res.json({ success: true, message: 'Session settings updated and synchronized', data: syncRes });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** PUT /api/v1/admin/session/duration — Update active session duration and label */
router.put('/session/duration', [
  body('start_date').isDate().withMessage('start_date must be a valid date (YYYY-MM-DD)'),
  body('end_date').isDate().withMessage('end_date must be a valid date (YYYY-MM-DD)'),
  body('label').optional({ nullable: true, checkFalsy: true }).trim(),
  validate
], async (req, res) => {
  try {
    const { start_date, end_date, label } = req.body;
    if (new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'End date must be strictly after start date' }
      });
    }
    const updatedStatus = await sessionService.updateSessionDuration(start_date, end_date, label);
    res.json({
      success: true,
      message: `Academic Session duration successfully updated for ${updatedStatus.session_label}`,
      data: updatedStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD MANAGEMENT (Admin's Job #2)
// Admin creates HOD accounts and assigns them to departments.
// HOD then creates teachers, subjects, and teacher assignments.
// ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/hods — List all HOD accounts with department */
router.get('/hods', async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.username as gmail, u.email, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              d.id as department_id, d.name as department_name, d.code as department_code,
              ta.id as hod_assignment_id, ta.is_active as hod_is_active,
              t.created_at
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON ta.department_id = d.id
       WHERE ta.assignment_type = 'HOD' AND ta.is_active = 1
       ORDER BY d.name, t.full_name`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/hods
 * Create HOD account and assign to a department.
 * HOD is a TEACHER with an HOD assignment record.
 * Body: { full_name, email, phone?, employee_id?, department_id }
 */
router.post('/hods', [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('email').isEmail().withMessage('Valid institutional Gmail required'),
  body('password').trim().notEmpty().withMessage('Password required'),
  body('department_id').isInt().withMessage('Department ID required'),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], async (req, res) => {
  const { full_name, email, password, department_id, phone, employee_id } = req.body;
  const gmail = email.toLowerCase().trim();

  try {
    // Verify department exists
    const depts = await query(`SELECT id, name FROM departments WHERE id = ? AND is_active = 1`, [department_id]);
    if (!depts.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

    const ayRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ayRows[0]?.id;
    if (!ayId) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year set. Configure one in Academic Years first.' } });

    // Check if this gmail already has a teacher/HOD account
    const existingUser = await query(`SELECT id FROM users WHERE username = ? OR email = ?`, [gmail, gmail]);
    if (existingUser.length) {
      // Try to add HOD assignment to existing teacher
      const existingTeacher = await query(`SELECT id FROM teachers WHERE user_id = ?`, [existingUser[0].id]);
      if (existingTeacher.length) {
        const teacherId = existingTeacher[0].id;
        // Add HOD assignment
        await query(
          `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
           VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
          [teacherId, department_id, ayId, req.user.id]
        );
        // Update departments.hod_user_id
        await query(`UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [existingUser[0].id, department_id]);
        return res.status(200).json({ success: true, message: `HOD assignment added to existing teacher account for ${gmail}` });
      }
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already registered. If this is an existing teacher, use the reassign endpoint.' } });
    }

    const tempPassword = password;
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await withTransaction(async (conn) => {
      // Create user account
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
        [gmail, gmail, passwordHash, passwordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      // Assign TEACHER role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [userId]);

      // Create teacher profile with department
      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone) VALUES (?, ?, ?, ?, ?)`,
        [userId, department_id, employee_id || null, full_name, phone || null]
      );
      const teacherId = tRes.insertId ?? tRes.lastInsertRowid;

      // Ensure strictly 1 HOD: Deactivate any existing active HOD assignment for this department
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [department_id]
      );

      // Create HOD assignment record
      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [teacherId, department_id, ayId, req.user.id]
      );

      // Set departments.hod_user_id
      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [userId, department_id]
      );

      return { teacher_id: teacherId, user_id: userId, full_name, gmail, department_id, temporary_password: tempPassword };
    });

    res.status(201).json({
      success: true,
      data: result,
      message: `HOD account created for ${depts[0].name}. Share the Gmail and temporary password with them to log in.`
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already in use' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** PUT /api/v1/admin/hods/:teacher_id/department — Reassign HOD to different department */
router.put('/hods/:teacher_id/department', [
  param('teacher_id').isInt(),
  body('department_id').isInt().withMessage('New department ID required'),
  validate
], async (req, res) => {
  const { department_id } = req.body;
  try {
    const teacher = await query(`SELECT id, user_id FROM teachers WHERE id = ?`, [req.params.teacher_id]);
    if (!teacher.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });

    const dept = await query(`SELECT id, name FROM departments WHERE id = ? AND is_active = 1`, [department_id]);
    if (!dept.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

    await withTransaction(async (conn) => {
      // Deactivate old HOD assignment
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
         WHERE teacher_id = ? AND assignment_type = 'HOD'`,
        [req.params.teacher_id]
      );
      // Clear old dept hod_user_id
      await conn.execute(
        `UPDATE departments SET hod_user_id = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE hod_user_id = ?`,
        [teacher[0].user_id]
      );
      // Strictly 1 HOD per department: Deactivate any current active HOD assignment in target department
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [department_id]
      );
      const ayId = (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
      // Create new HOD assignment
      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [req.params.teacher_id, department_id, ayId, req.user.id]
      );
      // Update teacher's home department
      await conn.execute(
        `UPDATE teachers SET department_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [department_id, req.params.teacher_id]
      );
      // Set new dept hod_user_id
      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [teacher[0].user_id, department_id]
      );
    });

    res.json({ success: true, message: `HOD reassigned to ${dept[0].name} successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** POST /api/v1/admin/hods/:teacher_id/reset-password — Reset HOD password */
router.post('/hods/:teacher_id/reset-password', [
  param('teacher_id').isInt(),
  body('new_password').trim().notEmpty().withMessage('New password is required'),
  validate
], async (req, res) => {
  try {
    const teacherRows = await query(`SELECT user_id FROM teachers WHERE id = ?`, [req.params.teacher_id]);
    if (!teacherRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'HOD not found' } });

    const newPass = req.body.new_password;
    const newPassHash = await bcrypt.hash(newPass, 12);
    await query(
      `UPDATE users SET password_hash = ?, temp_password_hash = ?, must_change_password = 0,
       status = 'ACTIVE', google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newPassHash, newPassHash, teacherRows[0].user_id]
    );
    await query(`UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?`, [teacherRows[0].user_id]);
    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** GET /api/v1/admin/faculty/search — Search faculty by Gmail or name */
router.get('/faculty/search', async (req, res) => {
  const queryParam = (req.query.email || req.query.query || '').toLowerCase().trim();
  if (!queryParam) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Email or query required' } });
  }

  try {
    const teachers = await query(
      `SELECT t.id as teacher_id, t.user_id, t.full_name, t.phone, t.employee_id,
              u.email as gmail, u.username, u.status,
              d.id as department_id, d.name as department_name, d.code as department_code
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE LOWER(u.email) = LOWER(?) OR LOWER(u.username) = LOWER(?) OR LOWER(t.full_name) LIKE LOWER(?)
       LIMIT 5`,
      [queryParam, queryParam, `%${queryParam}%`]
    );

    if (!teachers.length) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No faculty found matching "${queryParam}".` }
      });
    }

    const teacher = teachers[0];

    // Fetch active assignments for this faculty to show all current roles
    const assignments = await query(
      `SELECT ta.assignment_type, ta.year, ta.semester, d.name as department_name, d.code as department_code
       FROM teacher_assignments ta
       LEFT JOIN departments d ON ta.department_id = d.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1`,
      [teacher.teacher_id]
    );

    const rolesList = [];
    const isHod = assignments.some(a => a.assignment_type === 'HOD');
    const isClassTeacher = assignments.some(a => a.assignment_type === 'CLASS_TEACHER');
    const isSubjectTeacher = assignments.some(a => a.assignment_type === 'SUBJECT_TEACHER');

    if (isClassTeacher) {
      const ct = assignments.find(a => a.assignment_type === 'CLASS_TEACHER');
      rolesList.push(`Class Teacher (Y${ct.year} S${ct.semester})`);
    }
    if (isSubjectTeacher) {
      rolesList.push('Subject Teacher');
    }
    if (isHod) {
      const hodA = assignments.find(a => a.assignment_type === 'HOD');
      rolesList.push(`Current HOD (${hodA.department_name || 'Department'})`);
    }
    if (!rolesList.length) {
      rolesList.push('Faculty Member');
    }

    res.json({
      success: true,
      data: {
        teacher_id: teacher.teacher_id,
        user_id: teacher.user_id,
        full_name: teacher.full_name,
        gmail: teacher.gmail,
        phone: teacher.phone,
        department_id: teacher.department_id,
        department_name: teacher.department_name || 'Unassigned',
        department_code: teacher.department_code,
        is_hod: isHod,
        current_roles: rolesList.join(', '),
        assignments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** POST /api/v1/admin/hods/assign-existing — Assign existing faculty member as HOD with full HOD powers */
router.post('/hods/assign-existing', [
  body('department_id').isInt().withMessage('Department ID required'),
  body('teacher_id').optional().isInt(),
  body('email').optional().trim(),
  validate
], async (req, res) => {
  const { department_id, teacher_id, email } = req.body;

  try {
    let teacher;
    if (teacher_id) {
      const rows = await query(
        `SELECT t.id, t.user_id, t.full_name, u.email as gmail 
         FROM teachers t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.id = ?`, 
        [teacher_id]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });
      teacher = rows[0];
    } else if (email) {
      const rows = await query(
        `SELECT t.id, t.user_id, t.full_name, u.email as gmail 
         FROM teachers t 
         JOIN users u ON t.user_id = u.id 
         WHERE LOWER(u.email) = LOWER(?) OR LOWER(u.username) = LOWER(?)`, 
        [email.trim(), email.trim()]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No faculty found with this Gmail' } });
      teacher = rows[0];
    } else {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'teacher_id or email required' } });
    }

    const depts = await query(`SELECT id, name FROM departments WHERE id = ? AND is_active = 1`, [department_id]);
    if (!depts.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });
    const dept = depts[0];

    const ayRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ayRows[0]?.id;
    if (!ayId) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year set.' } });

    await withTransaction(async (conn) => {
      // 1. Strictly 1 HOD: Deactivate any existing active HOD assignment for this department
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [department_id]
      );

      // 2. Deactivate any prior HOD assignment for this specific teacher in another department
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE teacher_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [teacher.id]
      );

      // 3. Insert new HOD assignment (leaves all other assignments like CLASS_TEACHER and SUBJECT_TEACHER 100% active!)
      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [teacher.id, department_id, ayId, req.user.id]
      );

      // 4. Update department's hod_user_id
      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [teacher.user_id, department_id]
      );

      // 5. Ensure user has TEACHER role in user_roles
      const roleRows = await conn.execute(`SELECT id FROM user_roles WHERE user_id = ? AND role = 'TEACHER'`, [teacher.user_id]);
      if (!roleRows[0] || roleRows[0].length === 0) {
        await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [teacher.user_id]);
      }
    });

    res.status(200).json({
      success: true,
      data: {
        teacher_id: teacher.id,
        full_name: teacher.full_name,
        gmail: teacher.gmail,
        department_id: dept.id,
        department_name: dept.name,
        assigned_existing: true
      },
      message: `${teacher.full_name} is now appointed as HOD of ${dept.name} with full HOD powers alongside their existing faculty roles.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** DELETE /api/v1/admin/hods/:teacher_id — Delete or revoke HOD role while 100% preserving branch data */
router.delete('/hods/:teacher_id', [
  param('teacher_id').isInt(),
  validate
], async (req, res) => {
  try {
    // Check by teacher.id first, then teacher.user_id
    let teacherRows = await query(
      `SELECT id, user_id, full_name FROM teachers WHERE id = ? LIMIT 1`,
      [req.params.teacher_id]
    );
    if (!teacherRows.length) {
      teacherRows = await query(
        `SELECT id, user_id, full_name FROM teachers WHERE user_id = ? LIMIT 1`,
        [req.params.teacher_id]
      );
    }

    // If teacher is not found, handle idempotently (clean up any stale department links or assignments)
    if (!teacherRows.length) {
      await query(`UPDATE departments SET hod_user_id = NULL WHERE hod_user_id = ?`, [req.params.teacher_id]);
      await query(`DELETE FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'HOD'`, [req.params.teacher_id]);
      return res.json({
        success: true,
        message: 'HOD record cleared. All branch data remains intact under the department.'
      });
    }

    const teacher = teacherRows[0];
    const userId = teacher.user_id;

    if (userId === req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' } });
    }

    // Ensure fallback institutional administrator teacher exists in teachers table
    let adminTeacherRows = await query(`SELECT id FROM teachers WHERE user_id = 1 LIMIT 1`);
    let adminTeacherId;
    if (adminTeacherRows.length) {
      adminTeacherId = adminTeacherRows[0].id;
    } else {
      const insRes = await query(
        `INSERT INTO teachers (user_id, employee_id, full_name, phone) VALUES (1, 'ADMIN-INSTITUTION', 'Institutional Administrator', '0000000000')`
      );
      adminTeacherId = insRes.lastInsertRowid || insRes[0]?.insertId;
    }

    // Check if this teacher has other active faculty roles (e.g. Class Teacher, Subject Teacher)
    const otherAssignments = await query(
      `SELECT id, assignment_type FROM teacher_assignments WHERE teacher_id = ? AND assignment_type != 'HOD' AND is_active = 1`,
      [teacher.id]
    );

    await withTransaction(async (conn) => {
      // 1. Detach HOD from any departments where they are appointed (department leadership becomes UNASSIGNED)
      await conn.execute(
        `UPDATE departments SET hod_user_id = NULL WHERE hod_user_id = ? OR id IN (SELECT department_id FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'HOD')`,
        [userId, teacher.id]
      );

      // 2. Remove ONLY HOD assignments for this teacher
      await conn.execute(`DELETE FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'HOD'`, [teacher.id]);

      // If the faculty member has other active teaching assignments (Class Teacher, Subject Teacher),
      // we only revoke their HOD power and keep their faculty profile and classes intact!
      if (otherAssignments.length > 0) {
        return;
      }

      // If this was purely an HOD account without other assignments:
      // 3. Reattribute teacher_assignments created by this HOD to Admin (user_id = 1)
      await conn.execute(`UPDATE teacher_assignments SET assigned_by = 1 WHERE assigned_by = ?`, [userId]);

      // 4. Reattribute marked attendance and graded submissions to Admin (user_id = 1) to preserve student history
      await conn.execute(`UPDATE register_attendance SET marked_by = 1 WHERE marked_by = ?`, [userId]);
      await conn.execute(`UPDATE assessment_submissions SET graded_by = 1 WHERE graded_by = ?`, [userId]);

      // 5. PRESERVE ALL BRANCH DATA: Reassign any attendance registers, sessions, and assessments created by this teacher
      // to the Institutional Administrator teacher so all student attendance records, registers, and marks stay 100% intact under the branch!
      await conn.execute(`UPDATE attendance_registers SET teacher_id = ? WHERE teacher_id = ?`, [adminTeacherId, teacher.id]);
      await conn.execute(`UPDATE attendance_sessions SET teacher_id = ? WHERE teacher_id = ?`, [adminTeacherId, teacher.id]);
      await conn.execute(`UPDATE assessments SET teacher_id = ? WHERE teacher_id = ?`, [adminTeacherId, teacher.id]);

      // 6. Remove teacher record
      await conn.execute(`DELETE FROM teachers WHERE id = ?`, [teacher.id]);

      // 7. Remove user sessions, roles, and user
      await conn.execute(`DELETE FROM user_sessions WHERE user_id = ?`, [userId]);
      await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
      await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]);
    });

    const isRevokeOnly = otherAssignments.length > 0;
    res.json({
      success: true,
      message: isRevokeOnly
        ? `${teacher.full_name} has been removed as HOD. Their faculty teaching profile and class assignments remain fully active.`
        : `HOD ${teacher.full_name} has been deleted. All branch data, student registers, and attendance history remain fully preserved under the department.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});


// ─────────────────────────────────────────────────────────
// DEVICES (ESP32 Registry) — Admin manages hardware terminals
// ─────────────────────────────────────────────────────────

router.get('/devices', async (req, res) => {
  const rows = await query(
    `SELECT dv.*, d.name as department_name, d.name as branch_name, d.code as branch_code, ay.label as academic_year_label
     FROM devices dv
     JOIN departments d ON dv.department_id = d.id
     JOIN academic_years ay ON dv.academic_year_id = ay.id
     ORDER BY dv.name`
  );
  res.json({ success: true, data: rows });
});

router.post('/devices', [
  body('device_uid').trim().notEmpty().withMessage('Device UID required'),
  body('name').trim().notEmpty().withMessage('Device name required'),
  body('department_id').isInt(),
  body('branch_id').optional(),
  body('year').isInt({ min: 1, max: 4 }),
  body('semester').isInt({ min: 1, max: 8 }),
  validate
], async (req, res) => {
  const { device_uid, name, department_id, year, semester, academic_year_id } = req.body;
  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    const secret = crypto.randomBytes(16).toString('hex');
    const secretHash = await bcrypt.hash(secret, 10);
    const result = await query(
      `INSERT INTO devices (device_uid, name, department_id, year, semester, academic_year_id, secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [device_uid, name, department_id, year, semester, ayId, secretHash]
    );
    const id = result[0]?.insertId ?? result.lastInsertRowid;
    res.status(201).json({ success: true, data: { id, device_uid, name, device_secret: secret }, message: 'Device registered. Store the device_secret securely — it will not be shown again.' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Device UID already registered' } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// SYSTEM SETTINGS (Attendance Threshold etc.)
// ─────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  const rows = await query(`SELECT setting_key, setting_value, description FROM system_settings ORDER BY setting_key`);
  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
  res.json({ success: true, data: { ...settings, raw: rows, map: settings } });
});

router.put('/settings', [
  body('settings').isObject().withMessage('settings object required'),
  validate
], async (req, res) => {
  const settingsObj = { ...req.body.settings };
  if (settingsObj.default_attendance_threshold_percent && !settingsObj.attendance_threshold) {
    settingsObj.attendance_threshold = settingsObj.default_attendance_threshold_percent;
  } else if (settingsObj.attendance_threshold && !settingsObj.default_attendance_threshold_percent) {
    settingsObj.default_attendance_threshold_percent = settingsObj.attendance_threshold;
  }
  const entries = Object.entries(settingsObj);
  if (!entries.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No settings provided' } });
  try {
    for (const [key, value] of entries) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [key, String(value), req.user?.id || 1]
      );
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// DEPARTMENT-WIDE ATTENDANCE REPORT (Admin's Job #3)
// Aggregates official registers across all departments.
// GET /api/v1/admin/reports/department?department_id=1&academic_year_id=1
// ─────────────────────────────────────────────────────────

router.get('/reports/department', async (req, res) => {
  let { department_id, branch_id, year, semester, date_preset, date_from, date_to } = req.query;

  try {
    let department = { id: null, name: 'All Departments', code: 'ALL' };
    const whereClauses = [];
    const params = [];

    if (department_id) {
      const deptRows = await query(`SELECT id, name, code FROM departments WHERE id = ?`, [department_id]);
      if (deptRows.length) {
        department = deptRows[0];
        whereClauses.push(`d.id = ?`);
        params.push(department_id);
      }
    }

    if (branch_id && !department_id) {
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

    // Date filtering
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

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';

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

    // 2. Daily Trend for Visual Charts (past 30 active days)
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
    let cohortWhere = ["e.status = 'ENROLLED'"];
    let cohortParams = [];
    if (department_id) {
      cohortWhere.push('d.id = ?');
      cohortParams.push(department_id);
    } else if (branch_id) {
      cohortWhere.push('d.id = ?');
      cohortParams.push(branch_id);
    }
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
       ORDER BY d.name, e.year, e.semester`,
      cohortParams
    );

    const scanStatsRows = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
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
      const key = `${row.department_id}_${row.year}_${row.semester}`;
      scanStatsMap.set(key, row);
    });

    const cohort_summary = cohortList.map(c => {
      const key = `${c.department_id}_${c.year}_${c.semester}`;
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

    const seenCohortKeys = new Set(cohortList.map(c => `${c.department_id}_${c.year}_${c.semester}`));
    scanStatsRows.forEach(s => {
      const key = `${s.department_id}_${s.year}_${s.semester}`;
      if (!seenCohortKeys.has(key)) {
        const present = Number(s.present_students) || 0;
        cohort_summary.push({
          department_id: s.department_id,
          department_name: s.department_name || department.name,
          department_code: s.department_code || department.code,
          branch_id: s.department_id,
          branch_name: s.department_name || department.name,
          branch_code: s.department_code || department.code,
          year: s.year,
          semester: s.semester,
          enrolled_students: present,
          present_students: present,
          attendance_percentage: 100,
          total_scans: Number(s.total_scans) || 0,
          active_terminals: Number(s.active_terminals) || 0,
          terminal_uids: s.terminal_uids ? s.terminal_uids.split(',').filter(Boolean) : [],
          last_scan_time: s.last_scan_time || null,
          status: 'HEALTHY'
        });
      }
    });

    res.json({
      success: true,
      data: {
        department,
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
// AUDITED ATTENDANCE CORRECTIONS (Post-Finalization, Admin Only)
// ─────────────────────────────────────────────────────────

router.post('/attendance/corrections', [
  body('register_record_id').isInt().withMessage('register_record_id required'),
  body('new_status').isIn(['PRESENT', 'ABSENT', 'LATE']).withMessage('new_status must be PRESENT, ABSENT, or LATE'),
  body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
  validate
], async (req, res) => {
  const { register_record_id, new_status, reason } = req.body;
  try {
    await withTransaction(async (conn) => {
      const [current] = await conn.execute(
        `SELECT ra.*, asess.state FROM register_attendance ra
         JOIN attendance_sessions asess ON asess.id = ra.session_id
         WHERE ra.id = ?`,
        [register_record_id]
      );
      if (!current.length) throw { status: 404, code: 'NOT_FOUND', message: 'Attendance record not found' };
      if (current[0].state !== 'FINALIZED') throw { status: 422, code: 'UNPROCESSABLE_ENTITY', message: 'Can only correct records from FINALIZED sessions' };

      const prevStatus = current[0].attendance_status;
      await conn.execute(
        `UPDATE register_attendance SET attendance_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [new_status, register_record_id]
      );
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, ip_address)
         VALUES (?, 'ATTENDANCE_CORRECTED', 'register_attendance', ?, ?, ?)`,
        [req.user.id, String(register_record_id), JSON.stringify({ prev: prevStatus, new: new_status, reason }), req.ip]
      );
    });
    res.json({ success: true, message: 'Attendance record corrected and logged permanently' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────

router.get(['/audit', '/audit-logs'], async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      action,
      event_type,
      entity_type,
      target_type,
      actor_id,
      user_id,
      start_date,
      end_date,
      search
    } = req.query;

    const result = await auditService.getAuditLogs({
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
      eventType: event_type || action || null,
      actorId: actor_id || user_id || null,
      targetType: target_type || entity_type || null,
      startDate: start_date || null,
      endDate: end_date || null,
      search: search || null
    });

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HIERARCHY (For dropdowns — departments, branches, academic years)
// ─────────────────────────────────────────────────────────
router.get('/hierarchy', async (req, res) => {
  try {
    const [departments, branches, academicYears] = await Promise.all([
      query(`SELECT * FROM departments WHERE is_active = 1 ORDER BY name`),
      query(`SELECT d.id, d.id as department_id, d.name, d.code, d.is_active, d.name as department_name FROM departments d WHERE d.is_active = 1 ORDER BY d.name`),
      query(`SELECT * FROM academic_years ORDER BY start_date DESC`)
    ]);
    res.json({ success: true, data: { departments, branches, academicYears } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});
// ─────────────────────────────────────────────────────────
// STUDENT DEMOGRAPHIC & ENROLLMENT ANALYTICS (Admin Oversight)
// ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/students/analytics */
router.get('/students/analytics', async (req, res) => {
  try {
    const { department_id } = req.query;
    const deptId = department_id ? parseInt(department_id, 10) : null;

    let filterSql = '';
    const filterParams = [];
    if (deptId) {
      filterSql = 'WHERE e.department_id = ?';
      filterParams.push(deptId);
    }

    // 1. Overview Totals
    const overviewRows = await query(
      `SELECT 
         COUNT(DISTINCT s.id) as total_students,
         COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' THEN s.id END) as active_students,
         COUNT(DISTINCT CASE WHEN u.status = 'PROVISIONED' THEN s.id END) as provisioned_students,
         COUNT(DISTINCT CASE WHEN u.google_sub IS NOT NULL THEN s.id END) as google_linked_students,
         COUNT(DISTINCT fs.student_id) as biometric_enrolled_students
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       ${filterSql}`,
      filterParams
    );

    const totalStudents = overviewRows[0]?.total_students || 0;
    const biometricEnrolled = overviewRows[0]?.biometric_enrolled_students || 0;
    const activeStudents = overviewRows[0]?.active_students || 0;
    const provisionedStudents = overviewRows[0]?.provisioned_students || 0;
    const googleLinked = overviewRows[0]?.google_linked_students || 0;

    // 2. Department Breakdown
    let deptBreakdownSql = `
      SELECT 
        d.id as department_id,
        d.name as department_name,
        d.code as department_code,
        COUNT(DISTINCT s.id) as student_count,
        COUNT(DISTINCT fs.student_id) as biometric_count,
        COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' THEN s.id END) as active_count,
        COUNT(DISTINCT CASE WHEN u.google_sub IS NOT NULL THEN s.id END) as google_count
      FROM departments d
      LEFT JOIN enrollments e ON e.department_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
      WHERE d.is_active = 1
    `;
    const deptParams = [];
    if (deptId) {
      deptBreakdownSql += ' AND d.id = ?';
      deptParams.push(deptId);
    }
    deptBreakdownSql += ' GROUP BY d.id ORDER BY d.name';
    const departmentBreakdown = await query(deptBreakdownSql, deptParams);

    // 3. Cohort Breakdown
    const cohortBreakdown = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         COUNT(DISTINCT s.id) as student_count,
         COUNT(DISTINCT fs.student_id) as biometric_count,
         (
           SELECT t.full_name FROM teacher_assignments ta
           JOIN teachers t ON ta.teacher_id = t.id
           WHERE ta.department_id = d.id 
             AND ta.year = e.year 
             AND ta.semester = e.semester 
             AND ta.assignment_type = 'CLASS_TEACHER' 
             AND ta.is_active = 1 
           LIMIT 1
         ) as class_teacher_name
       FROM enrollments e
       JOIN departments d ON e.department_id = d.id
       JOIN students s ON e.student_id = s.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       ${filterSql}
       GROUP BY d.id, e.year, e.semester
       ORDER BY d.name, e.year, e.semester`,
      filterParams
    );

    // 4. Year Distribution
    const yearDistribution = await query(
      `SELECT e.year, COUNT(DISTINCT s.id) as count
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       ${filterSql}
       GROUP BY e.year
       ORDER BY e.year`,
      filterParams
    );

    res.json({
      success: true,
      data: {
        total_students: totalStudents,
        active_students: activeStudents,
        provisioned_students: provisionedStudents,
        google_linked_students: googleLinked,
        biometric_enrolled_students: biometricEnrolled,
        biometric_coverage_pct: totalStudents > 0 ? Math.round((biometricEnrolled / totalStudents) * 100) : 0,
        cohorts_count: cohortBreakdown.length,
        department_breakdown: departmentBreakdown,
        cohort_breakdown: cohortBreakdown,
        year_distribution: yearDistribution
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/** GET /api/v1/admin/students/roster */
router.get('/students/roster', async (req, res) => {
  try {
    const { department_id, branch_id, search, limit = 150, offset = 0 } = req.query;
    let filter = '';
    const params = [];

    const effDeptId = department_id || branch_id;
    if (effDeptId) {
      filter += ' AND e.department_id = ?';
      params.push(parseInt(effDeptId, 10));
    }
    if (search) {
      filter += ' AND (s.full_name LIKE ? OR s.official_enrollment_no LIKE ? OR s.registration_no LIKE ? OR u.email LIKE ?)';
      const sTerm = `%${search.trim()}%`;
      params.push(sTerm, sTerm, sTerm, sTerm);
    }

    const countRow = await query(
      `SELECT COUNT(DISTINCT s.id) as total
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       WHERE 1=1 ${filter}`,
      params
    );

    const queryParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];
    const rows = await query(
      `SELECT 
         s.id as student_id,
         u.id as user_id,
         s.official_enrollment_no,
         s.registration_no,
         s.full_name,
         COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         u.email,
         u.status as user_status,
         CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
         fs.slot_id as biometric_slot_id,
         dev.name as device_name
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       LEFT JOIN devices dev ON fs.device_id = dev.id
       WHERE 1=1 ${filter}
       ORDER BY d.name, e.year, e.semester, e.class_roll_no ASC
       LIMIT ? OFFSET ?`,
      queryParams
    );

    res.json({
      success: true,
      data: {
        total: countRow[0]?.total || 0,
        students: rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});
// ─────────────────────────────────────────────────────────
// SYSTEM ADMINISTRATOR PROFILE
// GET /api/v1/admin/profile
// PUT /api/v1/admin/profile
// ─────────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const userRows = await query(
      `SELECT u.id, u.username, u.email, u.status, u.created_at,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked
       FROM users u WHERE u.id = ?`,
      [req.user.id]
    );

    if (!userRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Administrator profile not found' } });
    }

    const [deptCount] = await query(`SELECT COUNT(*) as count FROM departments`);
    const [teacherCount] = await query(`SELECT COUNT(*) as count FROM teachers`);
    const [studentCount] = await query(`SELECT COUNT(*) as count FROM students`);
    const [regCount] = await query(`SELECT COUNT(*) as count FROM attendance_registers WHERE is_active = 1`);
    const [deviceCount] = await query(`SELECT COUNT(*) as count FROM devices WHERE is_active = 1`);
    const [sessionCount] = await query(`SELECT COUNT(*) as count FROM attendance_sessions`);

    res.json({
      success: true,
      data: {
        ...userRows[0],
        roles: req.user.roles || ['SYSTEM_ADMIN'],
        role_label: 'Institutional System Administrator',
        metrics: {
          departments_count: deptCount?.count || 0,
          teachers_count: teacherCount?.count || 0,
          students_count: studentCount?.count || 0,
          registers_count: regCount?.count || 0,
          devices_count: deviceCount?.count || 0,
          sessions_count: sessionCount?.count || 0
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/profile', [
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('username').optional().trim().notEmpty().withMessage('Username cannot be empty'),
  body('current_password').optional().trim(),
  body('new_password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], async (req, res) => {
  const { email, username, current_password, new_password } = req.body;
  try {
    const sets = [], params = [];
    if (email) {
      sets.push('email = ?');
      params.push(email.toLowerCase());
    }
    if (username) {
      sets.push('username = ?');
      params.push(username);
    }

    if (sets.length) {
      params.push(req.user.id);
      await query(`UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    }

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Current password required to change password' } });
      }
      const userRow = (await query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]))[0];
      const match = await bcrypt.compare(current_password, userRow.password_hash || '');
      if (!match) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
      }
      const newHash = await bcrypt.hash(new_password, 12);
      await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newHash, req.user.id]);
    }

    res.json({ success: true, message: 'Administrator profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// HOD REGISTRATION APPROVALS & COMMON FACULTY MANAGER (redesign.md 7-11)
// ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/registrations/pending-hods
 * List pending HOD self-registration requests (redesign.md Case C)
 */
router.get('/registrations/pending-hods', async (req, res) => {
  try {
    const rows = await query(
      `SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
              frr.account_type, frr.department_id, frr.created_at,
              d.name as department_name, d.code as department_code,
              (SELECT full_name FROM teachers t 
               JOIN departments d2 ON d2.hod_user_id = t.user_id 
               WHERE d2.id = frr.department_id LIMIT 1) as current_hod_name
       FROM faculty_registration_requests frr
       LEFT JOIN departments d ON frr.department_id = d.id
       WHERE frr.approval_type = 'ADMIN' AND frr.status = 'PENDING'
       ORDER BY frr.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/registrations/hods/:id/approve
 * Admin approves pending HOD registration (Enforces 1-HOD-per-department rule)
 */
router.post('/registrations/hods/:id/approve', async (req, res) => {
  const reqId = Number(req.params.id);
  try {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'ADMIN' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending HOD registration request not found' } });
    }
    const r = reqRows[0];
    const deptId = r.department_id;

    const ayRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ayRows[0]?.id;

    let createdUserId = null;
    let createdTeacherId = null;

    await withTransaction(async (conn) => {
      // 1. Create user account with active status
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, must_change_password, status)
         VALUES (?, ?, ?, 0, 'ACTIVE')`,
        [r.email.toLowerCase(), r.email.toLowerCase(), r.password_hash]
      );
      createdUserId = uRes.insertId ?? uRes.lastInsertRowid;

      // 2. Assign TEACHER role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [createdUserId]);

      // 3. Create teacher profile
      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [createdUserId, deptId, r.employee_id || null, r.full_name, r.phone || null]
      );
      createdTeacherId = tRes.insertId ?? tRes.lastInsertRowid;

      // 4. Enforce strictly 1 HOD: Deactivate any existing active HOD assignment for this department
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [deptId]
      );

      // 5. Create new HOD assignment
      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [createdTeacherId, deptId, ayId, req.user.id]
      );

      // 6. Update departments.hod_user_id
      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [createdUserId, deptId]
      );

      // 7. Mark request as APPROVED
      await conn.execute(
        `UPDATE faculty_registration_requests 
         SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [req.user.id, reqId]
      );

      // 8. Audit log
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'HOD_ASSIGNED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [req.user.id, String(createdTeacherId), JSON.stringify({ department_id: deptId, email: r.email, approved_from_request: reqId })]
      );
    });

    res.status(200).json({
      success: true,
      message: `HOD registration for ${r.full_name} has been approved successfully.`,
      data: {
        request_id: reqId,
        user_id: createdUserId,
        teacher_id: createdTeacherId,
        department_id: deptId,
        status: 'APPROVED'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/registrations/hods/:id/reject
 * Admin rejects pending HOD registration
 */
router.post('/registrations/hods/:id/reject', [
  body('reason').optional().trim(),
  validate
], async (req, res) => {
  const reqId = Number(req.params.id);
  const { reason } = req.body;
  try {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'ADMIN' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending HOD registration request not found' } });
    }

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by administrator', req.user.id, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, String(reqId), JSON.stringify({ reason: reason || 'Rejected by administrator', email: reqRows[0].email })]
    );

    res.json({ success: true, message: 'HOD registration request rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/admin/common-faculty-manager
 * Get currently appointed Common Faculty Manager (redesign.md Section 10)
 */
router.get('/common-faculty-manager', async (req, res) => {
  try {
    const rows = await query(
      `SELECT cfma.id as assignment_id, cfma.assigned_at,
              t.id as teacher_id, t.full_name, t.employee_id, t.department_id,
              u.id as user_id, u.email as gmail,
              d.name as department_name, d.code as department_code,
              u_by.username as assigned_by_username
       FROM common_faculty_manager_assignments cfma
       JOIN teachers t ON cfma.teacher_id = t.id
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN users u_by ON cfma.assigned_by = u_by.id
       WHERE cfma.is_active = 1
       ORDER BY cfma.assigned_at DESC LIMIT 1`
    );
    res.json({ success: true, data: rows.length ? rows[0] : null });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/common-faculty-manager
 * Appoint a faculty member as Common Faculty Manager (redesign.md Section 10)
 */
router.post('/common-faculty-manager', [
  body('teacher_id').isInt().withMessage('Teacher ID is required'),
  validate
], async (req, res) => {
  const teacherId = Number(req.body.teacher_id);
  try {
    const teacher = (await query(`SELECT id, user_id, full_name FROM teachers WHERE id = ?`, [teacherId]))[0];
    if (!teacher) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });
    }

    await withTransaction(async (conn) => {
      // 1. Deactivate current active Common Faculty Manager
      const oldActive = await conn.execute(`SELECT teacher_id FROM common_faculty_manager_assignments WHERE is_active = 1`);
      for (const row of oldActive[0] || []) {
        const oldTeacher = (await conn.execute(`SELECT user_id FROM teachers WHERE id = ?`, [row.teacher_id]))[0]?.[0];
        if (oldTeacher) {
          await conn.execute(`DELETE FROM user_roles WHERE user_id = ? AND role = 'COMMON_FACULTY_MANAGER'`, [oldTeacher.user_id]);
        }
      }
      await conn.execute(`UPDATE common_faculty_manager_assignments SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE is_active = 1`);

      // 2. Create new assignment
      await conn.execute(
        `INSERT INTO common_faculty_manager_assignments (teacher_id, assigned_by, is_active, assigned_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
        [teacherId, req.user.id]
      );

      // 3. Grant COMMON_FACULTY_MANAGER role in user_roles
      const hasRole = (await conn.execute(`SELECT id FROM user_roles WHERE user_id = ? AND role = 'COMMON_FACULTY_MANAGER'`, [teacher.user_id]))[0];
      if (!hasRole || hasRole.length === 0) {
        await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'COMMON_FACULTY_MANAGER')`, [teacher.user_id]);
      }

      // 4. Audit log
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'COMMON_MANAGER_ASSIGNED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [req.user.id, String(teacherId), JSON.stringify({ teacher_id: teacherId, full_name: teacher.full_name })]
      );
    });

    res.json({
      success: true,
      message: `${teacher.full_name} has been appointed as Common Faculty Manager.`,
      data: { teacher_id: teacherId, full_name: teacher.full_name }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * DELETE /api/v1/admin/common-faculty-manager
 * Remove active Common Faculty Manager
 */
router.delete('/common-faculty-manager', async (req, res) => {
  try {
    const active = await query(`SELECT teacher_id FROM common_faculty_manager_assignments WHERE is_active = 1`);
    if (active.length) {
      for (const row of active) {
        const t = (await query(`SELECT user_id FROM teachers WHERE id = ?`, [row.teacher_id]))[0];
        if (t) {
          await query(`DELETE FROM user_roles WHERE user_id = ? AND role = 'COMMON_FACULTY_MANAGER'`, [t.user_id]);
        }
      }
      await query(`UPDATE common_faculty_manager_assignments SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE is_active = 1`);
    }
    res.json({ success: true, message: 'Common Faculty Manager removed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/admin/teachers
 * List all active teachers across the institution
 */
router.get('/teachers', async (req, res) => {
  try {
    const teachers = await query(
      `SELECT t.id as teacher_id, t.user_id, t.full_name, t.employee_id,
              u.email as gmail, d.id as department_id, d.name as department_name, d.code as department_code
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE u.status = 'ACTIVE'
       ORDER BY t.full_name ASC`
    );
    res.json({ success: true, data: teachers });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/admin/registration-gates
 * Read anti-spam registration gate status for HOD and Common Faculty
 */
router.get('/registration-gates', async (req, res) => {
  try {
    const settings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('admin_reg_hod_open', 'admin_reg_common_faculty_open')`
    );
    const hodOpen = settings.some(s => s.setting_key === 'admin_reg_hod_open' && s.setting_value === '1');
    const commonOpen = settings.some(s => s.setting_key === 'admin_reg_common_faculty_open' && s.setting_value === '1');
    res.json({
      success: true,
      data: {
        hod_open: hodOpen,
        common_faculty_open: commonOpen
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/registration-gates/toggle
 * Toggle anti-spam registration gates for HOD or Common Faculty
 */
router.post('/registration-gates/toggle', [
  body('target').isIn(['HOD', 'COMMON_FACULTY']).withMessage('target must be HOD or COMMON_FACULTY'),
  body('open').isBoolean().withMessage('open flag (boolean) is required'),
  validate
], async (req, res) => {
  const { target, open } = req.body;
  const isOpen = Boolean(open);
  const settingKey = target === 'HOD' ? 'admin_reg_hod_open' : 'admin_reg_common_faculty_open';
  const desc = target === 'HOD' ? 'HOD Self-Registration Open/Closed' : 'Common Faculty Self-Registration Open/Closed';

  try {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key)
       DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [settingKey, isOpen ? '1' : '0', desc, req.user.id]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'REGISTRATION_GATE_TOGGLED', 'system_settings', ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, settingKey, JSON.stringify({ target, is_open: isOpen })]
    );

    res.json({
      success: true,
      message: `${target === 'HOD' ? 'Head of Department (HOD)' : 'Common Faculty'} self-registration is now ${isOpen ? 'OPEN' : 'CLOSED'}`,
      data: { target, is_open: isOpen }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});
// ─────────────────────────────────────────────────────────
// INSTITUTIONAL WHATSAPP WEB BOT GATEWAY (SELF-HOSTED)
// ─────────────────────────────────────────────────────────

const whatsappBotService = require('../services/whatsappBotService');

/**
 * GET /api/v1/admin/whatsapp/status
 * Get real-time connection telemetry, QR data URL, and bot state
 */
router.get('/whatsapp/status', async (req, res) => {
  try {
    const status = whatsappBotService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/whatsapp/initialize
 * Start the WhatsApp Web Bot and generate QR code for Linking
 */
router.post('/whatsapp/initialize', async (req, res) => {
  try {
    const initRes = await whatsappBotService.initialize();
    res.json(initRes);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/whatsapp/disconnect
 * Disconnect and destroy the current WhatsApp Bot session
 */
router.post('/whatsapp/disconnect', async (req, res) => {
  try {
    const discRes = await whatsappBotService.disconnect();
    res.json(discRes);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/admin/whatsapp/test-send
 * Send a test OTP or institutional message to verify direct delivery
 */
router.post('/whatsapp/test-send', [
  body('phone').trim().notEmpty().withMessage('Valid phone number is required'),
  body('message').optional().trim(),
  validate
], async (req, res) => {
  const { phone, message } = req.body;
  const msgText = message || `🧪 Government Polytechnic College WhatsApp Gateway: Test dispatch successful at ${new Date().toLocaleTimeString()}!`;
  try {
    const sendRes = await whatsappBotService.sendMessage(phone, msgText);
    if (sendRes.success) {
      res.json({ success: true, message: `Test message sent directly to +91 ${phone}`, data: sendRes });
    } else {
      res.status(400).json({
        success: false,
        error: { code: sendRes.reason || 'SEND_FAILED', message: `Could not send message: ${sendRes.reason || 'Bot not connected'}` }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;


