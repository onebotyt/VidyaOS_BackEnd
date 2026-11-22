/**
 * ══════════════════════════════════════════════════════════════
 * HOD-EXCLUSIVE FACULTY CONTROLLER (hod-exclusive-faculty.js)
 * Exclusive Controller for Head of Department Faculty Management
 * Base Routes:
 *   - GET    /api/v1/hod/teachers
 *   - POST   /api/v1/hod/teachers
 *   - GET    /api/v1/hod/teachers/:id
 *   - PUT    /api/v1/hod/teachers/:id
 *   - DELETE /api/v1/hod/teachers/:id
 *   - POST   /api/v1/hod/teachers/:id/reset-password
 *   - GET    /api/v1/hod/trash/faculty
 *   - POST   /api/v1/hod/trash/faculty/:id/restore
 *   - GET    /api/v1/hod/faculty-roster
 *   - GET    /api/v1/hod/registrations/pending-faculty
 *   - POST   /api/v1/hod/registrations/faculty/:id/approve
 *   - POST   /api/v1/hod/registrations/faculty/:id/reject
 *   - POST   /api/v1/hod/faculty-registrations/:id/adjudicate
 *   - GET    /api/v1/hod/faculty-registration-status
 *   - POST   /api/v1/hod/faculty-registration-toggle
 * Access: HOD, SYSTEM_ADMIN (Hardened: HODs cannot manage themselves)
 * ══════════════════════════════════════════════════════════════
 */

const bcrypt = require('bcrypt');
const HodModel = require('../models/hodModel');
const { query } = require('../config/db');
const notificationService = require('../services/notificationService');

function resolveHodDeptId(req) {
  let deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id || req.query?.department_id;
  if (!deptId && req.user?.roles?.includes('SYSTEM_ADMIN')) {
    return req.query?.department_id || null;
  }
  return deptId || null;
}

class HodExclusiveFacultyController {
  /**
   * List all faculty teachers belonging to the department (excludes self and admins)
   * @route GET /api/v1/hod/teachers
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getTeachers(req, res) {
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? (req.query?.department_id || req.hod_department_id) : req.hod_department_id;
      const excludeUserId = isPrivileged ? null : (req.user?.id || req.user?.user_id);
      const data = await HodModel.getTeachers(deptId, excludeUserId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new teacher user account and departmental faculty profile
   * @route POST /api/v1/hod/teachers
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async createTeacher(req, res) {
    const { full_name, email, password, phone, employee_id } = req.body;
    const gmail = email.toLowerCase().trim();
    const deptId = req.hod_department_id;

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await HodModel.createTeacher({
        fullName: full_name,
        email: gmail,
        passwordHash,
        departmentId: deptId,
        phone,
        employeeId: employee_id
      });

      result.department_id = deptId;
      result.temporary_password = password;

      res.status(201).json({
        success: true,
        data: result,
        message: `Teacher account created in ${req.hod_department_name}. Share Gmail and temporary password with them to log in.`
      });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already registered in the system' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve teacher details and active course assignments by ID within department
   * @route GET /api/v1/hod/teachers/:id
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getTeacherById(req, res) {
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? (req.query?.department_id || req.hod_department_id) : req.hod_department_id;
      const teacher = await HodModel.getTeacherById(req.params.id, deptId);
      if (!teacher) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      const callerUserId = req.user?.id || req.user?.user_id;
      if (!isPrivileged && Number(teacher.user_id) === Number(callerUserId)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage your own profile through departmental faculty management. Use your Profile page.' } });
      }

      res.json({ success: true, data: teacher });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update teacher full name, phone number, employee ID, designation, email, status, or role
   * @route PUT /api/v1/hod/teachers/:id
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async updateTeacher(req, res) {
    const { full_name, employee_id, phone, designation, email, status, role } = req.body;
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? null : req.hod_department_id;
      const teacherRows = await query(
        `SELECT id, user_id FROM teachers WHERE id = ? ${deptId ? 'AND department_id = ?' : ''}`,
        deptId ? [req.params.id, deptId] : [req.params.id]
      );
      if (!teacherRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      const callerUserId = req.user?.id || req.user?.user_id;
      if (!isPrivileged && Number(teacherRows[0].user_id) === Number(callerUserId)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot modify your own profile through departmental faculty management. Use your Profile page.' } });
      }

      await HodModel.updateTeacher(req.params.id, deptId, {
        fullName: full_name,
        employeeId: employee_id,
        phone,
        designation,
        email,
        status,
        role
      });

      res.json({ success: true, message: 'Faculty profile updated successfully' });
    } catch (err) {
      if (err.message?.includes('UNIQUE') || err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Employee ID or email already assigned to another user' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reset teacher account password and invalidate active user sessions
   * @route POST /api/v1/hod/teachers/:id/reset-password
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async resetTeacherPassword(req, res) {
    try {
      let teacherRows;
      if (req.user.roles.includes('SYSTEM_ADMIN') && !req.hod_department_id) {
        teacherRows = await query(
          `SELECT user_id, full_name FROM teachers WHERE id = ?`,
          [req.params.id]
        );
      } else {
        teacherRows = await query(
          `SELECT user_id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
          [req.params.id, req.hod_department_id]
        );
      }
      if (!teacherRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      const callerUserId = req.user.id || req.user.user_id;
      if (teacherRows[0].user_id === callerUserId) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'HOD password can only be reset from your Profile page or by an Admin.' } });
      }

      const newPassHash = await bcrypt.hash(req.body.new_password, 12);
      await HodModel.resetTeacherPassword(teacherRows[0].user_id, newPassHash);

      res.json({ success: true, message: `Password for ${teacherRows[0].full_name} has been updated successfully.` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Delete teacher profile, account, roles, sessions, and course assignments
   * @route DELETE /api/v1/hod/teachers/:id
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async deleteTeacher(req, res) {
    try {
      const teacherRows = await query(
        `SELECT user_id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
        [req.params.id, req.hod_department_id]
      );
      if (!teacherRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      const userId = teacherRows[0].user_id;
      if (userId === req.user.id) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' } });
      }

      await HodModel.deleteTeacher(req.params.id, req.hod_department_id, userId);
      res.json({ success: true, message: `Teacher ${teacherRows[0].full_name} and their assignments have been moved to Trash (30-day retention).` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department faculty currently in Trash (soft-deleted, 30-day retention)
   * @route GET /api/v1/hod/trash/faculty
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getTrashFaculty(req, res) {
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? (req.query?.department_id || req.hod_department_id) : req.hod_department_id;
      const excludeUserId = isPrivileged ? null : (req.user?.id || req.user?.user_id);
      const data = await HodModel.getTrashFaculty(deptId, excludeUserId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Restore a soft-deleted faculty member from Trash
   * @route POST /api/v1/hod/trash/faculty/:id/restore
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async restoreFaculty(req, res) {
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? null : req.hod_department_id;
      const result = await HodModel.restoreFaculty(req.params.id, deptId, req.user.id);
      if (!result) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Faculty member not found in Trash or unauthorized' } });
      }
      res.json({ success: true, message: result.message });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department faculty roster with active teaching workloads and assigned subjects
   * @route GET /api/v1/hod/faculty-roster
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getFacultyRoster(req, res) {
    try {
      const isPrivileged = req.user?.roles?.includes('SYSTEM_ADMIN') || req.user?.roles?.includes('ADMIN');
      const deptId = isPrivileged ? (req.query?.department_id || req.hod_department_id) : req.hod_department_id;
      const excludeUserId = isPrivileged ? null : (req.user?.id || req.user?.user_id);
      const data = await HodModel.getFacultyRoster(deptId, excludeUserId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve pending faculty registration requests awaiting HOD approval
   * @route GET /api/v1/hod/registrations/pending-faculty
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getPendingFacultyRegistrations(req, res) {
    try {
      const deptId = resolveHodDeptId(req);
      const rows = await HodModel.getPendingFacultyRegistrations(deptId);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Approve a pending faculty self-registration, creating user account, teacher record, and audit log
   * @route POST /api/v1/hod/registrations/faculty/:id/approve
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async approveFacultyRegistration(req, res) {
    const reqId = Number(req.params.id);
    const deptId = resolveHodDeptId(req);
    const isSysAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

    try {
      const result = await HodModel.approveFacultyRegistration(reqId, req.user.id, deptId, isSysAdmin);
      if (!result) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending faculty registration request not found in your department' } });
      }

      notificationService.sendNotification({
        userId: result.user_id,
        type: notificationService.NOTIFICATION_TYPES.FACULTY_APPROVAL,
        title: 'Faculty Registration Approved',
        message: 'Welcome to the faculty portal! Your registration for Department has been approved by the HOD.',
        linkUrl: '/faculty/registers.html'
      }).catch(() => { });

      res.status(200).json({
        success: true,
        message: `Faculty registration for ${result.full_name} has been approved successfully.`,
        data: result
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reject a pending faculty self-registration with recorded reason
   * @route POST /api/v1/hod/registrations/faculty/:id/reject
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async rejectFacultyRegistration(req, res) {
    const reqId = Number(req.params.id);
    const deptId = resolveHodDeptId(req);
    const reason = req.body.rejection_reason || req.body.reason;
    const isSysAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

    try {
      const result = await HodModel.rejectFacultyRegistration(reqId, req.user.id, deptId, isSysAdmin, reason);
      if (!result) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending faculty registration request not found in your department' } });
      }

      res.json({ success: true, message: 'Faculty registration request rejected.', data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adjudicate a pending faculty registration by delegating to approve or reject handlers
   * @route POST /api/v1/hod/faculty-registrations/:id/adjudicate
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async adjudicateFacultyRegistration(req, res) {
    const action = (req.body.action || 'APPROVE').toUpperCase();
    if (action === 'REJECT') {
      return HodExclusiveFacultyController.rejectFacultyRegistration(req, res);
    }
    return HodExclusiveFacultyController.approveFacultyRegistration(req, res);
  }

  /**
   * Check whether faculty self-registration gate is open for department
   * @route GET /api/v1/hod/faculty-registration-status
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async getFacultyRegistrationStatus(req, res) {
    try {
      let deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id || req.query.department_id;
      if (!deptId && req.user?.roles?.includes('SYSTEM_ADMIN')) {
        const defaultDept = (await query('SELECT id FROM departments WHERE is_active = 1 LIMIT 1'))[0]?.id;
        deptId = defaultDept;
      }
      if (!deptId) {
        return res.status(400).json({ success: false, error: { code: 'NO_DEPARTMENT', message: 'HOD has no assigned department' } });
      }

      const isOpen = await HodModel.getFacultyRegistrationStatus(deptId);
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
  }

  /**
   * Toggle departmental faculty self-registration gate with audit trail
   * @route POST /api/v1/hod/faculty-registration-toggle
   * @access Protected (HOD, SYSTEM_ADMIN)
   */
  static async toggleFacultyRegistration(req, res) {
    try {
      let deptId = req.body.department_id || req.hod_department_id || req.user?.department_id || req.user?.hod_department_id;
      if (!deptId && req.user?.roles?.includes('SYSTEM_ADMIN')) {
        const defaultDept = (await query('SELECT id FROM departments WHERE is_active = 1 LIMIT 1'))[0]?.id;
        deptId = defaultDept;
      }
      if (!deptId) {
        return res.status(400).json({ success: false, error: { code: 'NO_DEPARTMENT', message: 'HOD has no assigned department' } });
      }

      const newState = await HodModel.toggleFacultyRegistration(deptId, req.user.id);
      res.json({
        success: true,
        message: `Faculty self-registration for your department is now ${newState ? 'OPEN' : 'CLOSED'}.`,
        data: { is_open: newState, department_id: deptId }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = HodExclusiveFacultyController;
