/**
 * Attendance Domain Entity & Statutory Institutional Rules
 * Encapsulates attendance sessions, 3-stream multi-modal verification, and the
 * AICTE / UBTER 75% statutory attendance requirement.
 */

class Attendance {
  /**
   * Session Lifecycle States
   */
  static STATES = {
    DRAFT: 'DRAFT',
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    FINALIZED: 'FINALIZED'
  };

  /**
   * Verification Streams
   */
  static STREAMS = {
    STREAM_1_ESP32: 'STREAM_1_ESP32', // Biometric optical hardware scans
    STREAM_2_LIVE_CLAIM: 'STREAM_2_LIVE_CLAIM', // Dynamic cryptographic QR & 6-Digit PIN
    STREAM_3_MANUAL: 'STREAM_3_MANUAL' // Faculty quick-tap roster roll call
  };

  /**
   * Universal Attendance Statuses
   */
  static STATUS = {
    PRESENT: 'PRESENT',
    ABSENT: 'ABSENT',
    LATE: 'LATE'
  };

  constructor(data = {}) {
    this.id = data.id || null;
    this.registerId = data.registerId || data.register_id || null;
    this.subjectId = data.subjectId || data.subject_id || null;
    this.teacherId = data.teacherId || data.teacher_id || null;
    this.sessionDate = data.sessionDate || data.session_date || new Date().toISOString().split('T')[0];
    this.status = data.status || Attendance.STATES.DRAFT;
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
  }

  /**
   * Session check-in validation
   */
  canStudentCheckIn() {
    return this.status === Attendance.STATES.OPEN;
  }

  /**
   * Closes live claims (QR & PIN expire)
   */
  closeSession() {
    this.status = Attendance.STATES.CLOSED;
  }

  /**
   * Finalizes register session (Locks matrix)
   */
  finalizeSession() {
    this.status = Attendance.STATES.FINALIZED;
  }

  /**
   * Statutory Institutional Attendance Thresholds (UBTER & AICTE)
   */
  static STATUTORY_THRESHOLD = 75.0; // 75% minimum required to appear for semester exams
  static CRITICAL_THRESHOLD = 60.0;  // Below 60% is critical detention zone

  /**
   * Calculates safe absences a student can afford without dropping below 75%
   */
  static calculateSafeAbsences(totalConducted, attended, targetPct = 75.0) {
    if (!totalConducted || totalConducted <= 0) return 0;
    const maxAbsencesAllowed = Math.floor(totalConducted * (1 - targetPct / 100));
    const currentAbsences = totalConducted - attended;
    return Math.max(0, maxAbsencesAllowed - currentAbsences);
  }

  /**
   * Calculates consecutive classes required to reach 75% if currently deficient
   */
  static calculateClassesNeeded(totalConducted, attended, targetPct = 75.0) {
    if (!totalConducted || totalConducted <= 0) return 0;
    const currentPct = (attended / totalConducted) * 100;
    if (currentPct >= targetPct) return 0;
    // Solve for x: (attended + x) / (totalConducted + x) >= targetPct / 100
    // attended + x >= 0.75 * totalConducted + 0.75 * x
    // 0.25 * x >= 0.75 * totalConducted - attended
    // x = ceil((0.75 * totalConducted - attended) / 0.25)
    const factor = targetPct / 100;
    const needed = Math.ceil((factor * totalConducted - attended) / (1 - factor));
    return Math.max(0, needed);
  }

  /**
   * Evaluates student exam eligibility and standing
   */
  static evaluateStanding(percentage) {
    const pct = Number(percentage) || 0;
    if (pct >= Attendance.STATUTORY_THRESHOLD) {
      return {
        status: 'ELIGIBLE',
        label: 'Exam Eligible',
        tone: 'good',
        isDefaulter: false,
        message: 'Attendance is above statutory 75% requirement.'
      };
    } else if (pct >= Attendance.CRITICAL_THRESHOLD) {
      return {
        status: 'WARNING',
        label: 'Short Attendance Warning',
        tone: 'warning',
        isDefaulter: true,
        message: 'Attendance is between 60% and 75%. Short attendance warning issued.'
      };
    } else {
      return {
        status: 'DETAINED',
        label: 'Critical Detention Risk',
        tone: 'danger',
        isDefaulter: true,
        message: 'Attendance is critically below 60%. Subject to examination detention under UBTER rules.'
      };
    }
  }
}

module.exports = Attendance;
