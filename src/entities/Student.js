/**
 * Student Domain Entity (UBTER Institutional Standard)
 * Formally encapsulates the 3 Uttarakhand Polytechnic Student Identifiers:
 * 1. class_roll_no     : Internal classroom roll number (1, 2, 3...) for attendance & tests
 * 2. registration_no    : Official Examination Registration Number issued by UBTER (e.g. 24101054001)
 * 3. official_enrollment_no / enrollment_no : Permanent Institutional Enrollment Number issued by UBTER (e.g. 2024IT001)
 */

class Student {
  constructor(data = {}) {
    this.id = data.id || data.student_id || null;
    this.userId = data.userId || data.user_id || null;
    
    // Core UBTER Identifiers
    this.classRollNo = data.classRollNo !== undefined ? Number(data.classRollNo) : (data.class_roll_no !== undefined ? Number(data.class_roll_no) : null);
    this.registrationNo = (data.registrationNo || data.registration_no || '').trim() || null;
    this.enrollmentNo = (data.enrollmentNo || data.enrollment_no || data.official_enrollment_no || '').trim() || null;
    this.officialEnrollmentNo = this.enrollmentNo; // Canonical alias

    // Personal & Academic Identity
    this.fullName = (data.fullName || data.full_name || '').trim();
    this.email = (data.email || '').trim() || null;
    this.departmentId = data.departmentId || data.department_id || null;
    this.departmentCode = data.departmentCode || data.department_code || null;
    this.departmentName = data.departmentName || data.department_name || null;
    this.branchId = data.branchId || data.branch_id || null;
    this.branchCode = data.branchCode || data.branch_code || null;
    this.branchName = data.branchName || data.branch_name || null;
    this.year = data.year !== undefined ? Number(data.year) : 1;
    this.semester = data.semester !== undefined ? Number(data.semester) : 1;
    this.academicYearId = data.academicYearId || data.academic_year_id || null;
    this.academicYearLabel = data.academicYearLabel || data.academic_year_label || null;

    // Institutional Lifecycle & Biometrics
    this.entryMode = data.entryMode || data.entry_mode || 'teacher_provisioned'; // 'self_registered' | 'teacher_provisioned'
    this.admissionYear = Number(data.admissionYear || data.admission_year) || new Date().getFullYear();
    this.isLateralEntry = Boolean(data.isLateralEntry || data.is_lateral_entry);
    this.graduationYear = data.graduationYear || data.graduation_year || null;
    this.status = data.status || data.enrollment_status || 'ENROLLED'; // 'PENDING' | 'ENROLLED' | 'PROMOTED' | 'DETAINED' | 'ALUMNI'
    this.fingerprintTemplate = data.fingerprintTemplate || data.fingerprint_template || null;
    this.fingerprintSlot = data.fingerprintSlot || data.fingerprint_slot || null;
    this.fingerprintDevice = data.fingerprintDevice || data.fingerprint_device || null;

    this.totalAttended = Number(data.totalAttended || data.total_attended || 0);
    this.totalClasses = Number(data.totalClasses || data.total_classes || 0);

    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
  }

  /**
   * Formats full 3-identifier string for reports and logs
   */
  formatIdentifierString() {
    return `Roll: ${this.getDisplayRoll()} | Reg: ${this.registrationNo || '—'} | Enroll: ${this.enrollmentNo || '—'}`;
  }

  /**
   * Calculates attendance percentage
   */
  getAttendancePercentage() {
    if (!this.totalClasses || this.totalClasses <= 0) return 100;
    return Math.round(((this.totalAttended || 0) / this.totalClasses) * 100);
  }

  /**
   * 75% AICTE / UBTER Exam Eligibility Rule
   */
  isExamEligible() {
    return this.getAttendancePercentage() >= 75;
  }

  /**
   * Generates display roll string without '#' (Clean institutional standard)
   */
  getDisplayRoll() {
    return this.classRollNo !== null ? String(this.classRollNo) : '—';
  }

  /**
   * Returns primary examination identifier (Registration No, falling back to Enrollment No)
   */
  getExamIdentifier() {
    return this.registrationNo || this.enrollmentNo || this.getDisplayRoll();
  }

  /**
   * Formats student header string: "1 • Aarav Sharma [2024IT001]"
   */
  toRosterSummary() {
    return `${this.getDisplayRoll()} • ${this.fullName} [${this.enrollmentNo || 'NO-ENROLL'}]`;
  }

  /**
   * Validates required student fields for enrollment
   */
  static validate(data) {
    const errors = [];
    if (!data.full_name && !data.fullName) {
      errors.push('Full name is required');
    }
    if (!data.official_enrollment_no && !data.enrollment_no && !data.enrollmentNo) {
      errors.push('UBTER Enrollment number is required');
    }
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toJSON() {
    return {
      id: this.id,
      student_id: this.id,
      user_id: this.userId,
      class_roll_no: this.classRollNo,
      registration_no: this.registrationNo,
      enrollment_no: this.enrollmentNo,
      official_enrollment_no: this.officialEnrollmentNo,
      full_name: this.fullName,
      email: this.email,
      department_id: this.departmentId,
      department_code: this.departmentCode,
      department_name: this.departmentName,
      branch_id: this.branchId,
      branch_code: this.branchCode,
      branch_name: this.branchName,
      year: this.year,
      semester: this.semester,
      academic_year_id: this.academicYearId,
      academic_year_label: this.academicYearLabel,
      entry_mode: this.entryMode,
      admission_year: this.admissionYear,
      is_lateral_entry: this.isLateralEntry ? 1 : 0,
      graduation_year: this.graduationYear,
      status: this.status,
      enrollment_status: this.status,
      fingerprint_slot: this.fingerprintSlot,
      fingerprint_device: this.fingerprintDevice,
      created_at: this.createdAt
    };
  }
}

module.exports = Student;
