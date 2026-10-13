/**
 * Institutional System Administrator Domain Entity
 * Encapsulates administrative authority, institutional accreditation, and governance policies.
 */

class Admin {
  constructor(data = {}) {
    this.id = data.id || null;
    this.userId = data.userId || data.user_id || null;
    this.fullName = data.fullName || data.full_name || 'System Administrator';
    this.email = data.email || null;
    this.employeeId = data.employeeId || data.employee_id || 'ADMIN-01';
    this.role = 'SYSTEM_ADMIN';
    this.status = data.status || 'ACTIVE';
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
  }

  /**
   * Official Institutional Accreditation Profile
   * Defines Uttarakhand Board & Directorate Affiliation
   */
  static getInstitutionalAccreditation(settings = {}) {
    return {
      institutionName: settings.institution_name || 'Government Polytechnic College',
      institutionCode: settings.institution_code || 'GP-UBTER-101',
      affiliatingBoard: settings.affiliating_board || 'UBTER (Uttarakhand Board of Technical Education, Roorkee)',
      curriculumDirectorate: settings.curriculum_directorate || 'IRDT Uttarakhand (Institute of Research Development & Training)',
      campusRegion: settings.campus_region || 'Uttarakhand, India',
      gradingSystem: 'UBTER Percentage & Division (75% Minimum Mandatory Attendance)',
      academicSessionType: 'AUTONOMOUS_CALENDAR'
    };
  }

  /**
   * Administrative Governance Powers
   */
  static getPermissions() {
    return {
      canManageAccreditation: true,
      canManageDepartments: true,
      canAppointHOD: true,
      canReassignHOD: true,
      canArchiveDepartments: true,
      canViewInstitutionalAudit: true,
      canTriggerSystemBackup: true,
      canModifyAutonomousSession: false // Autonomous zero-maintenance rule
    };
  }

  isSuperAdmin() {
    return this.role === 'SYSTEM_ADMIN' || this.role === 'ADMIN';
  }

  hasPermission(permission) {
    const permissions = Admin.getPermissions();
    if (permission === 'departments.archive') return permissions.canArchiveDepartments;
    if (permission === 'hod.appoint') return permissions.canAppointHOD;
    if (permission === 'hod.reassign') return permissions.canReassignHOD;
    if (permission === 'departments.manage') return permissions.canManageDepartments;
    if (permission === 'accreditation.manage') return permissions.canManageAccreditation;
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      user_id: this.userId,
      full_name: this.fullName,
      email: this.email,
      employee_id: this.employeeId,
      role: this.role,
      status: this.status,
      created_at: this.createdAt
    };
  }
}

module.exports = Admin;
