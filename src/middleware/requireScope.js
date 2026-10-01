/**
 * Dynamic Scoped RBAC Middleware
 * Validates teacher assignments dynamically from teacher_assignments table.
 */

const { query } = require('../config/db');

/**
 * Ensures teacher is authorized as SUBJECT_TEACHER for the subject
 */
function requireSubjectTeacher() {
  return async (req, res, next) => {
    if (req.user.roles.includes('SYSTEM_ADMIN')) {
      return next();
    }

    if (!req.user.teacher_id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'User is not registered as a faculty member' }
      });
    }

    const subjectId = req.params.subjectId || req.body.subject_id || req.query.subject_id;
    if (!subjectId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'subject_id parameter is required for authorization' }
      });
    }

    try {
      const assignments = await query(
        `SELECT id FROM teacher_assignments 
         WHERE teacher_id = ? 
           AND subject_id = ? 
           AND assignment_type = 'SUBJECT_TEACHER' 
           AND is_active = TRUE`,
        [req.user.teacher_id, subjectId]
      );

      if (!assignments || assignments.length === 0) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not assigned as the SUBJECT_TEACHER for this course'
          }
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify teacher assignment scope', details: err.message }
      });
    }
  };
}

/**
 * Ensures teacher belongs to the department (or is HOD / Admin).
 * Allows ANY department faculty member to approve/manage students in their department.
 */
function requireDepartmentFaculty() {
  return async (req, res, next) => {
    if (req.user.roles.includes('SYSTEM_ADMIN')) {
      req.teacher_department_id = null;
      return next();
    }

    if (!req.user.teacher_id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'User is not registered as a faculty member' }
      });
    }

    try {
      const teacherRows = await query(
        `SELECT t.id, t.department_id, d.name as department_name, d.code as department_code
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         WHERE t.id = ?`,
        [req.user.teacher_id]
      );

      if (!teacherRows || teacherRows.length === 0 || !teacherRows[0].department_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not affiliated with any department' }
        });
      }

      const teacherDeptId = teacherRows[0].department_id;
      req.teacher_department_id = teacherDeptId;
      req.teacher_department_name = teacherRows[0].department_name;

      const deptId = req.params.deptId || req.body.department_id || req.query.department_id;
      if (deptId && Number(deptId) !== teacherDeptId) {
        // Check if teacher is HOD of that other department
        const isHod = await query(
          `SELECT id FROM departments WHERE id = ? AND hod_user_id = ?`,
          [deptId, req.user.id]
        );
        if (!isHod || isHod.length === 0) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You are not authorized for this department' }
          });
        }
      }

      req.classTeacherCohorts = [{ department_id: teacherDeptId }];
      next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify department faculty scope', details: err.message }
      });
    }
  };
}

/**
 * Backward-compatible wrapper for requireDepartmentFaculty.
 * Allows any teacher belonging to the department to approve student registrations,
 * eliminating the single Class Teacher bottleneck.
 */
function requireClassTeacher() {
  return requireDepartmentFaculty();
}

/**
 * Ensures teacher owns the teaching group (or is System Admin).
 */
function requireTeachingGroupOwner(paramName = 'id') {
  return async (req, res, next) => {
    if (req.user.roles.includes('SYSTEM_ADMIN')) {
      return next();
    }

    if (!req.user.teacher_id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'User is not registered as a faculty member' }
      });
    }

    const groupId = req.params[paramName] || req.body.group_id || req.query.group_id;
    if (!groupId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Teaching group ID is required' }
      });
    }

    try {
      const groups = await query(
        `SELECT id, teacher_id, status FROM teaching_groups WHERE id = ?`,
        [groupId]
      );

      if (!groups || groups.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      if (groups[0].teacher_id !== req.user.teacher_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not the owner of this Teaching Group' }
        });
      }

      req.teaching_group = groups[0];
      next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify teaching group ownership', details: err.message }
      });
    }
  };
}

/**
 * Ensures teacher has an active HOD assignment.
 * Resolves and attaches req.hod_department_id and req.hod_department_name.
 * SYSTEM_ADMIN is allowed through unconditionally.
 */
function requireHOD() {
  return async (req, res, next) => {
    try {
      if (req.user.teacher_id) {
        // Find active HOD assignment for this teacher
        const hodAssignment = await query(
          `SELECT ta.department_id, d.name as department_name
           FROM teacher_assignments ta
           JOIN departments d ON ta.department_id = d.id
           WHERE ta.teacher_id = ?
             AND ta.assignment_type = 'HOD'
             AND ta.is_active = 1
           LIMIT 1`,
          [req.user.teacher_id]
        );

        if (hodAssignment && hodAssignment.length > 0) {
          req.hod_department_id = hodAssignment[0].department_id;
          req.hod_department_name = hodAssignment[0].department_name;
          return next();
        }
      }

      if (req.user.roles.includes('SYSTEM_ADMIN')) {
        // Pure Admin passes through — they can view HOD data across departments
        req.hod_department_id = null;
        req.hod_department_name = 'All Departments';
        return next();
      }

      if (!req.user.teacher_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'User is not registered as a faculty member' }
        });
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have an active HOD assignment. Only HODs can perform this action.'
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify HOD assignment scope', details: err.message }
      });
    }
  };
}

/**
 * Ensures teacher has an active HOD assignment or is Department Faculty.
 * Resolves and attaches req.hod_department_id and req.hod_department_name.
 * SYSTEM_ADMIN is allowed through unconditionally.
 */
function requireHODOrClassTeacher() {
  return async (req, res, next) => {
    try {
      if (req.user.roles.includes('SYSTEM_ADMIN')) {
        req.hod_department_id = null;
        req.hod_department_name = 'All Departments';
        return next();
      }

      if (!req.user.teacher_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'User is not registered as a faculty member' }
        });
      }

      // Check active HOD assignment first
      const hodAssignment = await query(
        `SELECT ta.department_id, d.name as department_name
         FROM teacher_assignments ta
         JOIN departments d ON ta.department_id = d.id
         WHERE ta.teacher_id = ?
           AND ta.assignment_type = 'HOD'
           AND ta.is_active = 1
         LIMIT 1`,
        [req.user.teacher_id]
      );

      if (hodAssignment && hodAssignment.length > 0) {
        req.hod_department_id = hodAssignment[0].department_id;
        req.hod_department_name = hodAssignment[0].department_name;
        req.is_hod = true;
        return next();
      }

      // Check department teacher affiliation
      const teacherRows = await query(
        `SELECT t.department_id, d.name as department_name
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         WHERE t.id = ?`,
        [req.user.teacher_id]
      );

      if (teacherRows && teacherRows.length > 0 && teacherRows[0].department_id) {
        req.hod_department_id = teacherRows[0].department_id;
        req.hod_department_name = teacherRows[0].department_name;
        req.is_department_faculty = true;
        req.is_class_teacher = true;
        req.class_teacher_cohort = {
          department_id: teacherRows[0].department_id
        };
        return next();
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You must be a Department HOD or Department Faculty to access this resource.'
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify assignment scope', details: err.message }
      });
    }
  };
}

module.exports = {
  requireSubjectTeacher,
  requireDepartmentFaculty,
  requireClassTeacher,
  requireTeachingGroupOwner,
  requireHOD,
  requireHODOrClassTeacher
};
