/**
 * Student Controller
 * Coordinates HTTP request processing, validations, business service invocations, and error responses for students.
 *
 * Architecture Role: Controller (HTTP Coordination Layer)
 * Interacts With:
 *   - Models: models/studentModel.js
 *   - Routes: routes/students.js
 *   - Services: services/reportService.js, services/auditService.js, services/notificationService.js
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const StudentModel = require('../models/studentModel');
const reportService = require('../services/reportService');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

class StudentController {
  /**
   * Retrieve department student roster
   * @route GET /api/v1/students (routes/students.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel StudentModel.getStudents() (models/studentModel.js)
   */
  static async getStudents(req, res) {
    try {
      let deptId = req.query.department_id || req.query.branch_id || req.teacher_department_id || req.user.department_id || req.user.hod_department_id;
      if (!deptId && req.user.teacher_id) {
        deptId = await StudentModel.getTeacherDepartment(req.user.teacher_id);
      }
      const { year, semester, search, status, academic_year_id, limit = 500, offset = 0 } = req.query;
      const result = await StudentModel.getStudents(deptId, { year, semester, search, status, academic_year_id, limit, offset });
      res.json({
        success: true,
        data: result.students,
        students: result.students,
        total: result.total,
        pagination: { total: result.total, limit: parseInt(limit, 10), offset: parseInt(offset, 10) }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves self student profile including biometric enrollment status and attendance overview.
   * @route GET /api/v1/students/me (routes/students.js)
   * @access STUDENT
   * @usesModel StudentModel.getProfile() (models/studentModel.js)
   * @usesModel StudentModel.getBiometricSlot() (models/studentModel.js)
   * @usesService reportService.getStudentAttendanceStats() (services/reportService.js)
   */
  static async getProfile(req, res) {
    try {
      const studentData = await StudentModel.getProfile(req.user.student_id);
      if (!studentData) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student record not found' } });
      }

      const fp = await StudentModel.getBiometricSlot(req.user.student_id);
      studentData.fingerprint_enrolled = Boolean(fp);
      studentData.fingerprint_slot = fp ? fp.slot_id : null;
      studentData.fingerprint_device = fp ? fp.device_name : null;

      try {
        studentData.attendance_stats = await reportService.getStudentAttendanceStats(req.user.student_id);
      } catch (_) {
        studentData.attendance_stats = null;
      }

      res.status(200).json({ success: true, data: studentData });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates student self profile email and/or password.
   * @route PUT /api/v1/students/me (routes/students.js)
   * @access STUDENT
   * @usesModel StudentModel.updateUserEmail() (models/studentModel.js)
   * @usesModel StudentModel.getUserPasswordHash() (models/studentModel.js)
   * @usesModel StudentModel.updateUserPassword() (models/studentModel.js)
   */
  static async updateProfile(req, res) {
    const {
      email,
      current_password,
      new_password,
      address,
      aadhar_number,
      father_name,
      mother_name,
      dob,
      gender,
      category,
      phone
    } = req.body;

    try {
      if (email !== undefined) {
        await StudentModel.updateUserEmail(req.user.id, email);
      }

      if (new_password) {
        if (!current_password) {
          return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Current password required to set new password' } });
        }
        const currentHash = await StudentModel.getUserPasswordHash(req.user.id);
        const match = await bcrypt.compare(current_password, currentHash || '');
        if (!match) {
          return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
        }
        const newHash = await bcrypt.hash(new_password, 12);
        await StudentModel.updateUserPassword(req.user.id, newHash);
      }

      // Demographic & KYC updates
      const studentId = req.user.student_id || (await StudentModel.getStudentIdByUserId(req.user.id));
      if (studentId) {
        const details = {};
        if (address !== undefined) details.address = (address || '').trim();
        if (aadhar_number !== undefined) details.aadhar_number = (aadhar_number || '').trim();
        if (father_name !== undefined) details.father_name = (father_name || '').trim();
        if (mother_name !== undefined) details.mother_name = (mother_name || '').trim();
        if (dob !== undefined) details.dob = (dob || '').trim();
        if (gender !== undefined) details.gender = (gender || '').trim();
        if (category !== undefined) details.category = (category || '').trim();
        if (phone !== undefined) details.phone = (phone || '').trim();

        if (Object.keys(details).length > 0) {
          const existing = await StudentModel.getProfile(studentId);
          const merged = { ...existing, ...details };
          const isComplete = Boolean(
            merged.address &&
            merged.aadhar_number &&
            merged.father_name &&
            merged.mother_name &&
            merged.dob &&
            merged.gender &&
            merged.category
          );
          details.profile_completed = isComplete ? 1 : 0;
          await StudentModel.updateStudentDetails(studentId, details);
        }
      }

      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves overall attendance stats for authenticated student.
   * @route GET /api/v1/students/me/attendance/stats (routes/students.js)
   * @access STUDENT
   * @usesService reportService.getStudentAttendanceStats() (services/reportService.js)
   */
  static async getAttendanceStats(req, res) {
    try {
      const stats = await reportService.getStudentAttendanceStats(req.user.student_id);
      res.status(200).json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves per-subject attendance percentages for authenticated student.
   * @route GET /api/v1/students/me/attendance/subjects (routes/students.js)
   * @access STUDENT
   * @usesService reportService.getStudentSubjectBreakdown() (services/reportService.js)
   */
  static async getAttendanceSubjects(req, res) {
    try {
      const subjects = await reportService.getStudentSubjectBreakdown(req.user.student_id);
      res.status(200).json({ success: true, data: subjects });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves paginated attendance session logs for authenticated student.
   * @route GET /api/v1/students/me/attendance (routes/students.js)
   * @access STUDENT
   * @usesService reportService.getStudentAttendanceHistory() (services/reportService.js)
   */
  static async getAttendanceHistory(req, res) {
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
  }

  /**
   * Provisions a single new student account with generated credentials.
   * @route POST /api/v1/students/provision (routes/students.js)
   * @access TEACHER, requireDepartmentFaculty()
   * @usesModel StudentModel.getTeacherDepartment() (models/studentModel.js)
   * @usesModel StudentModel.getCurrentAcademicYearId() (models/studentModel.js)
   * @usesModel StudentModel.checkEnrollmentConflict() (models/studentModel.js)
   * @usesModel StudentModel.checkEmailConflict() (models/studentModel.js)
   * @usesModel StudentModel.getNextClassRollNo() (models/studentModel.js)
   * @usesModel StudentModel.checkClassRollConflict() (models/studentModel.js)
   * @usesModel StudentModel.provisionStudentTransaction() (models/studentModel.js)
   */
  static async provisionStudent(req, res) {
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
        const teacherDept = await StudentModel.getTeacherDepartment(req.user.teacher_id);
        if (teacherDept !== Number(department_id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only provision students in your own department.' }
          });
        }
      }

      const ayId = academic_year_id || (await StudentModel.getCurrentAcademicYearId());
      if (!ayId) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Academic year not found' } });
      }

      const cleanEnroll = official_enrollment_no.trim();
      const enrollConflict = await StudentModel.checkEnrollmentConflict(cleanEnroll);
      if (enrollConflict) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: `Official Enrollment Number "${cleanEnroll}" already exists in the system. Enrollment numbers are uniquely assigned once upon admission.` }
        });
      }

      if (email && email.trim()) {
        const cleanEmail = email.trim();
        const emailConflict = await StudentModel.checkEmailConflict(cleanEmail);
        if (emailConflict) {
          return res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: `Email "${cleanEmail}" is already registered to an account.` }
          });
        }
      }

      let finalRoll = class_roll_no ? Number(class_roll_no) : null;
      if (!finalRoll || isNaN(finalRoll) || finalRoll <= 0) {
        finalRoll = await StudentModel.getNextClassRollNo(department_id, year, semester, ayId);
      } else {
        const rollConflict = await StudentModel.checkClassRollConflict(department_id, year, semester, ayId, finalRoll);
        if (rollConflict) {
          return res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: `Class roll number ${finalRoll} is already assigned in this cohort` }
          });
        }
      }

      const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
      const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

      const provisioned = await StudentModel.provisionStudentTransaction({
        cleanEnroll,
        email,
        tempPasswordHash,
        tempPassword,
        registrationNo: registration_no,
        finalRoll,
        fullName: full_name,
        departmentId: department_id,
        year,
        semester,
        ayId
      });

      res.status(201).json({ success: true, data: provisioned });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Enrollment number already exists' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Bulk provisions multiple student accounts within a cohort.
   * @route POST /api/v1/students/provision/bulk (routes/students.js)
   * @access TEACHER, requireDepartmentFaculty()
   * @usesModel StudentModel.getTeacherDepartment() (models/studentModel.js)
   * @usesModel StudentModel.getCurrentAcademicYearId() (models/studentModel.js)
   * @usesModel StudentModel.checkEnrollmentConflict() (models/studentModel.js)
   * @usesModel StudentModel.checkEmailConflict() (models/studentModel.js)
   * @usesModel StudentModel.getNextClassRollNo() (models/studentModel.js)
   * @usesModel StudentModel.checkClassRollConflict() (models/studentModel.js)
   * @usesModel StudentModel.provisionStudentTransaction() (models/studentModel.js)
   */
  static async bulkProvision(req, res) {
    const { department_id, year, semester, academic_year_id, students } = req.body;

    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const teacherDept = await StudentModel.getTeacherDepartment(req.user.teacher_id);
        if (teacherDept !== Number(department_id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only provision students in your own department.' }
          });
        }
      }

      const ayId = academic_year_id || (await StudentModel.getCurrentAcademicYearId());
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

        if (!full_name || !official_enrollment_no) {
          results.errors.push({
            enrollment_no: official_enrollment_no || 'UNKNOWN',
            reason: 'Missing full_name or official_enrollment_no'
          });
          continue;
        }

        const cleanEnroll = official_enrollment_no.trim();
        const enrollConflict = await StudentModel.checkEnrollmentConflict(cleanEnroll);
        if (enrollConflict) {
          results.errors.push({
            enrollment_no: cleanEnroll,
            reason: `Official Enrollment Number "${cleanEnroll}" already exists in the institution.`
          });
          continue;
        }

        if (email && email.trim()) {
          const cleanEmail = email.trim();
          const emailConflict = await StudentModel.checkEmailConflict(cleanEmail);
          if (emailConflict) {
            results.errors.push({
              enrollment_no: cleanEnroll,
              reason: `Email "${cleanEmail}" is already registered.`
            });
            continue;
          }
        }

        let finalRoll = class_roll_no ? Number(class_roll_no) : null;
        if (!finalRoll || isNaN(finalRoll) || finalRoll <= 0) {
          finalRoll = await StudentModel.getNextClassRollNo(department_id, year, semester, ayId);
        } else {
          const rollCheck = await StudentModel.checkClassRollConflict(department_id, year, semester, ayId, finalRoll);
          if (rollCheck) {
            results.errors.push({
              enrollment_no: cleanEnroll,
              reason: `Roll number ${finalRoll} already exists in this cohort`
            });
            continue;
          }
        }

        try {
          const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
          const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

          const studentRecord = await StudentModel.provisionStudentTransaction({
            cleanEnroll,
            email,
            tempPasswordHash,
            tempPassword,
            registrationNo: registration_no,
            finalRoll,
            fullName: full_name,
            departmentId: department_id,
            year,
            semester,
            ayId
          });

          results.provisioned.push(studentRecord);
        } catch (subErr) {
          results.errors.push({
            enrollment_no: cleanEnroll,
            reason: (subErr.code === 'ER_DUP_ENTRY' || subErr.code === 'SQLITE_CONSTRAINT') ? 'Enrollment number already exists' : subErr.message
          });
        }
      }

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves pending student self-registrations for teacher review.
   * @route GET /api/v1/students/registrations/pending (routes/students.js)
   * @access TEACHER, requireDepartmentFaculty()
   * @usesModel StudentModel.getTeacherDepartment() (models/studentModel.js)
   * @usesModel StudentModel.getCurrentAcademicYearId() (models/studentModel.js)
   * @usesModel StudentModel.listPendingRegistrations() (models/studentModel.js)
   */
  static async listPendingRegistrations(req, res) {
    try {
      let deptId = req.query.department_id || req.teacher_department_id;
      if (!deptId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        deptId = await StudentModel.getTeacherDepartment(req.user.teacher_id);
      }

      const ayId = req.query.academic_year_id || (await StudentModel.getCurrentAcademicYearId());
      const pending = await StudentModel.listPendingRegistrations({
        deptId,
        year: req.query.year,
        semester: req.query.semester,
        ayId
      });
      res.status(200).json({ success: true, data: pending });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Counts pending student self-registrations for dashboard badge display.
   * @route GET /api/v1/students/registrations/count (routes/students.js)
   * @access TEACHER, requireDepartmentFaculty()
   * @usesModel StudentModel.getTeacherDepartment() (models/studentModel.js)
   * @usesModel StudentModel.getCurrentAcademicYearId() (models/studentModel.js)
   * @usesModel StudentModel.countPendingRegistrations() (models/studentModel.js)
   */
  static async countPendingRegistrations(req, res) {
    try {
      let deptId = req.query.department_id || req.teacher_department_id;
      if (!deptId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        deptId = await StudentModel.getTeacherDepartment(req.user.teacher_id);
      }

      const ayId = req.query.academic_year_id || (await StudentModel.getCurrentAcademicYearId());
      const count = await StudentModel.countPendingRegistrations({
        deptId,
        year: req.query.year,
        semester: req.query.semester,
        ayId
      });
      res.status(200).json({ success: true, data: { count } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adjudicates (approves/rejects) a student self-registration request.
   * @route POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @access TEACHER, requireDepartmentFaculty()
   * @usesModel StudentModel.lookupPendingStudentId() (models/studentModel.js)
   * @usesModel StudentModel.getStudentDepartmentId() (models/studentModel.js)
   * @usesModel StudentModel.getTeacherDepartment() (models/studentModel.js)
   * @usesModel StudentModel.isHodOfDepartment() (models/studentModel.js)
   * @usesModel StudentModel.adjudicateRegistrationTransaction() (models/studentModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   * @usesService notificationService.sendNotification() (services/notificationService.js)
   */
  static async adjudicateRegistration(req, res) {
    const studentId = req.params.id;
    const action = req.body.action || (req.path.includes('reject') ? 'REJECT' : 'APPROVE');
    const { class_roll_no, enrollment_no, official_enrollment_no, rejection_reason } = req.body;

    try {
      let resolvedStudentId = (!isNaN(Number(studentId)) && Number(studentId) > 0) ? Number(studentId) : null;
      const lookupVal = (official_enrollment_no || enrollment_no || (studentId !== 'undefined' && studentId !== 'null' ? studentId : '')).trim();

      if (!resolvedStudentId && lookupVal) {
        resolvedStudentId = await StudentModel.lookupPendingStudentId(lookupVal);
      }

      if (!req.user.roles.includes('SYSTEM_ADMIN') && resolvedStudentId) {
        const studentDeptId = await StudentModel.getStudentDepartmentId(resolvedStudentId);
        if (studentDeptId) {
          const teacherDeptId = req.teacher_department_id || (await StudentModel.getTeacherDepartment(req.user.teacher_id));
          if (teacherDeptId && Number(studentDeptId) !== Number(teacherDeptId)) {
            const isHod = await StudentModel.isHodOfDepartment(studentDeptId, req.user.id);
            if (!isHod) {
              return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'You can only adjudicate registrations for students in your department.' }
              });
            }
          }
        }
      }

      const outcome = await StudentModel.adjudicateRegistrationTransaction({
        resolvedStudentId,
        lookupVal,
        action,
        officialEnrollmentNo: official_enrollment_no,
        enrollmentNo: enrollment_no,
        classRollNo: class_roll_no,
        rejectionReason: rejection_reason
      });

      try {
        const isApprove = action === 'APPROVE';
        await auditService.logAudit({
          eventType: isApprove ? auditService.AUDIT_EVENTS.STUDENT_APPROVED : auditService.AUDIT_EVENTS.STUDENT_REJECTED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'students',
          targetId: outcome.actualStudentId,
          details: { action, official_enrollment_no: outcome.resolvedEnrollNo, class_roll_no: outcome.finalRollNo, reason: rejection_reason || null },
          ipAddress: req.ip
        });

        await notificationService.sendNotification({
          userId: outcome.userId,
          type: notificationService.NOTIFICATION_TYPES.STUDENT_APPROVAL,
          title: isApprove ? 'Enrollment Approved' : 'Enrollment Application Update',
          message: isApprove
            ? `Your student registration has been approved. Enrollment Number: ${outcome.resolvedEnrollNo} (Class Roll: ${outcome.finalRollNo}).`
            : `Your registration request was not approved: ${rejection_reason || 'Criteria not met'}.`,
          linkUrl: isApprove ? '/student/attendance.html' : null
        });
      } catch (_) {}

      res.status(200).json({
        success: true,
        message: `Registration ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`,
        data: action === 'APPROVE' ? {
          student_id: Number(outcome.actualStudentId),
          name: outcome.studentName,
          official_enrollment_no: outcome.resolvedEnrollNo,
          enrollment_no: outcome.resolvedEnrollNo,
          class_roll_no: outcome.finalRollNo,
          roll_no: String(outcome.finalRollNo),
          status: 'ACTIVE'
        } : null
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Transfers a student to another department with historical enrollment preserved.
   * @route POST /api/v1/students/:id/transfer-department (routes/students.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel StudentModel.getStudentForTransfer() (models/studentModel.js)
   * @usesModel StudentModel.isHodOfAnyDepartment() (models/studentModel.js)
   * @usesModel StudentModel.transferDepartmentTransaction() (models/studentModel.js)
   */
  static async transferDepartment(req, res) {
    const studentId = req.params.id;
    const { new_department_id, reason } = req.body;

    try {
      const student = await StudentModel.getStudentForTransfer(studentId);
      if (!student) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student or active enrollment not found' } });
      }

      if (Number(student.current_dept_id) === Number(new_department_id)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Student is already enrolled in this department' } });
      }

      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const isHod = await StudentModel.isHodOfAnyDepartment([student.current_dept_id, new_department_id], req.user.id);
        if (!isHod) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only Department HOD or Admin can transfer students between departments.' } });
        }
      }

      const result = await StudentModel.transferDepartmentTransaction({
        studentId,
        student,
        newDepartmentId: new_department_id,
        reason,
        actorId: req.user.id
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

  /**
   * Retrieves department enrollment transfer history for a student.
   * @route GET /api/v1/students/:id/department-history (routes/students.js)
   * @access Authenticated (Student can only view self)
   * @usesModel StudentModel.getDepartmentHistory() (models/studentModel.js)
   */
  static async getDepartmentHistory(req, res) {
    try {
      const studentId = req.params.id;
      if (req.user.roles.includes('STUDENT') && Number(req.user.student_id) !== Number(studentId)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized' } });
      }

      const history = await StudentModel.getDepartmentHistory(studentId);
      res.status(200).json({ success: true, data: history });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates comprehensive multi-semester academic dossier (attendance, assignments, exams).
   * @route GET /api/v1/students/:id/academic-dossier (routes/students.js)
   * @access Authenticated (Student can only view self)
   * @usesModel StudentModel.getAcademicDossierRaw() (models/studentModel.js)
   */
  static async getAcademicDossier(req, res) {
    try {
      const studentId = Number(req.params.id);
      if (isNaN(studentId)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid student ID' } });
      }

      if (req.user.roles.includes('STUDENT') && Number(req.user.student_id) !== studentId) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized' } });
      }

      const raw = await StudentModel.getAcademicDossierRaw(studentId);
      if (!raw) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student record not found' } });
      }

      const { student, historyRows, attendanceRows, assignmentRows, examRows } = raw;

      const semSet = new Set();
      historyRows.forEach(h => semSet.add(h.semester));
      attendanceRows.forEach(a => { if (a.semester) semSet.add(a.semester); });
      assignmentRows.forEach(asgn => { if (asgn.semester) semSet.add(asgn.semester); });
      examRows.forEach(ex => { if (ex.semester) semSet.add(ex.semester); });
      if (student.current_semester) semSet.add(student.current_semester);
      if (semSet.size === 0) semSet.add(1);

      const sortedSemesters = Array.from(semSet).sort((a, b) => a - b);
      const semesterDossiers = [];

      let overallTotalHeld = 0;
      let overallTotalPresent = 0;

      for (const sem of sortedSemesters) {
        const year = Math.ceil(sem / 2);
        const enHistory = historyRows.find(h => h.semester === sem) || null;

        const semAtt = attendanceRows.filter(a => a.semester === sem);
        const subjectMap = {};

        semAtt.forEach(att => {
          const subKey = att.subject_code || `SUB_${att.subject_id || 'UNKNOWN'}`;
          if (!subjectMap[subKey]) {
            subjectMap[subKey] = {
              subject_id: att.subject_id,
              subject_code: att.subject_code || 'N/A',
              subject_name: att.subject_name || att.register_name || 'Class Subject',
              teacher_name: att.teacher_name || 'Faculty',
              total_sessions: 0,
              present_count: 0,
              late_count: 0,
              absent_count: 0,
              percentage: 0,
              sessions: []
            };
          }
          subjectMap[subKey].total_sessions++;
          overallTotalHeld++;
          if (att.attendance_status === 'PRESENT') {
            subjectMap[subKey].present_count++;
            overallTotalPresent++;
          } else if (att.attendance_status === 'LATE') {
            subjectMap[subKey].late_count++;
            overallTotalPresent++;
          } else {
            subjectMap[subKey].absent_count++;
          }

          subjectMap[subKey].sessions.push({
            session_id: att.session_id,
            session_date: att.session_date,
            session_type: att.session_type,
            status: att.attendance_status,
            remarks: att.remarks
          });
        });

        const subjectsAttendance = Object.values(subjectMap).map(sub => {
          sub.percentage = sub.total_sessions > 0
            ? Math.round(((sub.present_count + sub.late_count) / sub.total_sessions) * 1000) / 10
            : 0;
          return sub;
        });

        const semHeld = subjectsAttendance.reduce((acc, s) => acc + s.total_sessions, 0);
        const semPres = subjectsAttendance.reduce((acc, s) => acc + (s.present_count + s.late_count), 0);
        const semPercentage = semHeld > 0 ? Math.round((semPres / semHeld) * 1000) / 10 : 0;

        const semAssignments = assignmentRows
          .filter(asgn => asgn.semester === sem)
          .map(asgn => ({
            submission_id: asgn.submission_id,
            assignment_id: asgn.assignment_id,
            title: asgn.assignment_title,
            description: asgn.description,
            subject_code: asgn.subject_code || 'N/A',
            subject_name: asgn.subject_name || 'Subject',
            teacher_name: asgn.teacher_name,
            max_marks: asgn.max_marks,
            marks_obtained: asgn.marks_obtained,
            percentage: asgn.marks_obtained !== null && asgn.max_marks > 0
              ? Math.round((asgn.marks_obtained / asgn.max_marks) * 1000) / 10
              : null,
            feedback: asgn.feedback,
            file_path: asgn.file_path,
            original_filename: asgn.original_filename,
            submitted_at: asgn.submitted_at,
            graded_at: asgn.graded_at,
            status: asgn.submission_status
          }));

        const semExams = examRows
          .filter(ex => ex.semester === sem)
          .map(ex => ({
            score_id: ex.score_id,
            exam_id: ex.exam_id,
            exam_name: ex.exam_name,
            exam_date: ex.exam_date,
            subject_code: ex.subject_code || 'N/A',
            subject_name: ex.subject_name || 'Subject',
            teacher_name: ex.teacher_name,
            max_marks: ex.max_marks,
            marks_obtained: ex.marks_obtained,
            percentage: ex.marks_obtained !== null && ex.max_marks > 0
              ? Math.round((ex.marks_obtained / ex.max_marks) * 1000) / 10
              : null,
            remarks: ex.remarks,
            recorded_at: ex.created_at
          }));

        semesterDossiers.push({
          semester: sem,
          year,
          enrollment_info: enHistory,
          attendance: {
            total_held: semHeld,
            total_present: semPres,
            percentage: semPercentage,
            by_subject: subjectsAttendance
          },
          assignments: semAssignments,
          exams: semExams
        });
      }

      const overallPercentage = overallTotalHeld > 0
        ? Math.round((overallTotalPresent / overallTotalHeld) * 1000) / 10
        : 0;

      res.status(200).json({
        success: true,
        data: {
          student,
          summary: {
            total_semesters_recorded: semesterDossiers.length,
            overall_attendance_held: overallTotalHeld,
            overall_attendance_present: overallTotalPresent,
            overall_attendance_percentage: overallPercentage,
            total_assignments_submitted: assignmentRows.length,
            total_exams_recorded: examRows.length
          },
          semesters: semesterDossiers
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = StudentController;
