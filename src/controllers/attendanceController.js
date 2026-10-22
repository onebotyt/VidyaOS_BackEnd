/**
 * Attendance Controller
 * Coordinates HTTP request processing, validations, business service invocations, and error responses.
 */

const AttendanceModel = require('../models/attendanceModel');
const attendanceService = require('../services/attendanceService');
const auditService = require('../services/auditService');

class AttendanceController {
  /**
   * Creates an attendance session and auto-resolves/provisions an attendance register if needed.
   * 
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AttendanceModel.getCurrentAcademicYearId() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getRegisterById() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getDefaultSubjectId() (models/attendanceModel.js)
   * @usesModel AttendanceModel.findExistingRegister() (models/attendanceModel.js)
   * @usesModel AttendanceModel.createRegister() (models/attendanceModel.js)
   * @usesService attendanceService.createSession() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async createSession(req, res) {
    try {
      let teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Teacher profile required to start attendance session' }
        });
      }

      let ayId = req.body.academic_year_id;
      if (!ayId) {
        ayId = await AttendanceModel.getCurrentAcademicYearId();
      }

      let registerId = req.body.register_id;
      let subjectId = req.body.subject_id;
      let deptId = req.body.department_id;
      let year = req.body.year;
      let sem = req.body.semester;

      if (registerId) {
        const reg = await AttendanceModel.getRegisterById(registerId);
        if (!reg) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attendance register not found' } });
        }
        if (!teacherId) teacherId = reg.teacher_id;
        subjectId = subjectId || reg.subject_id;
        deptId = deptId || reg.department_id;
        year = year || reg.year;
        sem = sem || reg.semester;
        ayId = ayId || reg.academic_year_id;

        if (!subjectId) {
          subjectId = await AttendanceModel.getDefaultSubjectId(deptId);
        }
      } else {
        if (!subjectId || !deptId || !year || !sem) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Either register_id or full cohort details (subject_id, department_id, year, semester) are required' }
          });
        }

        const existing = await AttendanceModel.findExistingRegister(teacherId, subjectId);
        if (existing) {
          registerId = existing.id;
        } else {
          const subName = await AttendanceModel.getSubjectName(subjectId);
          const ayLabel = await AttendanceModel.getAcademicYearLabel(ayId);
          const regName = `${subName || 'Subject'} — ${ayLabel || 'Academic Year'}`;
          registerId = await AttendanceModel.createRegister({
            teacherId,
            name: regName,
            subjectId,
            departmentId: deptId,
            year,
            semester: sem,
            academicYearId: ayId,
            sessionType: req.body.session_type
          });
        }
      }

      const session = await attendanceService.createSession({
        ...req.body,
        register_id: registerId,
        subject_id: subjectId,
        department_id: deptId,
        year,
        semester: sem,
        academic_year_id: ayId
      }, teacherId);

      res.status(201).json({ success: true, data: session });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves active or historical attendance sessions.
   * 
   * @route GET /api/v1/attendance/sessions (routes/attendance.js)
   * @access Protected (All Authenticated Users)
   * @usesModel AttendanceModel.listSessions() (models/attendanceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async listSessions(req, res) {
    try {
      const { state, subject_id } = req.query;
      const sessions = await AttendanceModel.listSessions({
        user: req.user,
        state,
        subject_id
      });
      res.status(200).json({ success: true, data: sessions });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves session metadata and live attendance roster marking snapshot.
   * 
   * @route GET /api/v1/attendance/sessions/:id (routes/attendance.js)
   * @access Protected (All Authenticated Users)
   * @usesModel AttendanceModel.getSessionWithCohort() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getSessionRosterWithMarking() (models/attendanceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async getSessionDetails(req, res) {
    const sessionId = req.params.id;
    try {
      const session = await AttendanceModel.getSessionWithCohort(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
      }

      const roster = await AttendanceModel.getSessionRosterWithMarking(sessionId, session);
      res.status(200).json({
        success: true,
        data: {
          session,
          roster
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Transitions lifecycle state of an attendance session (DRAFT -> OPEN -> CLOSED -> FINALIZED).
   * 
   * @route PUT /api/v1/attendance/sessions/:id/state (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.transitionState() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async transitionState(req, res) {
    try {
      const result = await attendanceService.transitionState(
        req.params.id,
        req.body.state,
        req.user.teacher_id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          details: err.details || null
        }
      });
    }
  }

  /**
   * Generates a 6-digit rolling dynamic PIN for classroom roll call.
   * 
   * @route POST /api/v1/attendance/sessions/:id/pin (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.generatePin() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async generatePin(req, res) {
    try {
      const result = await attendanceService.generatePin(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates a dynamic single-use QR payload for student visual check-in.
   * 
   * @route POST /api/v1/attendance/sessions/:id/qr (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.generateQr() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async generateQr(req, res) {
    try {
      const result = await attendanceService.generateQr(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Submits student self-attendance check-in request with PIN, QR token, and location proof.
   * 
   * @route POST /api/v1/attendance/sessions/:id/self-attendance (routes/attendance.js)
   * @access Protected (STUDENT)
   * @usesService attendanceService.submitSelfAttendance() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async submitSelfAttendance(req, res) {
    try {
      const result = await attendanceService.submitSelfAttendance(
        req.params.id,
        req.user.student_id,
        req.body
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves pending student self-attendance check-in claims for faculty adjudication.
   * 
   * @route GET /api/v1/attendance/sessions/:id/self-attendance (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.getSelfAttendanceRequests() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async getSelfAttendanceRequests(req, res) {
    try {
      const requests = await attendanceService.getSelfAttendanceRequests(req.params.id);
      res.status(200).json({ success: true, data: requests });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adjudicates (ACCEPT / REJECT) a student check-in claim.
   * 
   * @route POST /api/v1/attendance/sessions/:id/self-attendance/:reqId/adjudicate (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.adjudicateSelfAttendance() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async adjudicateSelfAttendance(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
      }
      const result = await attendanceService.adjudicateSelfAttendance(
        req.params.id,
        req.params.reqId,
        req.body.action,
        teacherId || req.user.id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Synchronizes biometric presence events recorded by ESP32 terminals during session timeframe.
   * 
   * @route POST /api/v1/attendance/sessions/:id/sync-esp32 (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.syncEsp32Scans() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async syncEsp32Scans(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
      }
      const result = await attendanceService.syncEsp32Scans(req.params.id, teacherId || req.user.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Bulk-saves verified attendance status records for a session roster.
   * 
   * @route POST /api/v1/attendance/sessions/:id/records (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.saveRegisterRecords() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async saveRecords(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
      }
      const result = await attendanceService.saveRegisterRecords(
        req.params.id,
        req.body.records,
        teacherId || req.user.id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves register total conducted sessions and average turnout percentage.
   * 
   * @route GET /api/v1/attendance/registers/:id/summary (routes/attendance.js)
   * @access Protected (All Authenticated Users)
   * @usesModel AttendanceModel.getRegisterSummary() (models/attendanceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async getRegisterSummary(req, res) {
    try {
      const regId = Number(req.params.id);
      const r = await AttendanceModel.getRegisterSummary(regId);
      const avgPct = r.total_records > 0 ? (r.total_present * 100.0 / r.total_records) : null;
      res.json({
        success: true,
        data: {
          register_id: regId,
          total_sessions: r.total_sessions || 0,
          avg_attendance_pct: avgPct !== null ? Number(avgPct.toFixed(1)) : null
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Retrieves biometric ESP32 day scans for day-based ledger reconciliation.
   * 
   * @route GET /api/v1/attendance/registers/:id/esp32-day-scans (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AttendanceModel.getRegisterById() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getDeviceForCohort() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getEsp32DayScans() (models/attendanceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async getEsp32DayScans(req, res) {
    try {
      const registerId = req.params.id;
      const date = req.query.date || new Date().toISOString().slice(0, 10);

      const reg = await AttendanceModel.getRegisterById(registerId);
      if (!reg) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
      }

      const d = await AttendanceModel.getDeviceForCohort(reg.department_id, reg.year, reg.semester);
      let device = null;
      if (d) {
        const hbStr = d.last_heartbeat_at ? (d.last_heartbeat_at.includes('Z') ? d.last_heartbeat_at : (d.last_heartbeat_at.replace(' ', 'T') + 'Z')) : null;
        const isOnline = d.is_active && hbStr && (Math.abs(Date.now() - new Date(hbStr).getTime()) < 120 * 60 * 1000);
        device = {
          id: d.id,
          device_uid: d.device_uid,
          name: d.name,
          is_online: Boolean(isOnline),
          last_heartbeat_at: d.last_heartbeat_at
        };
      }

      const scans = await AttendanceModel.getEsp32DayScans(reg, date);

      res.json({
        success: true,
        data: {
          register_id: Number(registerId),
          date,
          device,
          scans: scans.map(s => ({
            student_id: s.student_id,
            scan_id: s.scan_id,
            class_roll_no: s.class_roll_no,
            full_name: s.full_name,
            official_enrollment_no: s.official_enrollment_no,
            scan_time: s.scan_time,
            device_name: s.device_name || device?.name || 'ESP32 Terminal'
          }))
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Confirms and finalizes day-level biometric attendance in attendance register ledger.
   * 
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AttendanceModel.getRegisterById() (models/attendanceModel.js)
   * @usesModel AttendanceModel.findOrCreateDaySession() (models/attendanceModel.js)
   * @usesModel AttendanceModel.getEnrolledStudentsForRegister() (models/attendanceModel.js)
   * @usesModel AttendanceModel.snapshotRoster() (models/attendanceModel.js)
   * @usesModel AttendanceModel.recordDayAttendance() (models/attendanceModel.js)
   * @usesModel AttendanceModel.finalizeDaySession() (models/attendanceModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async confirmDayAttendance(req, res) {
    try {
      const registerId = req.params.id;
      const { date, session_type, student_ids = [] } = req.body;

      if (!date) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date is required (YYYY-MM-DD)' } });
      }

      const reg = await AttendanceModel.getRegisterById(registerId);
      if (!reg) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
      }
      const teacherId = req.user.teacher_id || reg.teacher_id;

      const session = await AttendanceModel.findOrCreateDaySession(registerId, date, teacherId, reg, session_type);
      const enrolled = await AttendanceModel.getEnrolledStudentsForRegister(reg);
      await AttendanceModel.snapshotRoster(session.id, enrolled);
      await AttendanceModel.recordDayAttendance(session.id, enrolled, student_ids, req.user.id);
      await AttendanceModel.finalizeDaySession(session.id, date);

      try {
        await auditService.logAudit({
          eventType: auditService.AUDIT_EVENTS.ESP_SYNC_EXECUTED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'attendance_sessions',
          targetId: session.id,
          details: { register_id: registerId, session_date: date, confirmed_count: student_ids.length },
          ipAddress: req.ip
        });

        await auditService.logAudit({
          eventType: auditService.AUDIT_EVENTS.ATTENDANCE_FINALIZED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'attendance_sessions',
          targetId: session.id,
          details: { register_id: registerId, session_date: date },
          ipAddress: req.ip
        });
      } catch (_) {}

      res.json({
        success: true,
        message: `Successfully confirmed attendance for ${student_ids.length} students on ${date}`,
        data: {
          session_id: session.id,
          register_id: Number(registerId),
          session_date: date,
          confirmed_count: student_ids.length
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Corrects an already-finalized attendance entry with an audit log trail.
   * 
   * @route POST /api/v1/attendance/sessions/:id/correct (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AttendanceModel.getSessionAuthCheck() (models/attendanceModel.js)
   * @usesService attendanceService.correctAttendanceRecord() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async correctAttendance(req, res) {
    try {
      const sessionId = req.params.id;
      const { student_id, new_status, reason } = req.body;

      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const s = await AttendanceModel.getSessionAuthCheck(sessionId);
        if (!s) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attendance session not found' } });
        }
        const isOwner = req.user.teacher_id && s.teacher_id === req.user.teacher_id;
        const isHod = s.hod_user_id === req.user.id;

        if (!isOwner && !isHod) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only the session teacher, department HOD, or Administrator can correct attendance.' }
          });
        }
      }

      const result = await attendanceService.correctAttendanceRecord(
        sessionId,
        student_id,
        new_status,
        reason,
        req.user.id
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Attendance record successfully corrected and audited.'
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves correction audit trail history for a session.
   * 
   * @route GET /api/v1/attendance/sessions/:id/corrections (routes/attendance.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesService attendanceService.getSessionCorrections() (services/attendanceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  static async getCorrections(req, res) {
    try {
      const history = await attendanceService.getSessionCorrections(req.params.id);
      res.status(200).json({ success: true, data: history });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = AttendanceController;
