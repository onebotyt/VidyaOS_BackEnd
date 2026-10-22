/**
 * Faculty Controller
 * Coordinates HTTP requests and responses for faculty dashboard, registers,
 * quick cell marking, internal evaluation, exports, and common faculty management.
 *
 * Architecture Role: Controller (HTTP Coordination Layer)
 * Interacts With:
 *   - Models: models/facultyModel.js
 *   - Routes: routes/faculty.js
 *   - Services: services/deviceService.js, services/excelExportService.js
 */

const bcrypt = require('bcrypt');
const FacultyModel = require('../models/facultyModel');
const deviceService = require('../services/deviceService');
const excelExportService = require('../services/excelExportService');

const STANDARD_HOLIDAYS = {
  '01-26': 'REPUBLIC DAY',
  '08-15': 'INDEPENDENCE DAY',
  '08-19': 'RAKSHA BANDHAN',
  '08-26': 'ID-E-MILAD',
  '10-02': 'MAHATMA GANDHI JAYANTI',
  '10-24': 'DUSSEHRA',
  '11-01': 'DIWALI VACATION',
  '11-02': 'GOVARDHAN PUJA',
  '11-15': 'GURU NANAK JAYANTI',
  '12-25': 'CHRISTMAS DAY'
};

class FacultyController {
  /**
   * Retrieves faculty dashboard summary metrics (registers count, today's schedule, pending approvals).
   * @route GET /api/v1/faculty/dashboard (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getDashboardSummary() (models/facultyModel.js)
   */
  static async getDashboard(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const today = new Date().toISOString().slice(0, 10);
      const summary = await FacultyModel.getDashboardSummary(teacherId, today);
      res.json({ success: true, data: summary });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves list of active attendance registers for teacher.
   * @route GET /api/v1/faculty/registers (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisters() (models/facultyModel.js)
   */
  static async getRegisters(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const rows = await FacultyModel.getRegisters(teacherId);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves roster of unique students taught across all classes of this teacher.
   * @route GET /api/v1/faculty/my-students (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getMyStudents() (models/facultyModel.js)
   */
  static async getMyStudents(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const students = await FacultyModel.getMyStudents(teacherId);
      res.json({ success: true, data: students, total: students.length });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves full 31-day attendance register grid, calendar holidays, scheduled tests, and student records.
   * @route GET /api/v1/faculty/registers/:id (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.findTodaySession() (models/facultyModel.js)
   * @usesModel FacultyModel.autoCreateTodaySession() (models/facultyModel.js)
   * @usesModel FacultyModel.getRegisterSessions() (models/facultyModel.js)
   * @usesModel FacultyModel.getDistinctMonths() (models/facultyModel.js)
   * @usesModel FacultyModel.getExamsForMonth() (models/facultyModel.js)
   * @usesModel FacultyModel.getAssignmentsForMonth() (models/facultyModel.js)
   * @usesModel FacultyModel.getRegisterStudents() (models/facultyModel.js)
   * @usesModel FacultyModel.getAttendanceThreshold() (models/facultyModel.js)
   * @usesModel FacultyModel.getAttendanceRowsForRegister() (models/facultyModel.js)
   */
  static async getRegisterDetail(req, res) {
    const registerId = req.params.id;
    const teacherId = req.user.teacher_id;

    try {
      const register = await FacultyModel.getRegisterById(registerId);
      if (!register) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
      }

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === register.department_id;
      if (teacherId && register.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this register' } });
      }

      const today = new Date().toISOString().slice(0, 10);
      const existingToday = await FacultyModel.findTodaySession(registerId, today);
      if (!existingToday && register.is_active) {
        await FacultyModel.autoCreateTodaySession(register, today);
      }

      const sessions = await FacultyModel.getRegisterSessions(registerId);
      const distinctMonths = await FacultyModel.getDistinctMonths(registerId);
      const availableMonths = Array.from(new Set([
        ...distinctMonths,
        new Date().toISOString().slice(0, 7)
      ])).filter(Boolean).sort();

      const targetMonth = req.query.month || (sessions[0]?.session_date ? sessions[0].session_date.slice(0, 7) : new Date().toISOString().slice(0, 7));
      const [tYear, tMonth] = targetMonth.split('-').map(Number);
      const daysInMonth = new Date(tYear, tMonth, 0).getDate();
      const monthDays = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = String(d).padStart(2, '0');
        const dateStr = `${targetMonth}-${dayStr}`;
        const dt = new Date(tYear, tMonth - 1, d);
        const dayOfWeek = dt.getDay();
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
        const isSunday = dayOfWeek === 0;
        const isSecondSaturday = dayOfWeek === 6 && d >= 8 && d <= 14;
        const mmdd = `${String(tMonth).padStart(2, '0')}-${dayStr}`;
        const holiday = STANDARD_HOLIDAYS[mmdd] || null;

        let nonInstructionalLabel = null;
        if (isSunday) nonInstructionalLabel = 'SUNDAY';
        else if (isSecondSaturday) nonInstructionalLabel = 'SECOND SATURDAY';
        else if (holiday) nonInstructionalLabel = holiday;

        monthDays.push({
          day: d,
          date: dateStr,
          day_name: dayName,
          day_of_week: dayOfWeek,
          is_sunday: isSunday,
          is_second_saturday: isSecondSaturday,
          is_holiday: Boolean(nonInstructionalLabel),
          holiday_label: nonInstructionalLabel,
          event_label: null
        });
      }

      const monthExams = await FacultyModel.getExamsForMonth(register, targetMonth);
      const monthAssignments = await FacultyModel.getAssignmentsForMonth(register, targetMonth);
      const academicEvents = [];

      for (const ex of monthExams) {
        const dayObj = monthDays.find(d => d.date === ex.exam_date);
        const label = ex.name.toUpperCase().includes('TEST') || ex.name.toUpperCase().includes('EXAM') ? ex.name.toUpperCase() : `TEST: ${ex.name.toUpperCase()}`;
        if (dayObj) {
          dayObj.event_label = label;
          dayObj.exam_id = ex.id;
        }
        academicEvents.push({ id: ex.id, type: 'EXAM', title: label, date: ex.exam_date, max_marks: ex.max_marks });
      }

      for (const asg of monthAssignments) {
        const asgDate = (asg.due_date || '').slice(0, 10);
        const dayObj = monthDays.find(d => d.date === asgDate);
        const label = asg.title.toUpperCase();
        if (dayObj) {
          dayObj.event_label = dayObj.event_label ? `${dayObj.event_label} / ASSIGNMENT` : label;
          dayObj.assignment_id = asg.id;
        }
        academicEvents.push({ id: asg.id, type: 'ASSIGNMENT', title: label, date: asgDate, max_marks: asg.max_marks });
      }

      const allFinalizedSessions = sessions.filter(s => s.state === 'FINALIZED');
      const monthFinalizedSessions = allFinalizedSessions.filter(s => s.session_date.startsWith(targetMonth));
      const prevFinalizedSessions = allFinalizedSessions.filter(s => s.session_date < `${targetMonth}-01`);

      let gridData = [];
      const dailyTotals = {};

      if (register.group_id || register.department_id) {
        const students = await FacultyModel.getRegisterStudents(register);
        const threshold = await FacultyModel.getAttendanceThreshold();
        const attendanceRows = await FacultyModel.getAttendanceRowsForRegister(registerId);

        const studentAttMap = new Map();
        const studentSessionMarks = new Map();
        for (const row of attendanceRows) {
          if (!studentAttMap.has(row.student_id)) {
            studentAttMap.set(row.student_id, new Map());
            studentSessionMarks.set(row.student_id, new Map());
          }
          studentSessionMarks.get(row.student_id).set(row.session_id, row.attendance_status);
          studentAttMap.get(row.student_id).set(row.session_date, row.attendance_status);
          studentAttMap.get(row.student_id).set(`${row.session_date}_p${row.period_number || 1}`, row.attendance_status);
        }

        for (const st of students) {
          const marks = {};
          const sessionMarks = {};
          const sessMap = studentSessionMarks.get(st.student_id) || new Map();
          const datesMap = studentAttMap.get(st.student_id) || new Map();

          let monthAtt = 0, monthAbs = 0;
          for (const sess of monthFinalizedSessions) {
            const status = sessMap.get(sess.id) || datesMap.get(`${sess.session_date}_p${sess.period_number || 1}`) || datesMap.get(sess.session_date);
            if (status) {
              sessionMarks[sess.id] = status;
              marks[`${sess.session_date}_p${sess.period_number || 1}`] = status;
              marks[sess.session_date] = status;
              if (status === 'PRESENT' || status === 'LATE') monthAtt++;
              else if (status === 'ABSENT') monthAbs++;
            }
          }

          let prevAtt = 0, prevAbs = 0;
          for (const sess of prevFinalizedSessions) {
            const status = sessMap.get(sess.id) || datesMap.get(`${sess.session_date}_p${sess.period_number || 1}`) || datesMap.get(sess.session_date);
            if (status === 'PRESENT' || status === 'LATE') prevAtt++;
            else if (status === 'ABSENT') prevAbs++;
          }

          const totalAtt = prevAtt + monthAtt;
          const totalAbs = prevAbs + monthAbs;
          const totalSess = totalAtt + totalAbs;
          const pct = totalSess > 0 ? parseFloat(((totalAtt / totalSess) * 100).toFixed(1)) : 100;

          gridData.push({
            student_id: st.student_id,
            class_roll_no: st.class_roll_no,
            registration_no: st.registration_no,
            full_name: st.full_name,
            official_enrollment_no: st.official_enrollment_no,
            enrollment_status: st.enrollment_status,
            attendance_marks: marks,
            session_marks: sessionMarks,
            month_attended: monthAtt,
            month_absent: monthAbs,
            prev_attended: prevAtt,
            prev_absent: prevAbs,
            total_attended: totalAtt,
            total_absent: totalAbs,
            total_sessions: totalSess,
            percentage: pct,
            is_defaulter: pct < threshold && totalSess > 0,
            below_threshold: pct < threshold && totalSess > 0
          });
        }

        for (const d of monthDays) {
          let pres = 0, abs = 0, hasData = false;
          const daySessions = monthFinalizedSessions.filter(s => s.session_date === d.date);
          for (const st of gridData) {
            if (daySessions.length > 0) {
              for (const ds of daySessions) {
                const sm = st.session_marks ? st.session_marks[ds.id] : null;
                if (sm === 'PRESENT' || sm === 'LATE') { pres++; hasData = true; }
                else if (sm === 'ABSENT') { abs++; hasData = true; }
              }
            } else {
              const m = st.attendance_marks[d.date];
              if (m === 'PRESENT' || m === 'LATE') { pres++; hasData = true; }
              else if (m === 'ABSENT') { abs++; hasData = true; }
            }
          }
          dailyTotals[d.date] = hasData ? { present: pres, absent: abs } : null;
        }
      }

      res.json({ success: true, data: {
        register,
        sessions,
        grid: {
          dates: allFinalizedSessions.map(s => s.session_date),
          finalized_sessions: monthFinalizedSessions.map(s => ({
            id: s.id,
            session_date: s.session_date,
            day: parseInt(s.session_date.slice(8, 10), 10),
            period_number: s.period_number || 1,
            label: s.label || `Period ${s.period_number || 1}`,
            session_type: s.session_type,
            state: s.state
          })),
          students: gridData,
          month: targetMonth,
          available_months: availableMonths,
          month_days: monthDays,
          daily_totals: dailyTotals,
          academic_events: academicEvents
        }
      }});
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Fast Digital Pen direct cell mark/clear on the monthly attendance matrix.
   * @route PUT /api/v1/faculty/registers/:id/mark-cell (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.findOrCreateMarkSession() (models/facultyModel.js)
   * @usesModel FacultyModel.markCellAttendance() (models/facultyModel.js)
   */
  static async markCell(req, res) {
    const registerId = req.params.id;
    const { date, student_id, status } = req.body;
    const teacherId = req.user.teacher_id;

    try {
      const reg = await FacultyModel.getRegisterById(registerId);
      if (!reg) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === reg.department_id;
      if (teacherId && reg.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }

      const periodNumber = parseInt(req.body.period_number) || 1;
      const sess = await FacultyModel.findOrCreateMarkSession({ registerId, date, periodNumber, reg });
      const counts = await FacultyModel.markCellAttendance({ sessionId: sess.id, studentId: student_id, status, userId: req.user.id });

      res.json({
        success: true,
        data: {
          date,
          student_id,
          status: status === 'CLEAR' ? null : status,
          daily_totals: counts
        },
        message: 'Attendance mark updated'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates student enrollment standing within register (ENROLLED, TRANSFERRED, DROPPED).
   * @route PUT /api/v1/faculty/registers/:id/student-status (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.updateStudentEnrollmentStatus() (models/facultyModel.js)
   */
  static async updateStudentStatus(req, res) {
    const registerId = req.params.id;
    const { student_id, status } = req.body;
    const teacherId = req.user.teacher_id;

    try {
      const reg = await FacultyModel.getRegisterById(registerId);
      if (!reg) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === reg.department_id;
      if (teacherId && reg.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }

      await FacultyModel.updateStudentEnrollmentStatus(student_id, reg, status);
      res.json({ success: true, message: `Student status updated to ${status}` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Creates a personal custom register for teacher.
   * @route POST /api/v1/faculty/registers (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.createPersonalRegister() (models/facultyModel.js)
   */
  static async createPersonalRegister(req, res) {
    const { name, subject_id, department_id, year, semester, academic_year_id, session_type_scope } = req.body;
    const teacherId = req.user.teacher_id;

    if (!teacherId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only faculty accounts can create personal registers' } });
    }

    try {
      const ayId = academic_year_id || 1;
      const regId = await FacultyModel.createPersonalRegister({
        name: name.trim(),
        teacherId,
        subjectId: subject_id,
        departmentId: department_id,
        year,
        semester,
        ayId,
        sessionTypeScope: session_type_scope
      });

      res.status(201).json({ success: true, data: { register_id: regId, name: name.trim() }, message: 'Personal register created' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Manually creates a new attendance session under a register.
   * @route POST /api/v1/faculty/registers/:id/sessions (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.createSessionManual() (models/facultyModel.js)
   */
  static async createSession(req, res) {
    const registerId = req.params.id;
    const { session_date, period_number, session_type, label, start_time, end_time } = req.body;
    const teacherId = req.user.teacher_id;

    try {
      const reg = await FacultyModel.getRegisterById(registerId);
      if (!reg) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === reg.department_id;
      if (teacherId && reg.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }

      const newSessionId = await FacultyModel.createSessionManual({
        registerId,
        reg,
        periodNumber: period_number,
        sessionType: session_type,
        label,
        sessionDate: session_date,
        startTime: start_time,
        endTime: end_time
      });

      res.status(201).json({ success: true, data: { session_id: newSessionId, session_date, state: 'DRAFT' } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves cohorts assigned to the teacher.
   * @route GET /api/v1/faculty/cohorts (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getTeacherCohorts() (models/facultyModel.js)
   */
  static async getCohorts(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const cohorts = await FacultyModel.getTeacherCohorts(teacherId);
      res.json({ success: true, data: cohorts });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves subjects assigned to the teacher.
   * @route GET /api/v1/faculty/subjects (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getTeacherSubjects() (models/facultyModel.js)
   */
  static async getSubjects(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const subjects = await FacultyModel.getTeacherSubjects(teacherId);
      res.json({ success: true, data: subjects });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves enrolled students in a cohort.
   * @route GET /api/v1/faculty/cohorts/students (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getCohortStudents() (models/facultyModel.js)
   */
  static async getCohortStudents(req, res) {
    const { department_id, branch_id, year, semester, academic_year_id } = req.query;
    const effDeptId = department_id || branch_id;
    if (!effDeptId || !year || !semester) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' } });
    }
    try {
      const ayId = academic_year_id || 1;
      const students = await FacultyModel.getCohortStudents(effDeptId, year, semester, ayId);
      res.json({ success: true, data: students });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves biometric registration status for cohort students.
   * @route GET /api/v1/faculty/cohorts/biometrics (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesService deviceService.getCohortBiometrics() (services/deviceService.js)
   */
  static async getCohortBiometrics(req, res) {
    const { department_id, branch_id, year, semester, academic_year_id } = req.query;
    const effDeptId = department_id || branch_id;
    if (!effDeptId || !year || !semester) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' } });
    }
    try {
      const ayId = academic_year_id || 1;
      const result = await deviceService.getCohortBiometrics(effDeptId, effDeptId, year, semester, ayId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Toggles student self-registration gate on/off for department or specific cohort.
   * @route POST /api/v1/faculty/cohorts/registration-toggle (routes/faculty.js)
   * @access TEACHER (Department Faculty)
   * @usesModel FacultyModel.setSystemSetting() (models/facultyModel.js)
   */
  static async toggleCohortRegistration(req, res) {
    const { department_id, branch_id, year, semester, registration_open, open, department_wide, all_cohorts } = req.body;
    const effDeptId = department_id || branch_id;
    const isOpen = open !== undefined ? Boolean(open) : (registration_open !== undefined ? Boolean(registration_open) : true);

    if (!effDeptId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id is required' } });
    }

    try {
      const isDeptWide = Boolean(department_wide || all_cohorts);
      if (isDeptWide) {
        const branchKey = `cohort_reg_dept_${effDeptId}`;
        await FacultyModel.setSystemSetting(branchKey, isOpen ? '1' : '0');
        return res.json({
          success: true,
          message: `Registration has been ${isOpen ? 'opened' : 'closed'} across all cohorts for department ID ${effDeptId}.`,
          data: { department_id: effDeptId, department_wide: true, is_open: isOpen }
        });
      }

      if (!year || !semester) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'year and semester are required when department_wide is not specified' }
        });
      }

      const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${year}_${semester}_1`;
      await FacultyModel.setSystemSetting(cohortKey, isOpen ? '1' : '0');

      res.json({
        success: true,
        message: `Registration has been ${isOpen ? 'opened' : 'closed'} for Semester ${semester}.`,
        data: { department_id: effDeptId, year, semester, is_open: isOpen }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Checks current self-registration gate status for a department or cohort.
   * @route GET /api/v1/faculty/cohorts/registration-status (routes/faculty.js)
   * @access TEACHER (Department Faculty)
   * @usesModel FacultyModel.getSystemSetting() (models/facultyModel.js)
   */
  static async getCohortRegistrationStatus(req, res) {
    const { department_id, branch_id, year, semester } = req.query;
    const effDeptId = department_id || branch_id;
    if (!effDeptId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id is required' } });
    }

    try {
      const branchKey = `cohort_reg_dept_${effDeptId}`;
      const branchSetting = await FacultyModel.getSystemSetting(branchKey);
      const isBranchOpen = branchSetting === '1';

      let isCohortOpen = false;
      if (year && semester) {
        const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${year}_${semester}_1`;
        const cohortSetting = await FacultyModel.getSystemSetting(cohortKey);
        isCohortOpen = cohortSetting === '1';
      }

      const effectiveOpen = isBranchOpen || isCohortOpen;
      res.json({
        success: true,
        data: {
          department_id: effDeptId,
          year: year ? Number(year) : null,
          semester: semester ? Number(semester) : null,
          is_open: effectiveOpen,
          branch_wide_open: isBranchOpen,
          cohort_specific_open: isCohortOpen
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves faculty personal profile, assigned subjects, and active registers.
   * @route GET /api/v1/faculty/profile (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getFacultyProfile() (models/facultyModel.js)
   */
  static async getProfile(req, res) {
    try {
      const data = await FacultyModel.getFacultyProfile(req.user.id, req.user.teacher_id);
      if (!data) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });

      res.json({
        success: true,
        data: {
          ...data.profile,
          roles: req.user.roles || ['TEACHER'],
          is_hod: Boolean(req.user.is_hod),
          is_class_teacher: Boolean(req.user.is_class_teacher),
          hod_department_name: req.user.hod_department_name || null,
          assignments: data.assignments,
          registers: data.registers
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates faculty personal details (name, phone, email, password).
   * @route PUT /api/v1/faculty/profile (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   */
  static async updateProfile(req, res) {
    const { full_name, phone, email, current_password, new_password } = req.body;
    const { query } = require('../config/db');

    try {
      if (full_name !== undefined || phone !== undefined) {
        const sets = [], params = [];
        if (full_name) { sets.push('full_name = ?'); params.push(full_name); }
        if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
        params.push(req.user.teacher_id);
        if (sets.length && req.user.teacher_id) {
          await query(`UPDATE teachers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
        }
      }

      if (email !== undefined) {
        const userRow = (await query(`SELECT email FROM users WHERE id = ?`, [req.user.id]))[0];
        if (email.toLowerCase() !== userRow?.email?.toLowerCase()) {
          await query(
            `UPDATE users SET email = ?, google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [email.toLowerCase(), req.user.id]
          );
        }
      }

      if (new_password) {
        if (!current_password) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'current_password required to set new password' } });
        const userRow = (await query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]))[0];
        const match = await bcrypt.compare(current_password, userRow?.password_hash || '');
        if (!match) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
        const newHash = await bcrypt.hash(new_password, 12);
        await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newHash, req.user.id]);
      }

      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves active subject teaching assignments for faculty.
   * @route GET /api/v1/faculty/my-classes (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getMyClasses() (models/facultyModel.js)
   */
  static async getMyClasses(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const rows = await FacultyModel.getMyClasses(teacherId);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves consolidated internal evaluation mark sheet for register.
   * @route GET /api/v1/faculty/registers/:id/internal-evaluation (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.getInternalEvaluationData() (models/facultyModel.js)
   */
  static async getInternalEvaluation(req, res) {
    const registerId = req.params.id;
    const teacherId = req.user.teacher_id;

    try {
      const register = await FacultyModel.getRegisterById(registerId);
      if (!register) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === register.department_id;
      if (teacherId && register.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this register' } });
      }

      const evalData = await FacultyModel.getInternalEvaluationData(registerId, register);
      res.json({
        success: true,
        data: {
          register,
          institution_name: evalData.institution_name,
          assignments: evalData.assignments,
          exams: evalData.exams,
          roster: evalData.roster
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates and downloads official internal evaluation Excel file.
   * @route GET /api/v1/faculty/registers/:id/export/internal-evaluation-excel (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesModel FacultyModel.getInternalEvaluationData() (models/facultyModel.js)
   * @usesService excelExportService.generateInternalEvaluationExcel() (services/excelExportService.js)
   */
  static async exportInternalEvaluationExcel(req, res) {
    const registerId = req.params.id;
    try {
      const register = await FacultyModel.getRegisterById(registerId);
      if (!register) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

      const exportPayload = await FacultyModel.getInternalEvaluationData(registerId, register);
      const buffer = await excelExportService.generateInternalEvaluationExcel(exportPayload);

      const safeSubj = (register.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Internal_Evaluation_${safeSubj}_Semester_${register.semester}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates and downloads customized internal evaluation Excel file based on client custom payload.
   * @route POST /api/v1/faculty/registers/:id/export/internal-evaluation-excel (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesService excelExportService.generateInternalEvaluationExcel() (services/excelExportService.js)
   */
  static async exportInternalEvaluationExcelCustom(req, res) {
    const registerId = req.params.id;
    try {
      const register = (await FacultyModel.getRegisterById(registerId)) || {};
      const customData = req.body || {};
      const { query } = require('../config/db');

      const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
      const institutionName = setRows[0]?.setting_value || 'Government Polytechnic Nainital';
      const currentAyRow = (await query(`SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];
      const sessionLabelFromTable = currentAyRow?.label || register.academic_year_label || '2026-27 (Odd Semester)';

      const exportPayload = {
        institution_name: customData.institution_name || institutionName,
        session_label: customData.session_label || `Internal Evaluation Sheet ${sessionLabelFromTable}`,
        dept_semester_text: customData.dept_semester_text || null,
        academic_session: sessionLabelFromTable,
        department_name: customData.department_name || register.department_name,
        department_code: customData.department_code || register.department_code,
        subject_name: customData.subject_name || register.subject_name,
        semester: customData.semester || register.semester || 3,
        assignments: customData.assignments || [],
        exams: customData.exams || [],
        custom_columns: customData.custom_columns || [],
        marks_scheme: customData.marks_scheme || customData.scheme || {},
        roster: customData.roster || customData.students || []
      };

      const buffer = await excelExportService.generateInternalEvaluationExcel(exportPayload);
      const safeSubj = (exportPayload.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Internal_Evaluation_${safeSubj}_Custom.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates and downloads multi-unit test summary sheet Excel file.
   * @route POST /api/v1/faculty/registers/:id/export/unit-tests-summary-excel (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel FacultyModel.getRegisterById() (models/facultyModel.js)
   * @usesService excelExportService.generateUnitTestsSummaryExcel() (services/excelExportService.js)
   */
  static async exportUnitTestsSummaryExcel(req, res) {
    const registerId = req.params.id;
    try {
      const register = (await FacultyModel.getRegisterById(registerId)) || {};
      const customData = req.body || {};
      const { query } = require('../config/db');

      const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
      const institutionName = setRows[0]?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Srinagar Garhwal';

      const exportPayload = {
        institution_name: customData.institution_name || institutionName,
        session_label: customData.session_label || `Internal Evaluation Sheet ${register.academic_year_label || '2026 Session'}`,
        department_name: customData.department_name || register.department_name,
        department_code: customData.department_code || register.department_code,
        subject_name: customData.subject_name || register.subject_name,
        year: customData.year || register.year || 3,
        semester: customData.semester || register.semester || 5,
        target_avg_max: customData.target_avg_max || 20,
        exams: customData.exams || [],
        roster: customData.roster || []
      };

      const buffer = await excelExportService.generateUnitTestsSummaryExcel(exportPayload);
      const safeSubj = (exportPayload.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Unit_Test_Summary_${safeSubj}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves pending common faculty registration requests for review.
   * @route GET /api/v1/faculty/common/pending (routes/faculty.js)
   * @access Common Faculty Manager
   * @usesModel FacultyModel.getCommonPendingRequests() (models/facultyModel.js)
   */
  static async getCommonPending(req, res) {
    try {
      const rows = await FacultyModel.getCommonPendingRequests();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Approves common faculty registration request.
   * @route POST /api/v1/faculty/common/:id/approve (routes/faculty.js)
   * @access Common Faculty Manager
   * @usesModel FacultyModel.approveCommonFacultyRequest() (models/facultyModel.js)
   */
  static async approveCommon(req, res) {
    const reqId = Number(req.params.id);
    try {
      const result = await FacultyModel.approveCommonFacultyRequest(reqId, req.user.id);
      if (!result) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending common faculty registration request not found' } });
      }

      res.status(200).json({
        success: true,
        message: `Common faculty registration for ${result.full_name} has been approved successfully.`,
        data: {
          request_id: reqId,
          user_id: result.user_id,
          teacher_id: result.teacher_id,
          department_id: null,
          status: 'APPROVED'
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Rejects common faculty registration request with recorded reason.
   * @route POST /api/v1/faculty/common/:id/reject (routes/faculty.js)
   * @access Common Faculty Manager
   * @usesModel FacultyModel.rejectCommonFacultyRequest() (models/facultyModel.js)
   */
  static async rejectCommon(req, res) {
    const reqId = Number(req.params.id);
    const { reason } = req.body;
    try {
      const success = await FacultyModel.rejectCommonFacultyRequest(reqId, req.user.id, reason);
      if (!success) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending common faculty registration request not found' } });
      }
      res.json({ success: true, message: 'Common faculty registration request rejected.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves active common faculty members across the institution.
   * @route GET /api/v1/faculty/common/members (routes/faculty.js)
   * @access Common Faculty Manager
   * @usesModel FacultyModel.getCommonFacultyMembers() (models/facultyModel.js)
   */
  static async getCommonMembers(req, res) {
    try {
      const rows = await FacultyModel.getCommonFacultyMembers();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates a genuine, styled ExcelJS (.xlsx) binary workbook from client structured table rows.
   * @route POST /api/v1/faculty/export/table-to-excel (routes/faculty.js)
   * @access TEACHER, SYSTEM_ADMIN
   */
  static async exportTableToExcel(req, res) {
    try {
      const { title, sheet_name, rows } = req.body || {};
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VidyaOS Institutional Campus OS';
      wb.created = new Date();

      const wsName = (sheet_name || title || 'Evaluation').replace(/[*?:/\\\[\]]/g, ' ').trim().substring(0, 31) || 'Sheet1';
      const ws = wb.addWorksheet(wsName, {
        views: [{ showGridLines: true }],
        pageSetup: { orientation: 'landscape', fitToPage: true }
      });

      const borderThin = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } }
      };

      const matrix = [];
      let maxCols = 1;

      (rows || []).forEach((rowCells, rIdx) => {
        const excelRowIdx = rIdx + 1;
        if (!matrix[excelRowIdx]) matrix[excelRowIdx] = [];
        let excelColIdx = 1;

        (rowCells || []).forEach(cell => {
          while (matrix[excelRowIdx][excelColIdx]) {
            excelColIdx++;
          }

          const rowspan = cell.rowspan || 1;
          const colspan = cell.colspan || 1;
          const text = cell.text !== undefined ? String(cell.text).trim() : '';

          let val = text;
          if (!cell.is_header && text !== '' && !isNaN(text) && !text.includes('/') && !text.includes('-') && !text.startsWith('0')) {
            const num = Number(text);
            if (!isNaN(num)) val = num;
          }

          const excelCell = ws.getCell(excelRowIdx, excelColIdx);
          excelCell.value = val;
          excelCell.border = borderThin;

          if (cell.is_blue) {
            excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
            excelCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0369A1' } };
            excelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          } else if (cell.is_tan) {
            excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C7' } };
            excelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF92400E' } };
            excelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          } else if (cell.is_sub) {
            excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            excelCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF334155' } };
            excelCell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (cell.is_summary) {
            excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            excelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
            excelCell.alignment = { horizontal: cell.is_label ? 'right' : 'center', vertical: 'middle' };
          } else if (cell.is_absent || text === 'AB' || text === 'A') {
            excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            excelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
            excelCell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            excelCell.font = { name: 'Calibri', size: 10, bold: Boolean(cell.is_name || cell.is_header) };
            excelCell.alignment = { horizontal: cell.is_name ? 'left' : 'center', vertical: 'middle' };
          }

          if (rowspan > 1 || colspan > 1) {
            const endRow = excelRowIdx + rowspan - 1;
            const endCol = excelColIdx + colspan - 1;
            ws.mergeCells(excelRowIdx, excelColIdx, endRow, endCol);

            for (let r = excelRowIdx; r <= endRow; r++) {
              if (!matrix[r]) matrix[r] = [];
              for (let c = excelColIdx; c <= endCol; c++) {
                matrix[r][c] = true;
              }
            }
          } else {
            matrix[excelRowIdx][excelColIdx] = true;
          }

          excelColIdx += colspan;
          if (excelColIdx > maxCols) maxCols = excelColIdx;
        });

        const isFirst = rIdx === 0;
        ws.getRow(excelRowIdx).height = isFirst ? 28 : (rowCells.some(c => c.is_header) ? 22 : 19);
      });

      for (let c = 1; c <= maxCols; c++) {
        const col = ws.getColumn(c);
        let maxLen = 8;
        col.eachCell({ includeEmpty: false }, cell => {
          const v = cell.value ? String(cell.value) : '';
          if (v.length > maxLen && v.length < 50) maxLen = v.length;
        });
        col.width = Math.max(9, Math.min(maxLen + 3, 35));
      }

      const buffer = await wb.xlsx.writeBuffer();
      const safeFilename = (title || 'Spreadsheet').replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.xlsx"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      console.error('Table to Excel export error:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }
}

module.exports = FacultyController;
