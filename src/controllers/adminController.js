/**
 * Admin Controller
 * Coordinates HTTP requests and responses for institutional master data administration:
 * departments, academic years, automated session engine, HODs, hardware terminals,
 * system settings, department reports, audit corrections, hierarchy, and registration gates.
 * Provides bidirectional code traceability across routes/admin.js and models/adminModel.js.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const AdminModel = require('../models/adminModel');
const departmentService = require('../services/departmentService');
const sessionService = require('../services/sessionService');
const auditService = require('../services/auditService');
const { generateDepartmentReportsExcel } = require('../services/excelExportService');

class AdminController {
  /**
   * Get high-level institutional statistics across students, teachers, departments, and sessions
   * @route GET /api/v1/admin/stats (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getStats() (models/adminModel.js)
   */
  static async getStats(req, res) {
    try {
      const stats = await AdminModel.getStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve all departments with HOD details, student counts, and active teacher counts
   * @route GET /api/v1/admin/departments (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartments() (models/adminModel.js)
   */
  static async getDepartments(req, res) {
    try {
      const rows = await AdminModel.getDepartments();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new institutional academic department
   * @route POST /api/v1/admin/departments (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.createDepartment() (models/adminModel.js)
   */
  static async createDepartment(req, res) {
    const { name, code, degree_duration_years } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name and Code are required' } });
    }
    try {
      const id = await AdminModel.createDepartment({ name, code, degreeDurationYears: degree_duration_years });
      res.status(201).json({ success: true, data: { id, name, code, degree_duration_years } });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Department code already exists' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update department name, code, degree duration, or active status
   * @route PUT /api/v1/admin/departments/:id (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.updateDepartment() (models/adminModel.js)
   */
  static async updateDepartment(req, res) {
    const { name, code, is_active, degree_duration_years } = req.body;
    try {
      const updated = await AdminModel.updateDepartment(req.params.id, {
        name,
        code,
        degreeDurationYears: degree_duration_years,
        isActive: is_active
      });
      if (!updated) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      res.json({ success: true, message: 'Department updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Archive a department and deactivate its attendance registers
   * @route POST /api/v1/admin/departments/:id/archive (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentById() (models/adminModel.js)
   * @usesModel AdminModel.archiveDepartment() (models/adminModel.js)
   * @usesService departmentService.isHardcodedDepartment() (services/departmentService.js)
   */
  static async archiveDepartment(req, res) {
    const deptId = parseInt(req.params.id, 10);
    try {
      const dept = await AdminModel.getDepartmentById(deptId);
      if (!dept) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

      if (departmentService.isHardcodedDepartment(dept.code)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Standard institutional department "${dept.name}" (${dept.code}) is protected and cannot be archived or deleted.`
          }
        });
      }

      await AdminModel.archiveDepartment(deptId);
      res.json({
        success: true,
        message: `Department "${dept.name}" (${dept.code}) and all associated records have been archived. Permanent deletion is now unlocked with typed confirmation.`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Hard delete an archived department with typed confirmation requirement
   * @route DELETE /api/v1/admin/departments/:id (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentById() (models/adminModel.js)
   * @usesModel AdminModel.deleteDepartment() (models/adminModel.js)
   * @usesService departmentService.isHardcodedDepartment() (services/departmentService.js)
   */
  static async deleteDepartment(req, res) {
    const deptId = parseInt(req.params.id, 10);
    try {
      const dept = await AdminModel.getDepartmentById(deptId);
      if (!dept) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

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
      if (dept.is_archived !== 1 && !isForce) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NOT_ARCHIVED',
            message: `Department "${dept.name}" (${dept.code}) must be archived before it can be deleted. Please archive the department first.`
          }
        });
      }

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

      await AdminModel.deleteDepartment(deptId);
      res.json({ success: true, message: `Department "${dept.code}" (${dept.name}) deleted successfully` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List institutional departments mapped as academic branches
   * @route GET /api/v1/admin/branches (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartments() (models/adminModel.js)
   */
  static async getBranches(req, res) {
    try {
      const rows = await AdminModel.getDepartments();
      const mapped = rows.map(d => ({
        id: d.id,
        department_id: d.id,
        name: d.name,
        code: d.code,
        is_active: d.is_active,
        department_name: d.name,
        code: d.code
      }));
      res.json({ success: true, data: mapped });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List institutional academic years in chronological order
   * @route GET /api/v1/admin/academic-years (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   */
  static async getAcademicYears(req, res) {
    try {
      const rows = await AdminModel.getAcademicYears();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new academic year definition
   * @route POST /api/v1/admin/academic-years (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.createAcademicYear() (models/adminModel.js)
   */
  static async createAcademicYear(req, res) {
    const { label, start_date, end_date } = req.body;
    try {
      const id = await AdminModel.createAcademicYear({ label, startDate: start_date, endDate: end_date });
      res.status(201).json({ success: true, data: { id, label, start_date, end_date } });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Academic year label already exists' } });
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update academic year label or date ranges
   * @route PUT /api/v1/admin/academic-years/:id (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.updateAcademicYear() (models/adminModel.js)
   */
  static async updateAcademicYear(req, res) {
    const { label, start_date, end_date } = req.body;
    try {
      const updated = await AdminModel.updateAcademicYear(req.params.id, { label, startDate: start_date, endDate: end_date });
      if (!updated) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      res.json({ success: true, message: 'Academic year updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Set designated academic year as the current active session
   * @route PUT /api/v1/admin/academic-years/:id/set-current (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.setCurrentAcademicYear() (models/adminModel.js)
   */
  static async setCurrentAcademicYear(req, res) {
    try {
      await AdminModel.setCurrentAcademicYear(req.params.id);
      res.json({ success: true, message: 'Academic year set as current' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Check status of automated academic session engine
   * @route GET /api/v1/admin/session/status (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesService sessionService.getSessionStatus() (services/sessionService.js)
   */
  static async getSessionStatus(req, res) {
    try {
      const status = await sessionService.getSessionStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Trigger manual synchronization of academic session engine
   * @route POST /api/v1/admin/session/sync (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesService sessionService.syncAcademicSession() (services/sessionService.js)
   */
  static async syncSession(req, res) {
    try {
      const result = await sessionService.syncAcademicSession();
      res.json({ success: true, message: `Academic Session successfully synchronized to ${result.active_session}`, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update session calendar month boundaries configuration
   * @route PUT /api/v1/admin/session/config (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesService sessionService.updateSessionConfig() (services/sessionService.js)
   */
  static async updateSessionConfig(req, res) {
    try {
      const { odd_start_month, odd_end_month, even_start_month, even_end_month, default_duration_years } = req.body;
      const result = await sessionService.updateSessionConfig({
        odd_start_month, odd_end_month, even_start_month, even_end_month, default_duration_years
      });
      res.json({ success: true, message: 'Academic session calendar configuration updated successfully', data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update degree duration years for a specific department
   * @route PUT /api/v1/admin/session/duration (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesService sessionService.updateDepartmentDuration() (services/sessionService.js)
   */
  static async updateSessionDuration(req, res) {
    try {
      const { department_id, degree_duration_years } = req.body;
      const result = await sessionService.updateDepartmentDuration(department_id, degree_duration_years);
      res.json({ success: true, message: `Degree duration updated to ${degree_duration_years} years for department ${department_id}`, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve all active HOD assignments and department leadership info
   * @route GET /api/v1/admin/hods (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getHODs() (models/adminModel.js)
   */
  static async getHods(req, res) {
    try {
      const rows = await AdminModel.getHODs();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new HOD user account and assign to department
   * @route POST /api/v1/admin/hods (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentById() (models/adminModel.js)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   * @usesModel AdminModel.findExistingUser() (models/adminModel.js)
   * @usesModel AdminModel.findTeacherByUserId() (models/adminModel.js)
   * @usesModel AdminModel.reassignHOD() (models/adminModel.js)
   * @usesModel AdminModel.createHODTransaction() (models/adminModel.js)
   */
  static async createHod(req, res) {
    const { full_name, email, password, department_id, phone, employee_id } = req.body;
    const gmail = email.toLowerCase().trim();

    try {
      const depts = await AdminModel.getDepartmentById(department_id);
      if (!depts) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

      const ayRows = await AdminModel.getAcademicYears();
      const currentAy = ayRows.find(a => a.is_current === 1) || ayRows[0];
      if (!currentAy) return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'No current academic year set. Configure one in Academic Years first.' } });

      const existingUser = await AdminModel.findExistingUser(gmail);
      if (existingUser) {
        const existingTeacher = await AdminModel.findTeacherByUserId(existingUser.id);
        if (existingTeacher) {
          await AdminModel.reassignHOD({
            teacherId: existingTeacher.id,
            targetDeptId: department_id,
            ayId: currentAy.id,
            adminUserId: req.user.id
          });
          return res.status(200).json({ success: true, message: `HOD assignment added to existing teacher account for ${gmail}` });
        }
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already registered. If this is an existing teacher, use the reassign endpoint.' } });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await AdminModel.createHODTransaction({
        gmail,
        passwordHash,
        departmentId: department_id,
        employeeId,
        fullName: full_name,
        phone,
        ayId: currentAy.id,
        adminUserId: req.user.id,
        tempPassword: password
      });

      res.status(201).json({
        success: true,
        data: result,
        message: `HOD account created for ${depts.name}. Share the Gmail and temporary password with them to log in.`
      });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Gmail already in use' } });
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reassign an existing HOD to another department
   * @route PUT /api/v1/admin/hods/:teacher_id/department (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentById() (models/adminModel.js)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   * @usesModel AdminModel.reassignHOD() (models/adminModel.js)
   */
  static async reassignHodDepartment(req, res) {
    const teacherId = parseInt(req.params.teacher_id, 10);
    const { department_id } = req.body;
    try {
      const depts = await AdminModel.getDepartmentById(department_id);
      if (!depts) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Target department not found' } });

      const ayRows = await AdminModel.getAcademicYears();
      const currentAy = ayRows.find(a => a.is_current === 1) || ayRows[0];
      const ayId = currentAy?.id || 1;

      await AdminModel.reassignHOD({ teacherId, targetDeptId: department_id, ayId, adminUserId: req.user.id });
      res.json({ success: true, message: `HOD successfully reassigned to ${depts.name}` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Administratively reset password for an HOD teacher account
   * @route POST /api/v1/admin/hods/:teacher_id/reset-password (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.resetTeacherPassword() (models/adminModel.js)
   */
  static async resetHodPassword(req, res) {
    const teacherId = parseInt(req.params.teacher_id, 10);
    const { new_password } = req.body;
    try {
      const passwordHash = await bcrypt.hash(new_password, 12);
      const ok = await AdminModel.resetTeacherPassword(teacherId, passwordHash);
      if (!ok) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });
      res.json({ success: true, message: 'Password reset successfully. HOD must use the new password on next login.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Search faculty members across name, email, or employee ID
   * @route GET /api/v1/admin/faculty/search (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.searchFaculty() (models/adminModel.js)
   */
  static async searchFaculty(req, res) {
    try {
      const rows = await AdminModel.searchFaculty(req.query.search);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Appoint an existing faculty member to the HOD role of a department
   * @route POST /api/v1/admin/hods/assign-existing (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentById() (models/adminModel.js)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   * @usesModel AdminModel.reassignHOD() (models/adminModel.js)
   */
  static async assignExistingTeacherHod(req, res) {
    const { teacher_id, department_id } = req.body;
    try {
      const depts = await AdminModel.getDepartmentById(department_id);
      if (!depts) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found' } });

      const ayRows = await AdminModel.getAcademicYears();
      const currentAy = ayRows.find(a => a.is_current === 1) || ayRows[0];
      const ayId = currentAy?.id || 1;

      await AdminModel.reassignHOD({ teacherId: teacher_id, targetDeptId: department_id, ayId, adminUserId: req.user.id });
      res.json({ success: true, message: `Faculty successfully appointed as HOD for ${depts.name}` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Remove HOD appointment from teacher while maintaining teacher account
   * @route DELETE /api/v1/admin/hods/:teacher_id (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.removeHOD() (models/adminModel.js)
   */
  static async removeHod(req, res) {
    const teacherId = parseInt(req.params.teacher_id, 10);
    try {
      const ok = await AdminModel.removeHOD(teacherId);
      if (!ok) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });
      res.json({ success: true, message: 'HOD unassigned from department successfully. Teacher account remains active.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve list of registered IoT attendance devices
   * @route GET /api/v1/admin/devices (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDevices() (models/adminModel.js)
   */
  static async getDevices(req, res) {
    try {
      const rows = await AdminModel.getDevices();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Register a new IoT terminal hardware device
   * @route POST /api/v1/admin/devices (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   * @usesModel AdminModel.createDevice() (models/adminModel.js)
   */
  static async createDevice(req, res) {
    const { device_uid, name, department_id, year, semester, academic_year_id } = req.body;
    try {
      const ayRows = await AdminModel.getAcademicYears();
      const currentAy = ayRows.find(a => a.is_current === 1) || ayRows[0];
      const ayId = academic_year_id || currentAy?.id || 1;

      const secret = crypto.randomBytes(16).toString('hex');
      const secretHash = await bcrypt.hash(secret, 10);
      const id = await AdminModel.createDevice({ deviceUid: device_uid, name, departmentId: department_id, year, semester, ayId, secretHash });

      res.status(201).json({ success: true, data: { id, device_uid, name, device_secret: secret }, message: 'Device registered. Store the device_secret securely — it will not be shown again.' });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Device UID already registered' } });
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve all institutional system configuration settings
   * @route GET /api/v1/admin/settings (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getSettings() (models/adminModel.js)
   */
  static async getSettings(req, res) {
    try {
      const result = await AdminModel.getSettings();
      res.json({ success: true, data: { ...result.settings, raw: result.raw, map: result.settings } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update institutional system configuration key-value settings
   * @route PUT /api/v1/admin/settings (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.updateSettings() (models/adminModel.js)
   */
  static async updateSettings(req, res) {
    const settingsObj = { ...req.body.settings };
    if (settingsObj.default_attendance_threshold_percent && !settingsObj.attendance_threshold) {
      settingsObj.attendance_threshold = settingsObj.default_attendance_threshold_percent;
    } else if (settingsObj.attendance_threshold && !settingsObj.default_attendance_threshold_percent) {
      settingsObj.default_attendance_threshold_percent = settingsObj.attendance_threshold;
    }
    const entries = Object.entries(settingsObj);
    if (!entries.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No settings provided' } });

    try {
      await AdminModel.updateSettings(entries, req.user?.id);
      res.json({ success: true, message: 'Settings updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Compile and return department attendance analytics and scan logs
   * @route GET /api/v1/admin/reports/department, GET /api/v1/admin/reports/attendance (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentReportsData() (models/adminModel.js)
   */
  static async getDepartmentReports(req, res) {
    try {
      const data = await AdminModel.getDepartmentReportsData(req.query);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Export department attendance reports formatted as Excel workbook
   * @route GET /api/v1/admin/reports/export, POST /api/v1/admin/reports/export (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getDepartmentReportsData() (models/adminModel.js)
   * @usesService excelExportService.generateDepartmentReportsExcel() (services/excelExportService.js)
   */
  static async exportDepartmentReports(req, res) {
    try {
      const queryParams = { ...req.query, ...req.body };
      const data = await AdminModel.getDepartmentReportsData(queryParams);

      let filterDesc = 'All Recorded Scans';
      if (queryParams.date_preset === 'today') filterDesc = 'Today Scans';
      else if (queryParams.date_preset === '7days') filterDesc = 'Last 7 Days Scans';
      else if (queryParams.date_preset === '30days') filterDesc = 'Last 30 Days Scans';

      const excelBuffer = await generateDepartmentReportsExcel({
        kpis: data.kpis,
        cohort_summaries: data.cohort_summary,
        daily_trend: data.daily_trend,
        records: data.records,
        filter_description: filterDesc,
        chart_trend: queryParams.chart_trend,
        chart_cohort: queryParams.chart_cohort
      });

      const filenameDate = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Attendance-Analytics-Report-${filenameDate}.xlsx"`);
      res.send(excelBuffer);
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Correct attendance record status post-finalization with required audit justification
   * @route POST /api/v1/admin/attendance/corrections (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.applyAttendanceCorrection() (models/adminModel.js)
   */
  static async applyAttendanceCorrection(req, res) {
    const { register_record_id, new_status, reason } = req.body;
    try {
      const result = await AdminModel.applyAttendanceCorrection({
        registerRecordId: register_record_id,
        newStatus: new_status,
        reason,
        adminUserId: req.user.id
      });
      if (!result) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attendance record not found' } });

      res.json({
        success: true,
        message: 'Attendance record corrected and audited',
        data: {
          record_id: register_record_id,
          previous_status: result.oldRecord.attendance_status,
          new_status,
          reason,
          corrected_by: req.user.id
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Search and paginate system audit logs with multi-column filtering
   * @route GET /api/v1/admin/audit, GET /api/v1/admin/audit-logs (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesService auditService.getAuditLogs() (services/auditService.js)
   */
  static async getAuditLogs(req, res) {
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
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve institutional hierarchy tree of departments, teachers, and student cohorts
   * @route GET /api/v1/admin/hierarchy (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getHierarchy() (models/adminModel.js)
   */
  static async getHierarchy(req, res) {
    try {
      const hierarchy = await AdminModel.getHierarchy();
      res.json({
        success: true,
        data: hierarchy,
        departments: hierarchy
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve student demographic analytics, biometric coverage, and cohort breakdown
   * @route GET /api/v1/admin/students/analytics (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getStudentAnalytics() (models/adminModel.js)
   */
  static async getStudentAnalytics(req, res) {
    try {
      const deptId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;
      const data = await AdminModel.getStudentAnalytics(deptId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Paginated student roster listing with department and biometric details
   * @route GET /api/v1/admin/students/roster (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getStudentRoster() (models/adminModel.js)
   */
  static async getStudentRoster(req, res) {
    try {
      const { department_id, branch_id, search, limit = 150, offset = 0 } = req.query;
      const effDeptId = department_id || branch_id;
      const data = await AdminModel.getStudentRoster({ effDeptId, search, limit, offset });
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve current authenticated admin profile
   * @route GET /api/v1/admin/profile (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAdminProfile() (models/adminModel.js)
   */
  static async getProfile(req, res) {
    try {
      const profile = await AdminModel.getAdminProfile(req.user.id);
      if (!profile) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });
      res.json({
        success: true,
        data: {
          ...profile,
          roles: req.user.roles || ['SYSTEM_ADMIN'],
          is_admin: true
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Update admin profile email or password with verification of current password
   * @route PUT /api/v1/admin/profile (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.updateAdminProfile() (models/adminModel.js)
   */
  static async updateProfile(req, res) {
    const { email, current_password, new_password } = req.body;
    const { query } = require('../config/db');

    try {
      let newHash = null;
      if (new_password) {
        if (!current_password) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'current_password required to set new password' } });
        const userRow = (await query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]))[0];
        const match = await bcrypt.compare(current_password, userRow?.password_hash || '');
        if (!match) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
        newHash = await bcrypt.hash(new_password, 12);
      }

      await AdminModel.updateAdminProfile(req.user.id, { email, current_password, new_password: newHash });
      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List pending HOD self-registration requests awaiting administrative adjudication
   * @route GET /api/v1/admin/registrations/pending-hods (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getPendingHODRegistrations() (models/adminModel.js)
   */
  static async getPendingHods(req, res) {
    try {
      const rows = await AdminModel.getPendingHODRegistrations();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Approve a pending HOD registration, creating user account and departmental HOD assignment
   * @route POST /api/v1/admin/registrations/hods/:id/approve (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAcademicYears() (models/adminModel.js)
   * @usesModel AdminModel.approveHODRegistration() (models/adminModel.js)
   */
  static async approveHodRegistration(req, res) {
    const reqId = Number(req.params.id);
    try {
      const ayRows = await AdminModel.getAcademicYears();
      const currentAy = ayRows.find(a => a.is_current === 1) || ayRows[0];
      const ayId = currentAy?.id || 1;

      const result = await AdminModel.approveHODRegistration(reqId, req.user.id, ayId);
      if (!result) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending HOD registration request not found' } });

      res.status(200).json({
        success: true,
        message: `HOD registration request for ${result.full_name} has been approved successfully.`,
        data: {
          request_id: reqId,
          user_id: result.user_id,
          teacher_id: result.teacher_id,
          department_id: result.department_id,
          status: 'APPROVED'
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Reject a pending HOD registration request with reason
   * @route POST /api/v1/admin/registrations/hods/:id/reject (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.rejectHODRegistration() (models/adminModel.js)
   */
  static async rejectHodRegistration(req, res) {
    const reqId = Number(req.params.id);
    const { reason } = req.body;
    try {
      const ok = await AdminModel.rejectHODRegistration(reqId, req.user.id, reason);
      if (!ok) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending HOD registration request not found' } });
      res.json({ success: true, message: 'HOD registration request rejected.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve the currently designated Common Faculty Manager
   * @route GET /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getCommonFacultyManager() (models/adminModel.js)
   */
  static async getCommonFacultyManager(req, res) {
    try {
      const manager = await AdminModel.getCommonFacultyManager();
      res.json({ success: true, data: manager });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Assign a faculty member as the institutional Common Faculty Manager
   * @route POST /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.assignCommonFacultyManager() (models/adminModel.js)
   */
  static async assignCommonFacultyManager(req, res) {
    const teacherId = Number(req.body.teacher_id);
    try {
      const result = await AdminModel.assignCommonFacultyManager(teacherId, req.user.id);
      if (!result) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found' } });
      res.status(200).json({
        success: true,
        message: `${result.full_name} is now designated as the Common Faculty Manager.`,
        data: result
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Remove active Common Faculty Manager designation
   * @route DELETE /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.removeCommonFacultyManager() (models/adminModel.js)
   */
  static async removeCommonFacultyManager(req, res) {
    try {
      await AdminModel.removeCommonFacultyManager(req.user.id);
      res.json({ success: true, message: 'Common Faculty Manager designation removed successfully.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * List all active teachers across all departments
   * @route GET /api/v1/admin/teachers (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAllTeachers() (models/adminModel.js)
   */
  static async getAllTeachers(req, res) {
    try {
      const teachers = await AdminModel.getAllTeachers();
      res.json({ success: true, data: teachers });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve state of registration gates for HOD and Common Faculty
   * @route GET /api/v1/admin/registration-gates (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getRegistrationGates() (models/adminModel.js)
   */
  static async getRegistrationGates(req, res) {
    try {
      const gates = await AdminModel.getRegistrationGates();
      res.json({ success: true, data: gates });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Toggle open/closed state of institutional registration gate (HOD or COMMON_FACULTY)
   * @route POST /api/v1/admin/registration-gates/toggle (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.toggleRegistrationGate() (models/adminModel.js)
   */
  static async toggleRegistrationGate(req, res) {
    const { target, open } = req.body;
    const isOpen = Boolean(open);
    try {
      await AdminModel.toggleRegistrationGate(target, isOpen, req.user.id);
      res.json({
        success: true,
        message: `${target === 'HOD' ? 'Head of Department (HOD)' : 'Common Faculty'} self-registration is now ${isOpen ? 'OPEN' : 'CLOSED'}`,
        data: { target, is_open: isOpen }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve list of all administrators
   * @route GET /api/v1/admin/administrators (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.getAdministrators() (models/adminModel.js)
   */
  static async getAdministrators(req, res) {
    try {
      const admins = await AdminModel.getAdministrators();
      const enriched = admins.map(a => ({
        ...a,
        is_current: parseInt(a.id, 10) === parseInt(req.user.id, 10)
      }));
      res.json({ success: true, data: enriched });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Create a new administrator account
   * @route POST /api/v1/admin/administrators (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.createAdministrator() (models/adminModel.js)
   */
  static async createAdministrator(req, res) {
    const { email, password, full_name, phone, employee_id } = req.body;
    try {
      const created = await AdminModel.createAdministrator({ email, password, full_name, phone, employee_id });
      res.status(201).json({
        success: true,
        message: 'Administrator account created successfully',
        data: created
      });
    } catch (err) {
      const status = err.message.includes('already exists') ? 409 : 500;
      res.status(status).json({ success: false, error: { code: 'ADMIN_CREATION_FAILED', message: err.message } });
    }
  }

  /**
   * Delete an administrator account
   * @route DELETE /api/v1/admin/administrators/:id (routes/admin.js)
   * @access Protected (SYSTEM_ADMIN)
   * @usesModel AdminModel.deleteAdministrator() (models/adminModel.js)
   */
  static async deleteAdministrator(req, res) {
    const adminId = req.params.id;
    try {
      await AdminModel.deleteAdministrator(adminId, req.user.id);
      res.json({ success: true, message: 'Administrator account deleted successfully' });
    } catch (err) {
      const status = err.message.includes('cannot delete') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: 'ADMIN_DELETE_FAILED', message: err.message } });
    }
  }
}

module.exports = AdminController;
