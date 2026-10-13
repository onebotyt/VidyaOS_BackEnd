/**
 * Digital Register Domain Entity (Uttarakhand Polytechnic Standard)
 * Encapsulates the unified digital register architecture binding:
 * 1. Attendance Matrix (Monthly Day 1-31 ledger)
 * 2. Coursework & Assignments (Submissions & grading)
 * 3. Class Tests & Examination Marksheets (Question-wise marksheet grid)
 * 4. Master Student Internal Evaluation Sheet (50 Marks Institutional Scheme)
 */

class DigitalRegister {
  constructor(data = {}) {
    this.id = data.id || null;
    this.teacherId = data.teacherId || data.teacher_id || null;
    this.teacherName = data.teacherName || data.teacher_name || null;
    this.name = data.name || 'Digital Register';
    this.subjectId = data.subjectId || data.subject_id || null;
    this.subjectCode = data.subjectCode || data.subject_code || null;
    this.subjectName = data.subjectName || data.subject_name || null;
    this.departmentId = data.departmentId || data.department_id || null;
    this.departmentCode = data.departmentCode || data.department_code || null;
    this.departmentName = data.departmentName || data.department_name || null;
    this.branchId = data.branchId || data.branch_id || null;
    this.branchCode = data.branchCode || data.branch_code || null;
    this.year = Number(data.year) || 1;
    this.semester = Number(data.semester) || 1;
    this.academicYearId = data.academicYearId || data.academic_year_id || null;
    this.academicYearLabel = data.academicYearLabel || data.academic_year_label || null;
    this.sessionTypeScope = data.sessionTypeScope || data.session_type_scope || 'THEORY';
    this.isOfficial = Boolean(data.isOfficial !== undefined ? data.isOfficial : data.is_official);
    this.isActive = Boolean(data.isActive !== undefined ? data.isActive : (data.is_active !== undefined ? data.is_active : true));
  }

  /**
   * Official Uttarakhand Polytechnic Internal Evaluation Scheme (50 Marks Total)
   * Image 2 Standard Formula:
   * - Assignment Total Marks (Avg): 15 Marks
   * - Unit Test Total Marks (Avg)  : 20 Marks
   * - Total Attendance             : 10 Marks
   * - Problem Solving / Presentation: 5 Marks
   * ─────────────────────────────────────────
   * Total Internal Evaluation       : 50 Marks
   */
  static EVALUATION_SCHEME = {
    ASSIGNMENT_MAX: 15,
    UNIT_TEST_MAX: 20,
    ATTENDANCE_MAX: 10,
    PRESENTATION_MAX: 5,
    TOTAL_MAX: 50
  };

  /**
   * Computes Attendance component marks out of 10 based on UBTER attendance percentage
   * >= 90% -> 10 marks
   * >= 85% -> 9 marks
   * >= 80% -> 8 marks
   * >= 75% -> 7 marks
   * < 75%  -> proportional / 0 marks if detained
   */
  static computeAttendanceScore(percentage) {
    const pct = Number(percentage) || 0;
    if (pct >= 90) return 10;
    if (pct >= 85) return 9;
    if (pct >= 80) return 8;
    if (pct >= 75) return 7;
    return Math.round((pct / 100) * 10 * 10) / 10;
  }

  /**
   * Computes the 50-mark Internal Evaluation Total
   */
  static calculateInternalTotal(assignmentAvg, unitTestAvg, attendanceScore, presentationScore = 0) {
    const a = Math.min(DigitalRegister.EVALUATION_SCHEME.ASSIGNMENT_MAX, Math.max(0, Number(assignmentAvg) || 0));
    const ut = Math.min(DigitalRegister.EVALUATION_SCHEME.UNIT_TEST_MAX, Math.max(0, Number(unitTestAvg) || 0));
    const att = Math.min(DigitalRegister.EVALUATION_SCHEME.ATTENDANCE_MAX, Math.max(0, Number(attendanceScore) || 0));
    const pres = Math.min(DigitalRegister.EVALUATION_SCHEME.PRESENTATION_MAX, Math.max(0, Number(presentationScore) || 0));

    const total = a + ut + att + pres;
    return Math.round(total * 10) / 10;
  }

  /**
   * Computes individual student evaluation payload
   */
  computeStudentEvaluation(scores = {}) {
    const a = scores.assignmentAvg15 !== undefined ? scores.assignmentAvg15 : (scores.assignmentAvg || 0);
    const ut = scores.unitTestAvg20 !== undefined ? scores.unitTestAvg20 : (scores.unitTestAvg || 0);
    const att = scores.attendanceScore10 !== undefined ? scores.attendanceScore10 : (scores.attendanceScore || 0);
    const pres = scores.presentationScore5 !== undefined ? scores.presentationScore5 : (scores.presentationScore || 0);

    const total = DigitalRegister.calculateInternalTotal(a, ut, att, pres);
    return {
      assignmentScore: a,
      unitTestScore: ut,
      attendanceScore: att,
      presentationScore: pres,
      totalMarks50: total,
      isPassing: total >= 20
    };
  }

  toJSON() {
    return {
      id: this.id,
      teacher_id: this.teacherId,
      teacher_name: this.teacherName,
      name: this.name,
      subject_id: this.subjectId,
      subject_code: this.subjectCode,
      subject_name: this.subjectName,
      department_id: this.departmentId,
      department_code: this.departmentCode,
      department_name: this.departmentName,
      branch_id: this.branchId,
      branch_code: this.branchCode,
      year: this.year,
      semester: this.semester,
      academic_year_id: this.academicYearId,
      academic_year_label: this.academicYearLabel,
      session_type_scope: this.sessionTypeScope,
      is_official: this.isOfficial ? 1 : 0,
      is_active: this.isActive ? 1 : 0
    };
  }
}

module.exports = DigitalRegister;
