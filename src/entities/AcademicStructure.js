/**
 * Academic Structure Domain Entity
 * Encapsulates:
 * 1. Departments & Degree Programs (Standard 6 Polytechnic Disciplines)
 * 2. Autonomous Academic Session Engine (YYYY-YY Odd/Even Semester zero-maintenance)
 * 3. IRDT Uttarakhand Curriculum & Syllabus Schemes (2026-27 & 2019-20)
 * 4. Biometric Hardware Terminals (ESP32)
 */

class AcademicStructure {
  /**
   * Standard Core Institutional Polytechnic Departments
   * Protected from accidental deletion.
   */
  static CORE_DEPARTMENTS = [
    { code: 'ECE',   name: 'Electronics Engineering',     durationYears: 3, totalSemesters: 6, icon: '📟', type: 'DIPLOMA_ENG' },
    { code: 'EE',    name: 'Electrical Engineering',      durationYears: 3, totalSemesters: 6, icon: '⚡', type: 'DIPLOMA_ENG' },
    { code: 'IT',    name: 'Information Technology',       durationYears: 3, totalSemesters: 6, icon: '💻', type: 'DIPLOMA_ENG' },
    { code: 'ME',    name: 'Mechanical Engineering',      durationYears: 3, totalSemesters: 6, icon: '⚙️', type: 'DIPLOMA_ENG' },
    { code: 'CE',    name: 'Civil Engineering',           durationYears: 3, totalSemesters: 6, icon: '🏛️', type: 'DIPLOMA_ENG' },
    { code: 'PHARM', name: 'Pharmacy',                    durationYears: 2, totalSemesters: 4, icon: '🧪', type: 'DIPLOMA_PHARM' }
  ];

  /**
   * Official IRDT Uttarakhand Syllabus Schemes
   */
  static SYLLABUS_SCHEMES = {
    NEW_SCHEME: '2026-27',
    OLD_SCHEME: '2019-20'
  };

  /**
   * Returns whether a department code belongs to core protected departments
   */
  static isCoreDepartment(deptCode) {
    if (!deptCode) return false;
    const code = String(deptCode).toUpperCase().trim();
    return AcademicStructure.CORE_DEPARTMENTS.some(d => d.code === code);
  }

  static isStandardDepartment(deptCode) {
    return AcademicStructure.isCoreDepartment(deptCode);
  }

  /**
   * Derives automatic session label following institutional rules:
   * July–Dec (months 7–12) ➔ YYYY-YY (Odd Semester)
   * Jan–June (months 1–6)  ➔ YYYY-YY (Even Semester)
   */
  static computeAutonomousSession(date = new Date()) {
    const d = (date instanceof Date) ? date : new Date(date);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    let startYear, cycle, termType;
    if (month >= 7) {
      startYear = year;
      cycle = 'Odd Semester';
      termType = 'ODD';
    } else {
      startYear = year - 1;
      cycle = 'Even Semester';
      termType = 'EVEN';
    }
    const endYearShort = String(startYear + 1).slice(-2);
    const label = `${startYear}-${endYearShort} (${cycle})`;

    return {
      sessionYear: startYear,
      sessionLabel: label,
      cycle,
      termType,
      isAutonomous: true
    };
  }
}

module.exports = AcademicStructure;
