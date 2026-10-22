/**
 * HOD Controller
 * Handles request validation, status codes, service delegation, and HTTP responses
 * for Department Administration (/api/v1/hod/*).
 * Provides bidirectional code traceability across routes/hod.js and models/hodModel.js.
 */

const HodModel = require('../models/hodModel');
const notificationService = require('../services/notificationService');
const { logAudit } = require('../services/auditService');
const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../config/db');

function resolveHodDeptId(req) {
  let deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id || req.query?.department_id;
  if (!deptId && req.user?.roles?.includes('SYSTEM_ADMIN')) {
    return req.query?.department_id || null;
  }
  return deptId || null;
}

class HodController {
  /**
   * Retrieve high-level departmental dashboard KPIs, active registers, attendance rates, and today's sessions
   * @route GET /api/v1/hod/dashboard (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getDashboard() (models/hodModel.js)
   */
  static async getDashboard(req, res) {
    try {
      const deptId = req.hod_department_id;
      const data = await HodModel.getDashboard(deptId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List all faculty teachers belonging to the department
   * @route GET /api/v1/hod/teachers (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getTeachers() (models/hodModel.js)
   */
  static async getTeachers(req, res) {
    try {
      const deptId = req.hod_department_id;
      const data = await HodModel.getTeachers(deptId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new teacher user account and departmental faculty profile
   * @route POST /api/v1/hod/teachers (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createTeacher() (models/hodModel.js)
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
   * @route GET /api/v1/hod/teachers/:id (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getTeacherById() (models/hodModel.js)
   */
  static async getTeacherById(req, res) {
    try {
      const teacher = await HodModel.getTeacherById(req.params.id, req.hod_department_id);
      if (!teacher) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }
      res.json({ success: true, data: teacher });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update teacher full name, phone number, or employee ID
   * @route PUT /api/v1/hod/teachers/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.updateTeacher() (models/hodModel.js)
   */
  static async updateTeacher(req, res) {
    const { full_name, employee_id, phone } = req.body;
    try {
      const teacherRows = await query(
        `SELECT id, user_id FROM teachers WHERE id = ? AND department_id = ?`,
        [req.params.id, req.hod_department_id]
      );
      if (!teacherRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      if (!full_name && employee_id === undefined && phone === undefined) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }

      await HodModel.updateTeacher(req.params.id, req.hod_department_id, {
        fullName: full_name,
        employeeId: employee_id,
        phone
      });

      res.json({ success: true, message: 'Teacher profile updated' });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Employee ID already assigned to another teacher' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reset teacher account password and invalidate active user sessions
   * @route POST /api/v1/hod/teachers/:id/reset-password (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.resetTeacherPassword() (models/hodModel.js)
   */
  static async resetTeacherPassword(req, res) {
    try {
      const teacherRows = await query(
        `SELECT user_id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
        [req.params.id, req.hod_department_id]
      );
      if (!teacherRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found in your department' } });
      }

      if (teacherRows[0].user_id === req.user.id) {
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
   * @route DELETE /api/v1/hod/teachers/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.deleteTeacher() (models/hodModel.js)
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
      res.json({ success: true, message: `Teacher ${teacherRows[0].full_name} and their assignments have been deleted.` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department faculty roster with active teaching workloads and assigned subjects
   * @route GET /api/v1/hod/faculty-roster (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getFacultyRoster() (models/hodModel.js)
   */
  static async getFacultyRoster(req, res) {
    try {
      const deptId = req.hod_department_id;
      const data = await HodModel.getFacultyRoster(deptId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve departmental student roster with cumulative attendance percentages and threshold compliance
   * @route GET /api/v1/hod/students-roster (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getStudentsRoster() (models/hodModel.js)
   */
  static async getStudentsRoster(req, res) {
    try {
      const deptId = req.hod_department_id;
      const students = await HodModel.getStudentsRoster(deptId);
      res.json({ success: true, data: students, total: students.length });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List all attendance classes/registers in department with teacher and session stats
   * @route GET /api/v1/hod/department-classes (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getDepartmentClasses() (models/hodModel.js)
   */
  static async getDepartmentClasses(req, res) {
    try {
      const deptId = req.hod_department_id;
      const classes = await HodModel.getDepartmentClasses(deptId);
      res.json({ success: true, data: classes });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve detailed attendance matrix or summary ledger for a department class register
   * @route GET /api/v1/hod/department-classes/:registerId/attendance (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getDepartmentClassAttendance() (models/hodModel.js)
   */
  static async getDepartmentClassAttendance(req, res) {
    try {
      const registerId = req.params.registerId;
      const deptId = req.hod_department_id;
      const targetMonth = req.query.month || null;

      const result = await HodModel.getDepartmentClassAttendance(deptId, registerId, targetMonth);
      if (!result) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject class not found in your department' } });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List all curriculum subjects configured in the department
   * @route GET /api/v1/hod/subjects (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getSubjects() (models/hodModel.js)
   */
  static async getSubjects(req, res) {
    try {
      const subjects = await HodModel.getSubjects(req.hod_department_id);
      res.json({ success: true, data: subjects });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new curriculum subject in the department
   * @route POST /api/v1/hod/subjects (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createSubject() (models/hodModel.js)
   */
  static async createSubject(req, res) {
    const { name, code, year, semester, has_practical, syllabus_scheme } = req.body;
    const deptId = req.hod_department_id;

    try {
      const subjectId = await HodModel.createSubject({
        departmentId: deptId,
        year,
        semester,
        name,
        code,
        hasPractical: has_practical,
        syllabusScheme: syllabus_scheme
      });

      res.status(201).json({
        success: true,
        data: {
          subject_id: subjectId,
          code: code.toUpperCase().trim(),
          name: name.trim(),
          year,
          semester,
          has_practical: has_practical ? 1 : 0
        },
        message: `Subject ${name} (${code}) added to department curriculum`
      });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Subject code ${code.toUpperCase()} already exists in this department` } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update curriculum subject details, year, semester, scheme, or active status
   * @route PUT /api/v1/hod/subjects/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.updateSubject() (models/hodModel.js)
   */
  static async updateSubject(req, res) {
    const { name, code, year, semester, has_practical, syllabus_scheme, is_active } = req.body;
    try {
      const subjectCheck = await query(`SELECT id FROM subjects WHERE id = ? AND department_id = ?`, [req.params.id, req.hod_department_id]);
      if (!subjectCheck.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject not found in your department' } });
      }

      await HodModel.updateSubject(req.params.id, req.hod_department_id, {
        name,
        code,
        year,
        semester,
        hasPractical: has_practical,
        syllabusScheme: syllabus_scheme,
        isActive: is_active
      });

      res.json({ success: true, message: 'Subject details updated' });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Subject code already in use' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deactivate a curriculum subject in the department
   * @route DELETE /api/v1/hod/subjects/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.deleteSubject() (models/hodModel.js)
   */
  static async deleteSubject(req, res) {
    try {
      const subjectCheck = await query(`SELECT id, name FROM subjects WHERE id = ? AND department_id = ?`, [req.params.id, req.hod_department_id]);
      if (!subjectCheck.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject not found in your department' } });
      }

      await HodModel.deleteSubject(req.params.id, req.hod_department_id);
      res.json({ success: true, message: `Subject ${subjectCheck[0].name} deactivated` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve active teacher course and class teacher assignments in the department
   * @route GET /api/v1/hod/assignments (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getTeacherAssignments() (models/hodModel.js)
   */
  static async getAssignments(req, res) {
    try {
      const assignments = await HodModel.getTeacherAssignments(req.hod_department_id);
      res.json({ success: true, data: assignments });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Assign a teacher to a subject and auto-generate the official attendance register
   * @route POST /api/v1/hod/assignments/subject-teacher (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createSubjectTeacherAssignment() (models/hodModel.js)
   */
  static async createSubjectTeacherAssignment(req, res) {
    const { teacher_id, subject_id, session_type_scope, year, semester } = req.body;
    const deptId = req.hod_department_id;

    try {
      const teacherCheck = await query(
        `SELECT id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
        [teacher_id, deptId]
      );
      if (!teacherCheck.length) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Teacher does not belong to your department' } });
      }

      const subjectCheck = await query(
        `SELECT s.id, s.name, s.code, s.department_id, s.year, s.semester 
         FROM subjects s 
         WHERE s.id = ? AND s.is_active = 1`,
        [subject_id]
      );
      if (!subjectCheck.length) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject not found or is inactive' } });
      }

      const targetSubject = subjectCheck[0];
      const targetDeptId = targetSubject.department_id;
      const targetYear = year || targetSubject.year;
      const targetSem = semester || targetSubject.semester;

      const ayRow = (await query(`SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];
      if (!ayRow) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year configured' } });
      }

      const result = await HodModel.createSubjectTeacherAssignment({
        teacherId: teacher_id,
        subjectId: subject_id,
        departmentId: targetDeptId,
        year: targetYear,
        semester: targetSem,
        ayId: ayRow.id,
        sessionTypeScope: session_type_scope,
        assignedBy: req.user.id
      });

      const registerName = `${targetSubject.name} — ${session_type_scope} — ${ayRow.label || 'Academic Year'}`;
      result.register_name = registerName;

      res.status(201).json({
        success: true,
        data: result,
        message: `${teacherCheck[0].full_name} assigned as ${session_type_scope} teacher for ${targetSubject.name}. Official register "${registerName}" auto-created.`
      });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'This teacher already has an assignment for this subject and scope in this academic year' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Appoint a Class Teacher for a cohort, deactivating prior assignments
   * @route POST /api/v1/hod/assignments/class-teacher (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createClassTeacherAssignment() (models/hodModel.js)
   */
  static async createClassTeacherAssignment(req, res) {
    const { teacher_id, year, semester } = req.body;
    const deptId = req.hod_department_id;

    try {
      const teacherCheck = await query(
        `SELECT id, full_name FROM teachers WHERE id = ? AND department_id = ?`,
        [teacher_id, deptId]
      );
      if (!teacherCheck.length) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Teacher does not belong to your department' } });
      }

      const branchName = req.hod_department_name;
      const ayId = (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
      if (!ayId) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year configured' } });
      }

      const assignmentId = await HodModel.createClassTeacherAssignment({
        teacherId: teacher_id,
        departmentId: deptId,
        year,
        semester,
        ayId,
        assignedBy: req.user.id
      });

      res.status(201).json({
        success: true,
        data: { assignment_id: assignmentId },
        message: `${teacherCheck[0].full_name} assigned as Class Teacher for ${branchName} Year ${year} Sem ${semester}. Previous Class Teacher role reassigned successfully.`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deactivate a teacher assignment and archive the linked official attendance register
   * @route DELETE /api/v1/hod/assignments/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.deleteAssignment() (models/hodModel.js)
   */
  static async deleteAssignment(req, res) {
    try {
      const assignment = await query(
        `SELECT ta.id 
         FROM teacher_assignments ta
         JOIN teachers t ON ta.teacher_id = t.id
         WHERE ta.id = ? AND (ta.department_id = ? OR t.department_id = ?)`,
        [req.params.id, req.hod_department_id, req.hod_department_id]
      );
      if (!assignment.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found in your department' } });
      }

      await HodModel.deleteAssignment(req.params.id, req.hod_department_id);
      res.json({ success: true, message: 'Assignment and linked official register archived' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Compile and return department analytics report data: KPIs, trends, cohort summaries, and scan logs
   * @route GET /api/v1/hod/reports (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getReports() (models/hodModel.js)
   */
  static async getReports(req, res) {
    try {
      const deptId = req.hod_department_id;
      const reports = await HodModel.getReports(deptId, req.query);

      res.json({
        success: true,
        data: {
          department_id: deptId,
          department_name: req.hod_department_name,
          is_class_teacher: !!req.is_class_teacher,
          is_hod: !!req.is_hod,
          ...reports
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List all IoT hardware devices registered to the department
   * @route GET /api/v1/hod/devices (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getDevices() (models/hodModel.js)
   */
  static async getDevices(req, res) {
    try {
      const devices = await HodModel.getDevices(req.hod_department_id);
      res.json({ success: true, data: devices });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Register a new IoT terminal device assigned to the department
   * @route POST /api/v1/hod/devices (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createDevice() (models/hodModel.js)
   */
  static async createDevice(req, res) {
    const { device_uid, name, secret, academic_year_id, year, semester } = req.body;
    const deptId = req.hod_department_id;

    try {
      const existing = await query(`SELECT id FROM devices WHERE device_uid = ?`, [device_uid]);
      if (existing.length) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Device UID ${device_uid} already registered` } });
      }

      let ayId = academic_year_id;
      if (!ayId) {
        const ayRow = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
        if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
        ayId = ayRow.id;
      }

      const secretHash = await bcrypt.hash(secret, 10);
      const devId = await HodModel.createDevice({
        deviceUid: device_uid,
        name: name || `ESP32-${device_uid.slice(-4)}`,
        departmentId: deptId,
        year: year || null,
        semester: semester || null,
        ayId,
        secretHash
      });

      res.status(201).json({
        success: true,
        data: { id: devId, device_uid, name: name || `ESP32-${device_uid.slice(-4)}` },
        message: 'Device successfully registered to department'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Toggle device active/inactive state
   * @route PATCH /api/v1/hod/devices/:id/toggle (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.toggleDevice() (models/hodModel.js)
   */
  static async toggleDevice(req, res) {
    try {
      const nextState = await HodModel.toggleDevice(req.params.id, req.hod_department_id);
      if (nextState === null) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found in your department' } });
      }
      res.json({ success: true, message: `Device ${nextState ? 'activated' : 'deactivated'} successfully` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Delete an IoT device from the department
   * @route DELETE /api/v1/hod/devices/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.deleteDevice() (models/hodModel.js)
   */
  static async deleteDevice(req, res) {
    try {
      const ok = await HodModel.deleteDevice(req.params.id, req.hod_department_id);
      if (!ok) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found in your department' } });
      }
      res.json({ success: true, message: 'Device deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Paginated student listing in department filtered by cohort, year, and search
   * @route GET /api/v1/hod/students (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getStudents() (models/hodModel.js)
   */
  static async getStudents(req, res) {
    try {
      const deptId = req.hod_department_id;
      const { year, semester, search, limit = 100, offset = 0 } = req.query;
      const result = await HodModel.getStudents(deptId, { year, semester, search, limit, offset });
      res.json({
        success: true,
        data: result.students,
        pagination: { total: result.total, limit: parseInt(limit, 10), offset: parseInt(offset, 10) }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Enroll a new student, create provisioned user account, and reindex roll numbers
   * @route POST /api/v1/hod/students (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.createStudent() (models/hodModel.js)
   */
  static async createStudent(req, res) {
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

      const cleanEnroll = official_enrollment_no.trim();
      const existingUser = await query(
        `SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)
         UNION
         SELECT id FROM students WHERE LOWER(TRIM(official_enrollment_no)) = LOWER(?)`,
        [cleanEnroll, cleanEnroll]
      );
      if (existingUser.length > 0) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Official Enrollment Number "${cleanEnroll}" already exists in the system. Enrollment numbers are uniquely assigned once upon admission.` } });
      }

      if (email && email.trim()) {
        const cleanEmail = email.trim();
        const existingEmail = await query(
          `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(username)) = LOWER(?)`,
          [cleanEmail, cleanEmail]
        );
        if (existingEmail.length > 0) {
          return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Email "${cleanEmail}" is already registered to an account.` } });
        }
      }

      const newStudent = await HodModel.createStudent({
        deptId,
        ayId,
        officialEnrollmentNo: cleanEnroll,
        registrationNo: registration_no,
        fullName: full_name,
        email,
        year,
        semester,
        isLateralEntry: is_lateral_entry,
        initialPassword: initial_password
      });

      res.status(201).json({
        success: true,
        data: newStudent,
        message: `Student ${full_name} enrolled successfully with class roll number ${newStudent.class_roll_no}`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Bulk import and enroll students for a cohort in a single transaction with automatic roll indexing
   * @route POST /api/v1/hod/students/bulk (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.bulkCreateStudents() (models/hodModel.js)
   */
  static async bulkCreateStudents(req, res) {
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

      const result = await HodModel.bulkCreateStudents({
        deptId,
        year,
        semester,
        students,
        ayId
      });

      res.status(201).json({
        success: true,
        data: result,
        message: `Bulk import processed. ${result.created_count} students enrolled successfully.`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Delete student record, user account, attendance records, and reindex roll numbers
   * @route DELETE /api/v1/hod/students/:id (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.deleteStudent() (models/hodModel.js)
   */
  static async deleteStudent(req, res) {
    try {
      const ok = await HodModel.deleteStudent(req.params.id, req.hod_department_id);
      if (!ok) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found in your department' } });
      }
      res.json({ success: true, message: 'Student record and enrollments deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reset student account password
   * @route POST /api/v1/hod/students/:id/reset-password (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.resetStudentPassword() (models/hodModel.js)
   */
  static async resetStudentPassword(req, res) {
    try {
      const sRows = await query(
        `SELECT s.id, s.user_id, s.full_name FROM students s
         JOIN enrollments e ON e.student_id = s.id
         WHERE s.id = ? AND e.department_id = ?`,
        [req.params.id, req.hod_department_id]
      );
      if (!sRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found in your department' } });
      }

      const newPassHash = await bcrypt.hash(req.body.new_password, 12);
      await HodModel.resetStudentPassword(sRows[0].user_id, newPassHash);

      res.json({ success: true, message: `Password for student ${sRows[0].full_name} updated successfully` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Re-index class roll numbers alphabetically by student name for a cohort
   * @route POST /api/v1/hod/students/reindex-roll (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.reindexCohortRollNumbers() (models/hodModel.js)
   */
  static async reindexRoll(req, res) {
    const { year, semester, academic_year_id } = req.body;
    const deptId = req.hod_department_id;

    try {
      let ayId = academic_year_id;
      if (!ayId) {
        const ayRow = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
        if (!ayRow) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No active academic year found' } });
        ayId = ayRow.id;
      }

      const count = await HodModel.reindexCohortRollNumbers(deptId, year, semester, ayId);
      res.json({
        success: true,
        message: `Successfully re-indexed roll numbers for ${count} students in Year ${year} Sem ${semester}`,
        data: { reindexed_count: count }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department academic configuration and attendance threshold settings
   * @route GET /api/v1/hod/settings (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getSettings() (models/hodModel.js)
   */
  static async getSettings(req, res) {
    try {
      const settings = await HodModel.getSettings(req.hod_department_id);
      res.json({ success: true, data: settings });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update departmental settings (duration, active term, attendance threshold)
   * @route PUT /api/v1/hod/settings (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.updateSettings() (models/hodModel.js)
   */
  static async updateSettings(req, res) {
    const { degree_duration_years, active_term, attendance_threshold, defaulter_threshold_percent } = req.body;
    const deptId = req.hod_department_id;
    const threshold = attendance_threshold !== undefined ? attendance_threshold : defaulter_threshold_percent;

    try {
      await HodModel.updateSettings(deptId, {
        degreeDurationYears: degree_duration_years,
        activeTerm: active_term,
        threshold
      }, req.user.id);

      res.json({ success: true, message: 'Department settings updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department degree duration and active term configuration
   * @route GET /api/v1/hod/settings/duration (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getDurationSettings() (models/hodModel.js)
   */
  static async getDurationSettings(req, res) {
    try {
      const duration = await HodModel.getDurationSettings(req.hod_department_id);
      if (!duration) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });
      }
      res.json({ success: true, data: duration });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update department degree duration years with typed code confirmation
   * @route POST /api/v1/hod/settings/duration (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.updateDurationSettings() (models/hodModel.js)
   */
  static async updateDurationSettings(req, res) {
    const { duration_years, confirm_code } = req.body;
    const deptId = req.hod_department_id;

    try {
      const rows = await query('SELECT code, name FROM departments WHERE id = ?', [deptId]);
      if (!rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

      if (confirm_code.toUpperCase() !== rows[0].code.toUpperCase()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Confirmation code does not match department code "${rows[0].code}". Change aborted.` }
        });
      }

      await HodModel.updateDurationSettings(deptId, duration_years);
      res.json({
        success: true,
        message: `Degree duration successfully updated to ${duration_years} Years (Semesters 1 to ${duration_years * 2}).`,
        data: { degree_duration_years: duration_years }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Calculate preview of students eligible for semester promotion or demotion reversal
   * @route GET /api/v1/hod/promotion/preview (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getPromotionPreview() (models/hodModel.js)
   */
  static async getPromotionPreview(req, res) {
    const deptId = req.hod_department_id;
    const action = req.query.action === 'demote' ? 'demote' : 'promote';

    try {
      const preview = await HodModel.getPromotionPreview(deptId, action);
      if (preview.error) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: preview.error } });
      }
      res.json({ success: true, data: preview });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Execute atomic batch semester promotion or demotion reversal with automatic roll reindexing
   * @route POST /api/v1/hod/promotion/execute (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.executePromotion() (models/hodModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   * @usesService notificationService.sendNotification() (services/notificationService.js)
   */
  static async executePromotion(req, res) {
    const deptId = req.hod_department_id;
    const { action = 'promote', exceptions = [], promoted_student_ids, selected_student_ids, confirm_code } = req.body;

    try {
      const deptRow = (await query('SELECT code FROM departments WHERE id = ?', [deptId]))[0];
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

      const result = await HodModel.executePromotion(deptId, {
        action,
        exceptions,
        promoted_student_ids,
        selected_student_ids
      });

      if (action === 'demote') {
        await logAudit({
          actorId: req.user.id,
          actorRole: 'HOD',
          eventType: 'STUDENT_DEMOTION_EXECUTED',
          action: 'STUDENT_DEMOTION_EXECUTED',
          targetType: 'departments',
          targetId: String(deptId),
          details: {
            department_code: expectedCode,
            demoted_count: result.demoted_count
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.json({
          success: true,
          message: `Demotion / Reversal successfully executed! Reverted ${result.demoted_count} students to their previous semester.`,
          data: {
            demoted_count: result.demoted_count,
            action: 'demote'
          }
        });
      }

      await logAudit({
        actorId: req.user.id,
        actorRole: 'HOD',
        eventType: 'STUDENT_PROMOTION_EXECUTED',
        action: 'STUDENT_PROMOTION_EXECUTED',
        targetType: 'departments',
        targetId: String(deptId),
        details: {
          department_code: expectedCode,
          promoted_count: result.promoted_count,
          graduated_count: result.graduated_count,
          detained_count: result.detained_count
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      for (const ps of result.promotedStudents || []) {
        notificationService.sendNotification({
          userId: ps.user_id,
          type: 'ENROLLMENT_CHANGE',
          title: '🎓 Semester Promoted',
          message: `Congratulations! You have been promoted to Year ${ps.nextYr}, Semester ${ps.nextSem}.`,
          link: '/student/dashboard.html'
        }).catch(() => {});
      }

      for (const gs of result.graduatedStudents || []) {
        notificationService.sendNotification({
          userId: gs.user_id,
          type: 'ENROLLMENT_CHANGE',
          title: '🎉 Curriculum Completed',
          message: 'Congratulations! You have successfully completed your academic program and graduated as Alumni.',
          link: '/student/profile.html'
        }).catch(() => {});
      }

      for (const ds of result.detainedStudents || []) {
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
        message: `Promotion successfully executed! Promoted: ${result.promoted_count}, Graduated: ${result.graduated_count}${result.detained_count > 0 ? `, Detained: ${result.detained_count}` : ''}.`,
        data: {
          promoted_count: result.promoted_count,
          graduated_count: result.graduated_count,
          detained_count: result.detained_count,
          action: 'promote'
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve department hierarchy tree for UI dropdown menus (branches, subjects, teachers, academic years)
   * @route GET /api/v1/hod/hierarchy (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getHierarchy() (models/hodModel.js)
   */
  static async getHierarchy(req, res) {
    try {
      const deptId = req.hod_department_id;
      const data = await HodModel.getHierarchy(deptId, req.hod_department_name);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List distinct graduation years for alumni students in department
   * @route GET /api/v1/hod/archive/batches (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getArchiveBatches() (models/hodModel.js)
   */
  static async getArchiveBatches(req, res) {
    try {
      const batches = await HodModel.getArchiveBatches(req.hod_department_id);
      res.json({ success: true, data: batches });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve archived alumni students with lifetime attendance stats and KPI metrics
   * @route GET /api/v1/hod/archive (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getArchive() (models/hodModel.js)
   */
  static async getArchive(req, res) {
    try {
      const result = await HodModel.getArchive(req.hod_department_id, req.query);
      res.json({
        success: true,
        data: result.students,
        kpis: result.kpis
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve pending faculty registration requests awaiting HOD approval
   * @route GET /api/v1/hod/registrations/pending-faculty, GET /api/v1/hod/faculty-registrations/pending (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.getPendingFacultyRegistrations() (models/hodModel.js)
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
   * @route POST /api/v1/hod/registrations/faculty/:id/approve, POST /api/v1/hod/faculty-registrations/:id/approve (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.approveFacultyRegistration() (models/hodModel.js)
   * @usesService notificationService.sendNotification() (services/notificationService.js)
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
      }).catch(() => {});

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
   * @route POST /api/v1/hod/registrations/faculty/:id/reject, POST /api/v1/hod/faculty-registrations/:id/reject (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.rejectFacultyRegistration() (models/hodModel.js)
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
   * @route POST /api/v1/hod/faculty-registrations/:id/adjudicate, POST /api/v1/hod/registrations/faculty/:id/adjudicate (routes/hod.js)
   * @access Protected (HOD, Class Teacher, SYSTEM_ADMIN)
   * @usesModel HodModel.approveFacultyRegistration() / rejectFacultyRegistration() (models/hodModel.js)
   */
  static async adjudicateFacultyRegistration(req, res) {
    const action = (req.body.action || 'APPROVE').toUpperCase();
    if (action === 'REJECT') {
      return HodController.rejectFacultyRegistration(req, res);
    }
    return HodController.approveFacultyRegistration(req, res);
  }

  /**
   * Check whether faculty self-registration gate is open for department
   * @route GET /api/v1/hod/faculty-registration-status (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.getFacultyRegistrationStatus() (models/hodModel.js)
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
   * @route POST /api/v1/hod/faculty-registration-toggle (routes/hod.js)
   * @access Protected (HOD, SYSTEM_ADMIN)
   * @usesModel HodModel.toggleFacultyRegistration() (models/hodModel.js)
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

      const isOpen = Boolean(req.body.open);
      await HodModel.toggleFacultyRegistration(deptId, isOpen, req.user.id);

      res.json({
        success: true,
        message: `Faculty self-registration for this department is now ${isOpen ? 'OPEN' : 'CLOSED'}`,
        data: { is_open: isOpen, department_id: deptId }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = HodController;
