/**
 * Faculty & Institutional Academic Staff Domain Entity
 * Encapsulates faculty profiles and the 3 distinct reassignable institutional roles:
 * 1. Head of Department (HOD) — Exactly 1 active HOD per department
 * 2. Class Teacher — Exactly 1 active Class Teacher per cohort
 * 3. Subject Teacher — Course instructor bound to digital registers
 */

class Faculty {
  constructor(data = {}) {
    this.id = data.id || null;
    this.userId = data.userId || data.user_id || null;
    this.fullName = data.fullName || data.full_name || '';
    this.email = data.email || null;
    this.employeeId = data.employeeId || data.employee_id || null;
    this.phone = data.phone || null;
    this.departmentId = data.departmentId || data.department_id || null;
    this.departmentCode = data.departmentCode || data.department_code || null;
    this.departmentName = data.departmentName || data.department_name || null;
    this.roles = Array.isArray(data.roles) ? data.roles : [];
    this.assignments = Array.isArray(data.assignments) ? data.assignments : [];
    this.status = data.status || 'ACTIVE';
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
  }

  /**
   * Institutional Roles Definition & Invariants
   */
  static ROLES = {
    HOD: 'HOD',
    CLASS_TEACHER: 'CLASS_TEACHER',
    SUBJECT_TEACHER: 'SUBJECT_TEACHER'
  };

  /**
   * Verifies if this faculty holds Head of Department power
   */
  isHOD() {
    return this.roles.includes(Faculty.ROLES.HOD) || 
           this.assignments.some(a => a.assignment_type === Faculty.ROLES.HOD && a.is_active !== false && a.is_active !== 0);
  }

  /**
   * Verifies if this faculty holds Class Teacher power for a specific cohort
   */
  isClassTeacher(departmentId = null, year = null, semester = null) {
    if (!departmentId) {
      return this.roles.includes(Faculty.ROLES.CLASS_TEACHER) ||
             this.assignments.some(a => a.assignment_type === Faculty.ROLES.CLASS_TEACHER && a.is_active !== false && a.is_active !== 0);
    }
    return this.assignments.some(a => 
      a.assignment_type === Faculty.ROLES.CLASS_TEACHER &&
      a.is_active !== false && a.is_active !== 0 &&
      Number(a.department_id) === Number(departmentId) &&
      (!year || Number(a.year) === Number(year)) &&
      (!semester || Number(a.semester) === Number(semester))
    );
  }

  /**
   * Verifies if faculty can manage roster or approvals for a cohort
   */
  canManageCohort(departmentId, year, semester) {
    if (this.isHOD() && (!this.departmentId || Number(this.departmentId) === Number(departmentId))) return true;
    return this.isClassTeacher(departmentId, year, semester);
  }

  /**
   * Returns human-readable combined roles descriptor
   * e.g. "HOD (IT Dept), Class Teacher (Y3 S5), Subject Teacher"
   */
  getCombinedRoleLabel() {
    const labels = [];
    if (this.isHOD()) {
      labels.push(`HOD (${this.departmentCode || 'Dept'})`);
    }
    const ctAssignments = this.assignments.filter(a => a.assignment_type === Faculty.ROLES.CLASS_TEACHER && a.is_active);
    if (ctAssignments.length > 0) {
      const cohorts = ctAssignments.map(a => `Y${a.year} S${a.semester}`).join(', ');
      labels.push(`Class Teacher (${cohorts})`);
    }
    const hasSubject = this.assignments.some(a => a.assignment_type === Faculty.ROLES.SUBJECT_TEACHER && a.is_active);
    if (hasSubject) {
      labels.push('Subject Teacher');
    }
    return labels.length > 0 ? labels.join(' • ') : 'Faculty';
  }

  toJSON() {
    return {
      id: this.id,
      user_id: this.userId,
      full_name: this.fullName,
      email: this.email,
      employee_id: this.employeeId,
      phone: this.phone,
      department_id: this.departmentId,
      department_code: this.departmentCode,
      department_name: this.departmentName,
      is_hod: this.isHOD(),
      is_class_teacher: this.isClassTeacher(),
      combined_roles: this.getCombinedRoleLabel(),
      roles: this.roles,
      assignments: this.assignments,
      status: this.status,
      created_at: this.createdAt
    };
  }
}

module.exports = Faculty;
