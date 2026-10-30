/**
 * Attendance Core Service
 * Manages session state machine, roster freezing, the 3 attendance streams, and auto-close timer.
 * Sessions now belong to an attendance_register (the semester-long digital register book).
 */

const { query, withTransaction } = require('../config/db');
const { generatePin, generateQrPayload } = require('../utils/pinQrHelper');
const logger = require('../utils/logger');

class AttendanceService {
  /**
   * Create Attendance Session (State: DRAFT) within a register
   * Freezes cohort roster snapshot into attendance_session_students.
   */
  async createSession(data, teacherId) {
    const {
      register_id,
      subject_id,
      department_id,
      branch_id,
      year,
      semester,
      academic_year_id,
      session_type = 'THEORY',
      label = 'Classroom Lecture',
      session_date = new Date().toISOString().slice(0, 10),
      auto_close_minutes = null
    } = data;

    if (!register_id) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'register_id is required. Sessions must belong to an attendance register.' };
    }

    const autoCloseAt = auto_close_minutes
      ? new Date(Date.now() + auto_close_minutes * 60 * 1000).toISOString()
      : null;

    return await withTransaction(async (conn) => {
      // 1. Insert Session linked to register
      const [res] = await conn.execute(
        `INSERT INTO attendance_sessions 
         (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, 
          session_type, label, session_date, state, auto_close_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
        [register_id, teacherId, subject_id, department_id, year, semester, academic_year_id,
         session_type, label, session_date, autoCloseAt]
      );

      const sessionId = res.insertId ?? res.lastInsertRowid;

      // Check if register is linked to a teaching group
      const [regRows] = await conn.execute(
        `SELECT group_id FROM attendance_registers WHERE id = ?`,
        [register_id]
      );
      const groupId = regRows && regRows.length > 0 ? regRows[0].group_id : null;

      let enrolledStudents = [];
      if (groupId) {
        // 2a. Freeze Teaching Group Roster Snapshot (supports multi-department cohorts)
        const [groupStudents] = await conn.execute(
          `SELECT tgm.student_id, COALESCE(s.class_roll_no, e.class_roll_no, 0) as class_roll_no, e.id as enrollment_id
           FROM teaching_group_members tgm
           JOIN students s ON tgm.student_id = s.id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           WHERE tgm.group_id = ? AND tgm.status = 'ENROLLED'
           ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 9999) ASC`,
          [groupId]
        );
        enrolledStudents = groupStudents;
      }

      if (!enrolledStudents || enrolledStudents.length === 0) {
        // 2b. Fallback to Department Cohort Enrollment
        const [deptStudents] = await conn.execute(
          `SELECT e.id as enrollment_id, e.student_id, e.class_roll_no 
           FROM enrollments e
           WHERE e.department_id = ? 
             AND e.year = ? 
             AND e.semester = ? 
             AND e.academic_year_id = ? 
             AND e.status = 'ENROLLED'
           ORDER BY e.class_roll_no ASC`,
          [department_id, year, semester, academic_year_id]
        );
        enrolledStudents = deptStudents;
      }

      if (enrolledStudents.length > 0) {
        for (const s of enrolledStudents) {
          try {
            await conn.execute(
              `INSERT OR IGNORE INTO attendance_session_students 
               (session_id, student_id, enrollment_id, class_roll_no, included)
               VALUES (?, ?, ?, ?, 1)`,
              [sessionId, s.student_id, s.enrollment_id, s.class_roll_no]
            );
          } catch { /* skip on conflict */ }
        }
      }

      logger.info('Attendance session created with frozen roster snapshot', {
        sessionId, registerId: register_id, enrolledCount: enrolledStudents.length
      });

      return {
        id: sessionId,
        register_id,
        teacher_id: teacherId,
        subject_id,
        state: 'DRAFT',
        session_date,
        auto_close_at: autoCloseAt,
        enrolled_student_count: enrolledStudents.length
      };
    });
  }

  /**
   * Transition Session State
   * Validates state machine: DRAFT -> OPEN -> CLOSED -> FINALIZED
   * Enforces Universal Marking Invariant before transitioning to FINALIZED.
   */
  async transitionState(sessionId, newState, teacherId) {
    const validStates = ['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED'];
    if (!validStates.includes(newState)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: `Invalid state: ${newState}` };
    }

    const sessions = await query(`SELECT * FROM attendance_sessions WHERE id = ?`, [sessionId]);
    if (!sessions || sessions.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Attendance session not found' };
    }

    const current = sessions[0];

    // State machine check
    if (current.state === 'FINALIZED') {
      throw { status: 400, code: 'CONFLICT', message: 'Finalized session is locked and immutable' };
    }

    // Universal Marking Check for FINALIZED transition
    if (newState === 'FINALIZED') {
      const roster = await query(
        `SELECT student_id, class_roll_no 
         FROM attendance_session_students 
         WHERE session_id = ? AND included = TRUE`,
        [sessionId]
      );

      const marked = await query(
        `SELECT student_id, attendance_status 
         FROM register_attendance 
         WHERE session_id = ?`,
        [sessionId]
      );

      const markedMap = new Map();
      marked.forEach(m => markedMap.set(m.student_id, m.attendance_status));

      const unmarked = [];
      for (const student of roster) {
        const status = markedMap.get(student.student_id);
        if (!status || !['PRESENT', 'ABSENT', 'LATE'].includes(status)) {
          unmarked.push(student.class_roll_no);
        }
      }

      if (unmarked.length > 0) {
        throw {
          status: 422,
          code: 'UNPROCESSABLE_ENTITY',
          message: `Universal marking invariant failed: ${unmarked.length} student(s) remain unmarked. ` +
                   `Every included student must have status PRESENT, ABSENT, or LATE before finalization.`,
          details: { unmarked_roll_numbers: unmarked }
        };
      }
    }

    await query(
      `UPDATE attendance_sessions 
       SET state = ?, 
           end_time = CASE WHEN ? IN ('CLOSED', 'FINALIZED') AND end_time IS NULL THEN NOW() ELSE end_time END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newState, newState, sessionId]
    );

    return {
      session_id: sessionId,
      previous_state: current.state,
      state: newState
    };
  }

  /**
   * Generate 6-Digit Verification PIN for Session
   */
  async generatePin(sessionId) {
    const pin = generatePin();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await query(
      `UPDATE attendance_sessions 
       SET verification_pin = ?, verification_expires_at = ? 
       WHERE id = ?`,
      [pin, expiresAt, sessionId]
    );

    return { pin, expires_at: expiresAt };
  }

  /**
   * Generate Dynamic QR Code Token for Session
   */
  async generateQr(sessionId) {
    const { tokenHash, expiresAt, qrPayload } = generateQrPayload(sessionId, 15);

    await query(
      `UPDATE attendance_sessions 
       SET verification_qr_hash = ?, verification_expires_at = ? 
       WHERE id = ?`,
      [tokenHash, expiresAt, sessionId]
    );

    return { token_hash: tokenHash, expires_at: expiresAt, payload: qrPayload };
  }

  /**
   * Student Submit Soft Self-Attendance Claim (Button / PIN / QR)
   */
  async submitSelfAttendance(sessionId, studentId, { method = 'PIN', pin, qr_token } = {}) {
    // 1. Session must be OPEN
    const sessions = await query(`SELECT state FROM attendance_sessions WHERE id = ?`, [sessionId]);
    if (!sessions || sessions.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Session not found' };
    }
    if (sessions[0].state !== 'OPEN') {
      throw { status: 400, code: 'CONFLICT', message: `Session is ${sessions[0].state}. Attendance submission closed.` };
    }

    // 2. Student must be included in roster snapshot
    const roster = await query(
      `SELECT included FROM attendance_session_students WHERE session_id = ? AND student_id = ?`,
      [sessionId, studentId]
    );
    if (!roster || roster.length === 0 || !roster[0].included) {
      throw { status: 403, code: 'FORBIDDEN', message: 'You are not enrolled or included in this session roster' };
    }

    // 3. Verify Challenge based on method
    if (method === 'PIN') {
      if (!pin) throw { status: 400, code: 'VALIDATION_ERROR', message: 'PIN code is required' };
      const validPins = await query(
        `SELECT id FROM attendance_sessions 
         WHERE id = ? AND verification_pin = ? AND verification_expires_at > NOW()`,
        [sessionId, pin]
      );
      if (!validPins || validPins.length === 0) {
        throw { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid or expired session PIN' };
      }
    } else if (method === 'QR') {
      if (!qr_token) throw { status: 400, code: 'VALIDATION_ERROR', message: 'QR token is required' };
      const validQr = await query(
        `SELECT id FROM attendance_sessions 
         WHERE id = ? AND verification_qr_hash = ? AND verification_expires_at > NOW()`,
        [sessionId, qr_token]
      );
      if (!validQr || validQr.length === 0) {
        throw { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid or expired QR token' };
      }
    }

    // 4. Upsert soft request in student_self_attendance (Stream 3)
    await query(
      `INSERT INTO student_self_attendance (session_id, student_id, verification_method, request_status)
       VALUES (?, ?, ?, 'PENDING')
       ON CONFLICT(session_id, student_id) DO UPDATE SET 
         verification_method = excluded.verification_method,
         request_status = 'PENDING',
         submitted_at = CURRENT_TIMESTAMP`,
      [sessionId, studentId, method]
    );

    return {
      session_id: sessionId,
      student_id: studentId,
      status: 'PENDING',
      message: 'Self-attendance request submitted. Awaiting teacher confirmation.'
    };
  }

  /**
   * Get Pending Self-Attendance Claims for Session
   */
  async getSelfAttendanceRequests(sessionId) {
    return await query(
      `SELECT ssa.id as request_id, ssa.student_id, ssa.verification_method, ssa.request_status, ssa.submitted_at,
              s.official_enrollment_no, s.registration_no, s.full_name, COALESCE(s.class_roll_no, ass.class_roll_no) as class_roll_no
       FROM student_self_attendance ssa
       JOIN students s ON ssa.student_id = s.id
       JOIN attendance_session_students ass ON ass.session_id = ssa.session_id AND ass.student_id = ssa.student_id
       WHERE ssa.session_id = ?
       ORDER BY COALESCE(s.class_roll_no, ass.class_roll_no) ASC`,
      [sessionId]
    );
  }

  /**
   * Adjudicate Student Self-Attendance Claim (Accept / Reject)
   */
  async adjudicateSelfAttendance(sessionId, requestId, action, teacherId) {
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: "Action must be 'ACCEPT' or 'REJECT'" };
    }

    return await withTransaction(async (conn) => {
      const [requests] = await conn.execute(
        `SELECT * FROM student_self_attendance WHERE id = ? AND session_id = ?`,
        [requestId, sessionId]
      );

      if (!requests || requests.length === 0) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Self-attendance request not found' };
      }

      const req = requests[0];
      const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';

      // 1. Update request status in Stream 3
      await conn.execute(
        `UPDATE student_self_attendance 
         SET request_status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [newStatus, teacherId, requestId]
      );

      // 2. If accepted, populate official register in Stream 2
      if (action === 'ACCEPT') {
        await conn.execute(
          `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by)
           VALUES (?, ?, 'PRESENT', 'SELF_REQUEST', ?)
           ON CONFLICT(session_id, student_id) DO UPDATE SET 
             attendance_status = 'PRESENT',
             source = 'SELF_REQUEST',
             marked_by = excluded.marked_by,
             updated_at = CURRENT_TIMESTAMP`,
          [sessionId, req.student_id, teacherId]
        );
      }

      return { request_id: requestId, action: newStatus };
    });
  }

  /**
   * 1-Click Synchronize Raw ESP32 Physical Scans into Official Register
   */
  async syncEsp32Scans(sessionId, teacherId) {
    const sessions = await query(`SELECT * FROM attendance_sessions WHERE id = ?`, [sessionId]);
    if (!sessions || sessions.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Session not found' };
    }

    const session = sessions[0];
    const sessionDate = session.session_date || (session.start_time ? String(session.start_time).slice(0, 10) : new Date().toISOString().slice(0, 10));

    // Find raw scans in iot_attendance_events (fallback to esp32_presence) that correlate with enrolled students in this cohort
    const scans = await query(
      `SELECT DISTINCT student_id FROM (
         SELECT ie.student_id 
         FROM iot_attendance_events ie
         JOIN attendance_session_students ass ON ass.session_id = ? AND ass.student_id = ie.student_id
         WHERE (ie.scan_date = ? OR DATE(ie.scan_time) = ?) AND ass.included = 1
         UNION
         SELECT ep.student_id
         FROM esp32_presence ep
         JOIN attendance_session_students ass ON ass.session_id = ? AND ass.student_id = ep.student_id
         WHERE DATE(ep.scan_time) = ? AND ass.included = 1
       )`,
      [sessionId, sessionDate, sessionDate, sessionId, sessionDate]
    );

    let syncedCount = 0;
    if (scans.length > 0) {
      await withTransaction(async (conn) => {
        for (const scan of scans) {
          await conn.execute(
            `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by)
             VALUES (?, ?, 'PRESENT', 'ESP32_SYNC', ?)
             ON CONFLICT(session_id, student_id) DO UPDATE SET 
               attendance_status = 'PRESENT',
               source = 'ESP32_SYNC',
               marked_by = excluded.marked_by,
               updated_at = CURRENT_TIMESTAMP`,
            [sessionId, scan.student_id, teacherId]
          );
          syncedCount++;
        }
      });
    }

    return {
      session_id: sessionId,
      session_date: sessionDate,
      matched_scans: scans.length,
      synced_records: syncedCount,
      message: `Successfully synchronized ${syncedCount} physical scan(s) from ESP32.`
    };
  }

  /**
   * Bulk Save Official Register Marking (Stream 2)
   */
  async saveRegisterRecords(sessionId, records, teacherId) {
    if (!Array.isArray(records)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Records must be an array' };
    }

    const sessionRows = await query(`SELECT state FROM attendance_sessions WHERE id = ?`, [sessionId]);
    if (!sessionRows || sessionRows.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Attendance session not found' };
    }
    if (sessionRows[0].state === 'FINALIZED') {
      throw {
        status: 400,
        code: 'CONFLICT',
        message: 'Finalized session is locked. Use attendance correction endpoint with a valid reason to modify.'
      };
    }

    await withTransaction(async (conn) => {
      for (const rec of records) {
        if (!['PRESENT', 'ABSENT', 'LATE'].includes(rec.attendance_status)) {
          continue;
        }
        await conn.execute(
          `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, teacher_notes, marked_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, student_id) DO UPDATE SET 
             attendance_status = excluded.attendance_status,
             source = excluded.source,
             teacher_notes = excluded.teacher_notes,
             marked_by = excluded.marked_by,
             updated_at = CURRENT_TIMESTAMP`,
          [sessionId, rec.student_id, rec.attendance_status, rec.source || 'MANUAL', rec.teacher_notes || null, teacherId]
        );
      }
    });

    return { success: true, count: records.length };
  }

  /**
   * Post-Finalization Attendance Correction (redesign.md Section 43)
   * Retains: original value, new value, reason, changed_by, changed_at.
   */
  async correctAttendanceRecord(sessionId, studentId, newStatus, reason, changedByUserId) {
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE'];
    if (!validStatuses.includes(newStatus)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: `Invalid status: ${newStatus}. Must be PRESENT, ABSENT, or LATE.` };
    }
    if (!reason || !reason.trim() || reason.trim().length < 3) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'A descriptive reason (min 3 characters) is required for attendance correction.' };
    }

    const sessions = await query(`SELECT * FROM attendance_sessions WHERE id = ?`, [sessionId]);
    if (!sessions || sessions.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Attendance session not found' };
    }
    const session = sessions[0];
    if (session.state !== 'FINALIZED') {
      throw { status: 400, code: 'CONFLICT', message: `Session is in state '${session.state}'. Corrections can only be recorded on FINALIZED sessions.` };
    }

    const currentRecs = await query(
      `SELECT attendance_status FROM register_attendance WHERE session_id = ? AND student_id = ?`,
      [sessionId, studentId]
    );
    const originalStatus = currentRecs[0]?.attendance_status || 'UNMARKED';

    return await withTransaction(async (conn) => {
      // 1. Insert immutable correction audit record
      const [insRes] = await conn.execute(
        `INSERT INTO attendance_corrections (session_id, student_id, original_status, new_status, reason, changed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, studentId, originalStatus, newStatus, reason.trim(), changedByUserId]
      );
      const correctionId = insRes.insertId ?? insRes.lastInsertRowid;

      // 2. Update register attendance record
      await conn.execute(
        `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, teacher_notes, marked_by)
         VALUES (?, ?, ?, 'CORRECTION', ?, ?)
         ON CONFLICT(session_id, student_id) DO UPDATE SET 
           attendance_status = excluded.attendance_status,
           source = 'CORRECTION',
           teacher_notes = excluded.teacher_notes,
           marked_by = excluded.marked_by,
           updated_at = CURRENT_TIMESTAMP`,
        [sessionId, studentId, newStatus, reason.trim(), changedByUserId]
      );

      // 3. Log into audit_logs
      try {
        await conn.execute(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
           VALUES (?, 'ATTENDANCE_CORRECTED', 'attendance_sessions', ?, ?)`,
          [
            changedByUserId,
            String(sessionId),
            JSON.stringify({
              student_id: studentId,
              original_status: originalStatus,
              new_status: newStatus,
              reason: reason.trim(),
              correction_id: correctionId
            })
          ]
        );
      } catch (_) {}

      return {
        correction_id: correctionId,
        session_id: Number(sessionId),
        student_id: Number(studentId),
        original_status: originalStatus,
        new_status: newStatus,
        reason: reason.trim()
      };
    });
  }

  /**
   * Get Correction History for an Attendance Session
   */
  async getSessionCorrections(sessionId) {
    return await query(
      `SELECT ac.id, ac.session_id, ac.student_id, ac.original_status, ac.new_status, ac.reason,
              ac.changed_by, ac.created_at,
              s.full_name, s.official_enrollment_no, s.registration_no,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
              u.username as changed_by_username
       FROM attendance_corrections ac
       JOIN students s ON ac.student_id = s.id
       LEFT JOIN users u ON ac.changed_by = u.id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE ac.session_id = ?
       ORDER BY ac.created_at DESC`,
      [sessionId]
    );
  }

  /**
   * Auto-Close Scanner (OPEN -> CLOSED only)
   * Automated cron/interval process never transitions to FINALIZED.
   */
  async autoCloseOpenSessions() {
    try {
      const result = await query(
        `UPDATE attendance_sessions 
         SET state = 'CLOSED', 
             end_time = NOW(),
             updated_at = NOW()
         WHERE state = 'OPEN' 
           AND auto_close_at IS NOT NULL 
           AND auto_close_at <= NOW()`
      );
      const affected = result?.affectedRows ?? result?.changes ?? 0;
      if (affected > 0) {
        logger.info(`Auto-close scanner transitioned ${affected} session(s) from OPEN to CLOSED`);
      }
    } catch (err) {
      logger.error('Error executing auto-close session scanner', { error: err.message });
    }
  }
}

module.exports = new AttendanceService();
