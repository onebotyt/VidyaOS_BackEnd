/**
 * Student Routes (/api/v1/students/*)
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireClassTeacher, requireDepartmentFaculty } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const reportService = require('../services/reportService');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

/**
 * Get Current Student Profile
 * GET /api/v1/students/me
 */
router.get('/me', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const studentRows = await query(
      `SELECT s.id, s.official_enrollment_no, s.official_enrollment_no as enrollment_no, s.registration_no,
              s.full_name, s.entry_mode, s.admission_year, s.graduation_year, s.is_lateral_entry,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, e.year, e.semester, e.status as enrollment_status,
              d.name as department_name, d.code as department_code,
              d.name as branch_name, d.code as branch_code,
              ay.label as academic_year_label,
              u.username, u.email, u.status as account_status, u.created_at as account_created_at
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       JOIN departments d ON e.department_id = d.id
       JOIN academic_years ay ON e.academic_year_id = ay.id
       WHERE s.id = ?`,
      [req.user.student_id]
    );

    if (!studentRows || studentRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student record not found' } });
    }

    const studentData = studentRows[0];

    // Check biometric fingerprint enrollment
    const fpRows = await query(
      `SELECT fs.slot_id, fs.enrolled_at, d.device_uid, d.name as device_name
       FROM fingerprint_slots fs
       JOIN devices d ON fs.device_id = d.id
       WHERE fs.student_id = ? AND fs.is_active = 1`,
      [req.user.student_id]
    );
    studentData.fingerprint_enrolled = fpRows && fpRows.length > 0;
    studentData.fingerprint_slot = fpRows && fpRows.length > 0 ? fpRows[0].slot_id : null;
    studentData.fingerprint_device = fpRows && fpRows.length > 0 ? fpRows[0].device_name : null;

    // Attach real-time attendance statistics
    try {
      studentData.attendance_stats = await reportService.getStudentAttendanceStats(req.user.student_id);
    } catch (_) {
      studentData.attendance_stats = null;
    }

    res.status(200).json({ success: true, data: studentData });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Update Current Student Profile
 * PUT /api/v1/students/me
 */
router.put('/me', auth, requireRole('STUDENT'), [
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('current_password').optional().trim(),
  body('new_password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], async (req, res) => {
  const { email, current_password, new_password } = req.body;
  try {
    if (email !== undefined) {
      await query(
        `UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [email.toLowerCase(), req.user.id]
      );
    }

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Current password required to set new password' } });
      }
      const userRow = (await query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]))[0];
      const match = await bcrypt.compare(current_password, userRow.password_hash || '');
      if (!match) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
      }
      const newHash = await bcrypt.hash(new_password, 12);
      await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newHash, req.user.id]);
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Student Attendance Stats & 75% Predictor
 * GET /api/v1/students/me/attendance/stats
 */
router.get('/me/attendance/stats', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const stats = await reportService.getStudentAttendanceStats(req.user.student_id);
    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Student Subject-Wise Attendance Breakdown
 * GET /api/v1/students/me/attendance/subjects
 */
router.get('/me/attendance/subjects', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const subjects = await reportService.getStudentSubjectBreakdown(req.user.student_id);
    res.status(200).json({ success: true, data: subjects });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Student Attendance History Log
 * GET /api/v1/students/me/attendance
 */
router.get('/me/attendance', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const history = await reportService.getStudentAttendanceHistory(req.user.student_id, {
      subjectId: req.query.subject_id,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      limit: parseInt(req.query.limit, 10) || 50
    });
    res.status(200).json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});



/**
 * Single Student Provisioning by Class Teacher
 * POST /api/v1/students/provision
 */
router.post(
  '/provision',
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('official_enrollment_no').trim().notEmpty().withMessage('Official enrollment number is required'),
    body('class_roll_no').isInt({ min: 1 }).withMessage('Class roll number must be greater than 0'),
    body('department_id').isInt().withMessage('Department ID required'),
    body('branch_id').optional(),
    body('year').isInt({ min: 1, max: 4 }).withMessage('Year must be between 1 and 4'),
    body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
    validate
  ],
  async (req, res) => {
      const {
        full_name,
        official_enrollment_no,
        registration_no,
        class_roll_no,
        email,
        department_id,
        year,
        semester,
        academic_year_id
      } = req.body;

      try {
        if (!req.user.roles.includes('SYSTEM_ADMIN')) {
          const teacherDept = (await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]))[0]?.department_id;
          if (teacherDept !== Number(department_id)) {
            return res.status(403).json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'You can only provision students in your own department.' }
            });
          }
        }

        const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1`))[0]?.id;
        if (!ayId) {
          return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Academic year not found' } });
        }

        // Check unique class_roll_no within cohort
        const rollConflict = await query(
          `SELECT id FROM enrollments 
           WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ? AND class_roll_no = ?`,
          [department_id, year, semester, ayId, class_roll_no]
        );
        if (rollConflict.length > 0) {
          return res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: `Class roll number ${class_roll_no} is already assigned in this cohort` }
          });
        }

        // Generate random 8-character temporary password
        const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
        const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

        const provisioned = await withTransaction(async (conn) => {
          // 1. Create User
          const [uRes] = await conn.execute(
            `INSERT INTO users (username, email, temp_password_hash, must_change_password, status) 
             VALUES (?, ?, ?, TRUE, 'PROVISIONED')`,
            [official_enrollment_no, email || null, tempPasswordHash]
          );
          const userId = uRes.insertId;

          // 2. Assign STUDENT role
          await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

          // 3. Create Student profile with UBTER registration_no and class_roll_no
          const [sRes] = await conn.execute(
            `INSERT INTO students (user_id, official_enrollment_no, registration_no, class_roll_no, full_name, entry_mode) 
             VALUES (?, ?, ?, ?, ?, 'teacher_provisioned')`,
            [userId, official_enrollment_no, (registration_no || '').trim() || null, class_roll_no, full_name]
          );
          const studentId = sRes.insertId;

          // 4. Create Enrollment
          await conn.execute(
            `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status) 
             VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
            [studentId, department_id, year, semester, ayId, class_roll_no]
          );

          // 5. Create Time-Aware Department Enrollment (redesign.md Section 16)
          try {
            await conn.execute(
              `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
               VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
              [studentId, department_id, ayId, year, semester, class_roll_no]
            );
          } catch (_) {}

          return {
            student_id: studentId,
            official_enrollment_no,
            enrollment_no: official_enrollment_no,
            registration_no: (registration_no || '').trim() || null,
            class_roll_no,
            temporary_password: tempPassword,
            status: 'PROVISIONED'
          };
        });

      res.status(201).json({ success: true, data: provisioned });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Enrollment number already exists' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Bulk Student Provisioning (CSV/Batch Upload) by Class Teacher
 * POST /api/v1/students/provision/bulk
 */
router.post(
  '/provision/bulk',
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('department_id').isInt().withMessage('Department ID required'),
    body('branch_id').optional(),
    body('year').isInt({ min: 1, max: 4 }).withMessage('Year must be between 1 and 4'),
    body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
    body('students').isArray({ min: 1 }).withMessage('Array of students is required'),
    validate
  ],
  async (req, res) => {
    const { department_id, year, semester, academic_year_id, students } = req.body;

    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const teacherDept = (await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]))[0]?.department_id;
        if (teacherDept !== Number(department_id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only provision students in your own department.' }
          });
        }
      }

      const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1`))[0]?.id;
      if (!ayId) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Active academic year not found' } });
      }

      const results = {
        total: students.length,
        provisioned: [],
        errors: []
      };

      for (const item of students) {
        const { full_name, official_enrollment_no, registration_no, class_roll_no, email } = item;

        if (!full_name || !official_enrollment_no || !class_roll_no) {
          results.errors.push({
            enrollment_no: official_enrollment_no || 'UNKNOWN',
            reason: 'Missing full_name, official_enrollment_no, or class_roll_no'
          });
          continue;
        }

        try {
          // Check roll conflict
          const rollCheck = await query(
            `SELECT id FROM enrollments 
             WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ? AND class_roll_no = ?`,
            [department_id, year, semester, ayId, class_roll_no]
          );
          if (rollCheck.length > 0) {
            results.errors.push({
              enrollment_no: official_enrollment_no,
              reason: `Roll number ${class_roll_no} already exists in this cohort`
            });
            continue;
          }

          const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
          const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

          const studentRecord = await withTransaction(async (conn) => {
            const [uRes] = await conn.execute(
              `INSERT INTO users (username, email, temp_password_hash, must_change_password, status) 
               VALUES (?, ?, ?, TRUE, 'PROVISIONED')`,
              [official_enrollment_no, email || null, tempPasswordHash]
            );
            const userId = uRes.insertId;

            await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

            const [sRes] = await conn.execute(
              `INSERT INTO students (user_id, official_enrollment_no, registration_no, class_roll_no, full_name, entry_mode) 
               VALUES (?, ?, ?, ?, ?, 'teacher_provisioned')`,
              [userId, official_enrollment_no, (registration_no || '').trim() || null, class_roll_no, full_name]
            );
            const studentId = sRes.insertId;

            await conn.execute(
              `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status) 
               VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
              [studentId, department_id, year, semester, ayId, class_roll_no]
            );

            // Create Time-Aware Department Enrollment (redesign.md Section 16)
            try {
              await conn.execute(
                `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
                 VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
                [studentId, department_id, ayId, year, semester, class_roll_no]
              );
            } catch (_) {}

            return {
              student_id: studentId,
              full_name,
              official_enrollment_no,
              enrollment_no: official_enrollment_no,
              registration_no: (registration_no || '').trim() || null,
              class_roll_no,
              temporary_password: tempPassword,
              status: 'PROVISIONED'
            };
          });

          results.provisioned.push(studentRecord);
        } catch (subErr) {
          results.errors.push({
            enrollment_no: official_enrollment_no,
            reason: subErr.code === 'ER_DUP_ENTRY' ? 'Enrollment number already exists' : subErr.message
          });
        }
      }

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);


/**
 * List Pending Registrations for Department Faculty
 * GET /api/v1/students/registrations/pending
 */
router.get('/registrations/pending', auth, requireRole('TEACHER'), requireDepartmentFaculty(), async (req, res) => {
  try {
    let deptId = req.query.department_id || req.teacher_department_id;
    if (!deptId && !req.user.roles.includes('SYSTEM_ADMIN')) {
      const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
      deptId = tRows[0]?.department_id;
    }

    const ayId = req.query.academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;

    let sql = `
      SELECT s.id as student_id, s.official_enrollment_no, s.official_enrollment_no as enrollment_no, s.registration_no,
             s.full_name, s.entry_mode,
             u.email, u.created_at as registered_at,
             e.id as enrollment_id, e.status as enrollment_status,
             e.department_id, e.year, e.semester,
             d.name as department_name, d.code as department_code
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN enrollments e ON e.student_id = s.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE u.status = 'PENDING'
    `;
    const params = [];

    if (deptId) {
      sql += ' AND e.department_id = ?';
      params.push(Number(deptId));
    }
    if (req.query.year) {
      sql += ' AND e.year = ?';
      params.push(Number(req.query.year));
    }
    if (req.query.semester) {
      sql += ' AND e.semester = ?';
      params.push(Number(req.query.semester));
    }
    if (ayId) {
      sql += ' AND e.academic_year_id = ?';
      params.push(Number(ayId));
    }

    sql += ' ORDER BY u.created_at ASC';

    const pending = await query(sql, params);
    res.status(200).json({ success: true, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Count Pending Registrations for Department Faculty (for nav badge)
 * GET /api/v1/students/registrations/count
 */
router.get('/registrations/count', auth, requireRole('TEACHER'), requireDepartmentFaculty(), async (req, res) => {
  try {
    let deptId = req.query.department_id || req.teacher_department_id;
    if (!deptId && !req.user.roles.includes('SYSTEM_ADMIN')) {
      const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
      deptId = tRows[0]?.department_id;
    }

    const ayId = req.query.academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;

    let sql = `
      SELECT COUNT(*) as count
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN enrollments e ON e.student_id = s.id
      WHERE u.status = 'PENDING'
    `;
    const params = [];

    if (deptId) {
      sql += ' AND e.department_id = ?';
      params.push(Number(deptId));
    }
    if (req.query.year) {
      sql += ' AND e.year = ?';
      params.push(Number(req.query.year));
    }
    if (req.query.semester) {
      sql += ' AND e.semester = ?';
      params.push(Number(req.query.semester));
    }
    if (ayId) {
      sql += ' AND e.academic_year_id = ?';
      params.push(Number(ayId));
    }

    const result = await query(sql, params);
    res.status(200).json({ success: true, data: { count: result[0]?.count || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Adjudicate Pending Student Registration (Approve / Reject)
 * POST /api/v1/students/registrations/:id/adjudicate
 */
router.post(
  '/registrations/:id/adjudicate',
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('action').isIn(['APPROVE', 'REJECT']).withMessage("Action must be 'APPROVE' or 'REJECT'"),
    body('class_roll_no').optional().isInt({ min: 1 }).withMessage('Valid class roll number required for approval'),
    validate
  ],
  async (req, res) => {
    const studentId = req.params.id;
    const { action, class_roll_no, rejection_reason } = req.body;

    try {
      if (action === 'APPROVE' && !class_roll_no) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Class roll number is required to approve student enrollment' }
        });
      }

      // Department scope authorization: verify student belongs to teacher's department
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const studentEnrollment = await query(
          `SELECT department_id FROM enrollments WHERE student_id = ? LIMIT 1`,
          [studentId]
        );
        if (studentEnrollment.length > 0) {
          const studentDeptId = studentEnrollment[0].department_id;
          const teacherDeptId = req.teacher_department_id || (await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]))[0]?.department_id;
          if (teacherDeptId && Number(studentDeptId) !== Number(teacherDeptId)) {
            const isHod = await query(
              `SELECT id FROM departments WHERE id = ? AND hod_user_id = ?`,
              [studentDeptId, req.user.id]
            );
            if (!isHod.length) {
              return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'You can only adjudicate registrations for students in your department.' }
              });
            }
          }
        }
      }

      await withTransaction(async (conn) => {
        const [students] = await conn.execute(`SELECT user_id FROM students WHERE id = ?`, [studentId]);
        if (students.length === 0) {
          throw { status: 404, code: 'NOT_FOUND', message: 'Student not found' };
        }
        const userId = students[0].user_id;

        if (action === 'APPROVE') {
          await conn.execute(`UPDATE users SET status = 'ACTIVE' WHERE id = ?`, [userId]);
          await conn.execute(
            `UPDATE enrollments SET class_roll_no = ?, status = 'ENROLLED' WHERE student_id = ?`,
            [class_roll_no, studentId]
          );
          await conn.execute(
            `UPDATE students SET class_roll_no = ? WHERE id = ?`,
            [class_roll_no, studentId]
          );

          // Create Time-Aware Department Enrollment (redesign.md Section 16)
          const [enrRows] = await conn.execute(
            `SELECT department_id, academic_year_id, year, semester FROM enrollments WHERE student_id = ? LIMIT 1`,
            [studentId]
          );
          if (enrRows && enrRows.length > 0) {
            const enr = enrRows[0];
            try {
              await conn.execute(
                `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
                 VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
                [studentId, enr.department_id, enr.academic_year_id, enr.year, enr.semester, class_roll_no]
              );
            } catch (_) {}
          }
        } else {
          await conn.execute(
            `UPDATE users SET status = 'REJECTED', rejection_reason = ? WHERE id = ?`,
            [rejection_reason || 'Registration rejected by faculty', userId]
          );
        }

        // Audit log and Notification
        try {
          const isApprove = action === 'APPROVE';
          await auditService.logAudit({
            eventType: isApprove ? auditService.AUDIT_EVENTS.STUDENT_APPROVED : auditService.AUDIT_EVENTS.STUDENT_REJECTED,
            actorId: req.user.id,
            actorRole: req.user.roles?.[0] || 'TEACHER',
            targetType: 'students',
            targetId: studentId,
            details: { action, class_roll_no: class_roll_no || null, reason: rejection_reason || null },
            ipAddress: req.ip
          });

          await notificationService.sendNotification({
            userId,
            type: notificationService.NOTIFICATION_TYPES.STUDENT_APPROVAL,
            title: isApprove ? 'Enrollment Approved' : 'Enrollment Application Update',
            message: isApprove
              ? `Your student registration has been approved. Assigned Roll Number: ${class_roll_no}.`
              : `Your registration request was not approved: ${rejection_reason || 'Criteria not met'}.`,
            linkUrl: isApprove ? '/student/attendance.html' : null
          });
        } catch (_) {}
      });

      res.status(200).json({
        success: true,
        message: `Registration ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Department Transfer (redesign.md Sections 16 & 49)
 * POST /api/v1/students/:id/transfer-department
 * (Admin, or HOD of current/target department)
 */
router.post(
  '/:id/transfer-department',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('new_department_id').isInt().withMessage('Valid new department ID required'),
    body('reason').optional().trim(),
    validate
  ],
  async (req, res) => {
    const studentId = req.params.id;
    const { new_department_id, reason } = req.body;

    try {
      const studentRows = await query(
        `SELECT s.id, s.full_name, e.department_id as current_dept_id, e.academic_year_id, e.year, e.semester, e.class_roll_no
         FROM students s
         JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         WHERE s.id = ?`,
        [studentId]
      );

      if (!studentRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student or active enrollment not found' } });
      }

      const student = studentRows[0];
      if (Number(student.current_dept_id) === Number(new_department_id)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Student is already enrolled in this department' } });
      }

      // Authorization: Admin or HOD of current/new department
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const isHod = await query(
          `SELECT id FROM departments WHERE (id = ? OR id = ?) AND hod_user_id = ?`,
          [student.current_dept_id, new_department_id, req.user.id]
        );
        if (!isHod.length) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only Department HOD or Admin can transfer students between departments.' } });
        }
      }

      const result = await withTransaction(async (conn) => {
        // 1. Close current active student_department_enrollments record with end_date
        await conn.execute(
          `UPDATE student_department_enrollments 
           SET end_date = DATE('now'), status = 'TRANSFERRED', updated_at = CURRENT_TIMESTAMP 
           WHERE student_id = ? AND status = 'ACTIVE'`,
          [studentId]
        );

        // 2. Insert new active student_department_enrollments record
        await conn.execute(
          `INSERT INTO student_department_enrollments 
           (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
           VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
          [studentId, new_department_id, student.academic_year_id, student.year, student.semester, student.class_roll_no]
        );

        // 3. Update current department pointer on active enrollment
        await conn.execute(
          `UPDATE enrollments SET department_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND status = 'ENROLLED'`,
          [new_department_id, studentId]
        );

        // 4. Record in audit_logs
        try {
          await conn.execute(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
             VALUES (?, 'STUDENT_DEPARTMENT_TRANSFERRED', 'students', ?, ?)`,
            [req.user.id, String(studentId), JSON.stringify({ from_dept: student.current_dept_id, to_dept: new_department_id, reason: reason || null })]
          );
        } catch (_) {}

        return {
          student_id: Number(studentId),
          from_department_id: student.current_dept_id,
          to_department_id: Number(new_department_id),
          transferred_at: new Date().toISOString()
        };
      });

      res.status(200).json({
        success: true,
        data: result,
        message: 'Student successfully transferred to new department with historical records preserved.'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Get Student Department Enrollment Timeline
 * GET /api/v1/students/:id/department-history
 */
router.get('/:id/department-history', auth, async (req, res) => {
  try {
    const studentId = req.params.id;
    if (req.user.roles.includes('STUDENT') && Number(req.user.student_id) !== Number(studentId)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized' } });
    }

    const history = await query(
      `SELECT sde.*, d.name as department_name, d.code as department_code, ay.label as academic_year_label
       FROM student_department_enrollments sde
       JOIN departments d ON sde.department_id = d.id
       LEFT JOIN academic_years ay ON sde.academic_year_id = ay.id
       WHERE sde.student_id = ?
       ORDER BY sde.start_date DESC, sde.id DESC`,
      [studentId]
    );

    res.status(200).json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
