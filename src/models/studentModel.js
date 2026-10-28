/**
 * Student Model
 * Encapsulates SQLite queries and transactions for student accounts, enrollments, registrations, and dossiers.
 *
 * Architecture Role: Model (Data Access Layer)
 * Interacts With:
 *   - Controllers: controllers/studentController.js
 *   - Routes: routes/students.js
 * Database Tables: students, users, user_roles, enrollments, departments, academic_years, fingerprint_slots, student_department_enrollments, register_attendance, assessment_submissions
 */

const { query, withTransaction } = require('../config/db');

class StudentModel {
  /**
   * Fetches full profile details for an enrolled student.
   * @calledBy StudentController.getProfile() (controllers/studentController.js)
   * @route GET /api/v1/students/me (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<Object|null>} Student record or null
   */
  static async getProfile(studentId) {
    const rows = await query(
      `SELECT s.id, s.official_enrollment_no, s.official_enrollment_no as enrollment_no, s.registration_no,
              s.full_name, s.entry_mode, s.admission_year, s.graduation_year, s.is_lateral_entry,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, e.year, e.semester, e.status as enrollment_status,
              d.name as department_name, d.code as department_code,
              d.name as branch_name, d.code as branch_code,
              ay.label as academic_year_label,
              u.username, u.email, u.status as account_status, u.created_at as account_created_at,
              s.phone as student_phone, s.parent_phone, s.parent_name,
              s.address, s.aadhar_number, s.father_name, s.mother_name, s.dob, s.gender, s.category,
              COALESCE(s.profile_completed, 0) as profile_completed
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       JOIN departments d ON e.department_id = d.id
       JOIN academic_years ay ON e.academic_year_id = ay.id
       WHERE s.id = ?`,
      [studentId]
    );
    return rows[0] || null;
  }

  /**
   * Fetches active hardware biometric slot assignment for a student.
   * @calledBy StudentController.getProfile() (controllers/studentController.js)
   * @route GET /api/v1/students/me (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<Object|null>} Biometric slot info or null
   */
  static async getBiometricSlot(studentId) {
    const rows = await query(
      `SELECT fs.slot_id, fs.enrolled_at, d.device_uid, d.name as device_name
       FROM fingerprint_slots fs
       JOIN devices d ON fs.device_id = d.id
       WHERE fs.student_id = ? AND fs.is_active = 1`,
      [studentId]
    );
    return rows[0] || null;
  }

  /**
   * Updates user email address.
   * @calledBy StudentController.updateProfile() (controllers/studentController.js)
   * @route PUT /api/v1/students/me (routes/students.js)
   * @param {number} userId - User primary key
   * @param {string} email - New email address
   * @returns {Promise<void>}
   */
  static async updateUserEmail(userId, email) {
    await query(
      `UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [email.toLowerCase(), userId]
    );
  }

  /**
   * Fetches the current password hash for a user.
   * @calledBy StudentController.updateProfile() (controllers/studentController.js)
   * @route PUT /api/v1/students/me (routes/students.js)
   * @param {number} userId - User primary key
   * @returns {Promise<string|null>} Password hash or null
   */
  static async getUserPasswordHash(userId) {
    const rows = await query(`SELECT password_hash FROM users WHERE id = ?`, [userId]);
    return rows[0]?.password_hash || null;
  }

  /**
   * Updates user password hash.
   * @calledBy StudentController.updateProfile() (controllers/studentController.js)
   * @route PUT /api/v1/students/me (routes/students.js)
   * @param {number} userId - User primary key
   * @param {string} passwordHash - Bcrypt hashed password
   * @returns {Promise<void>}
   */
  static async updateUserPassword(userId, passwordHash) {
    await query(
      `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [passwordHash, userId]
    );
  }

  /**
   * Updates student demographic and KYC details.
   * @param {number} studentId - Student primary key
   * @param {Object} details - Details to update
   * @returns {Promise<void>}
   */
  static async updateStudentDetails(studentId, details = {}) {
    const allowed = [
      'address',
      'aadhar_number',
      'father_name',
      'mother_name',
      'dob',
      'gender',
      'category',
      'phone',
      'profile_completed'
    ];
    const setClauses = [];
    const params = [];

    for (const [k, v] of Object.entries(details)) {
      if (allowed.includes(k) && v !== undefined) {
        setClauses.push(`${k} = ?`);
        params.push(v === '' ? null : v);
      }
    }

    if (!setClauses.length) return;
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    params.push(studentId);

    await query(`UPDATE students SET ${setClauses.join(', ')} WHERE id = ?`, params);
  }

  static async getStudentIdByUserId(userId) {
    const rows = await query(`SELECT id FROM students WHERE user_id = ?`, [userId]);
    return rows[0]?.id || null;
  }

  /**
   * Looks up the department ID for a teacher.
   * @calledBy StudentController.provisionStudent(), bulkProvision(), listPendingRegistrations(), countPendingRegistrations(), adjudicateRegistration() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk, GET /api/v1/students/registrations/pending, GET /api/v1/students/registrations/count, POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @param {number} teacherId - Teacher primary key
   * @returns {Promise<number|null>} Department ID
   */
  static async getTeacherDepartment(teacherId) {
    const rows = await query('SELECT department_id FROM teachers WHERE id = ?', [teacherId]);
    return rows[0]?.department_id || null;
  }

  /**
   * Fetches active/current academic year ID.
   * @calledBy StudentController.provisionStudent(), bulkProvision(), listPendingRegistrations(), countPendingRegistrations() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk, GET /api/v1/students/registrations/pending, GET /api/v1/students/registrations/count (routes/students.js)
   * @returns {Promise<number|null>} Current academic year ID
   */
  static async getCurrentAcademicYearId() {
    const rows = await query(`SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1`);
    return rows[0]?.id || null;
  }

  /**
   * Checks if an official enrollment number or username already exists.
   * @calledBy StudentController.provisionStudent(), bulkProvision() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk (routes/students.js)
   * @param {string} cleanEnroll - Trimmed official enrollment number
   * @returns {Promise<boolean>} True if conflict exists
   */
  static async checkEnrollmentConflict(cleanEnroll) {
    const rows = await query(
      `SELECT id FROM students WHERE LOWER(TRIM(official_enrollment_no)) = LOWER(?)
       UNION
       SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)`,
      [cleanEnroll, cleanEnroll]
    );
    return rows.length > 0;
  }

  /**
   * Checks if an email address or username already exists.
   * @calledBy StudentController.provisionStudent(), bulkProvision() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk (routes/students.js)
   * @param {string} cleanEmail - Trimmed email address
   * @returns {Promise<boolean>} True if conflict exists
   */
  static async checkEmailConflict(cleanEmail) {
    const rows = await query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(username)) = LOWER(?)`,
      [cleanEmail, cleanEmail]
    );
    return rows.length > 0;
  }

  /**
   * Calculates next sequential class roll number for a cohort.
   * @calledBy StudentController.provisionStudent(), bulkProvision() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk (routes/students.js)
   * @param {number} departmentId - Department primary key
   * @param {number} year - Academic year (1-3)
   * @param {number} semester - Semester (1-6)
   * @param {number} ayId - Academic year ID
   * @returns {Promise<number>} Next class roll number
   */
  static async getNextClassRollNo(departmentId, year, semester, ayId) {
    const rows = await query(
      `SELECT COALESCE(MAX(class_roll_no), 0) + 1 AS next_roll
       FROM enrollments
       WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ?`,
      [departmentId, year, semester, ayId]
    );
    return rows[0]?.next_roll || 1;
  }

  /**
   * Checks whether a class roll number is already assigned in a cohort.
   * @calledBy StudentController.provisionStudent(), bulkProvision() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk (routes/students.js)
   * @param {number} departmentId - Department ID
   * @param {number} year - Academic year
   * @param {number} semester - Semester
   * @param {number} ayId - Academic year ID
   * @param {number} rollNo - Class roll number
   * @returns {Promise<boolean>} True if roll number already assigned
   */
  static async checkClassRollConflict(departmentId, year, semester, ayId, rollNo) {
    const rows = await query(
      `SELECT id FROM enrollments 
       WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ? AND class_roll_no = ?`,
      [departmentId, year, semester, ayId, rollNo]
    );
    return rows.length > 0;
  }

  /**
   * Executes atomic database transaction to provision student account, user roles, profile, and enrollment.
   * @calledBy StudentController.provisionStudent(), bulkProvision() (controllers/studentController.js)
   * @route POST /api/v1/students/provision, POST /api/v1/students/provision/bulk (routes/students.js)
   * @param {Object} params - Provisioning attributes
   * @returns {Promise<Object>} Created student record with temporary credentials
   */
  static async provisionStudentTransaction({
    cleanEnroll,
    email,
    tempPasswordHash,
    tempPassword,
    registrationNo,
    finalRoll,
    fullName,
    departmentId,
    year,
    semester,
    ayId
  }) {
    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, temp_password_hash, must_change_password, status) 
         VALUES (?, ?, ?, TRUE, 'PROVISIONED')`,
        [cleanEnroll, email?.trim() || null, tempPasswordHash]
      );
      const userId = uRes.insertId;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

      const [sRes] = await conn.execute(
        `INSERT INTO students (user_id, official_enrollment_no, registration_no, class_roll_no, full_name, entry_mode) 
         VALUES (?, ?, ?, ?, ?, 'teacher_provisioned')`,
        [userId, cleanEnroll, (registrationNo || '').trim() || null, finalRoll, fullName]
      );
      const studentId = sRes.insertId;

      await conn.execute(
        `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status) 
         VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
        [studentId, departmentId, year, semester, ayId, finalRoll]
      );

      try {
        await conn.execute(
          `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
           VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
          [studentId, departmentId, ayId, year, semester, finalRoll]
        );
      } catch (_) {}

      return {
        student_id: studentId,
        full_name: fullName,
        official_enrollment_no: cleanEnroll,
        enrollment_no: cleanEnroll,
        registration_no: (registrationNo || '').trim() || null,
        class_roll_no: finalRoll,
        temporary_password: tempPassword,
        status: 'PROVISIONED'
      };
    });
  }

  /**
   * Retrieves pending student self-registration requests filtered by cohort.
   * @calledBy StudentController.listPendingRegistrations() (controllers/studentController.js)
   * @route GET /api/v1/students/registrations/pending (routes/students.js)
   * @param {Object} filter - Department, year, semester, and academic year filters
   * @returns {Promise<Array>} List of pending registrations
   */
  static async listPendingRegistrations({ deptId, year, semester, ayId }) {
    let sql = `
      SELECT s.id, s.id as student_id, s.official_enrollment_no, s.official_enrollment_no as enrollment_no, s.registration_no,
             s.full_name, s.entry_mode,
             u.email, u.created_at as registered_at,
             e.id as enrollment_id, e.status as enrollment_status,
             e.department_id, e.year, e.semester,
             d.name as department_name, d.code as department_code
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN enrollments e ON e.student_id = s.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE u.status = 'PENDING'
    `;
    const params = [];

    if (deptId) {
      sql += ' AND e.department_id = ?';
      params.push(Number(deptId));
    }
    if (year) {
      sql += ' AND e.year = ?';
      params.push(Number(year));
    }
    if (semester) {
      sql += ' AND e.semester = ?';
      params.push(Number(semester));
    }
    if (ayId) {
      sql += ' AND e.academic_year_id = ?';
      params.push(Number(ayId));
    }

    sql += ' ORDER BY u.created_at ASC';
    return await query(sql, params);
  }

  /**
   * Counts pending student self-registration requests.
   * @calledBy StudentController.countPendingRegistrations() (controllers/studentController.js)
   * @route GET /api/v1/students/registrations/count (routes/students.js)
   * @param {Object} filter - Filter parameters
   * @returns {Promise<number>} Count of pending records
   */
  static async countPendingRegistrations({ deptId, year, semester, ayId }) {
    let sql = `
      SELECT COUNT(*) as count
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN enrollments e ON e.student_id = s.id
      WHERE u.status = 'PENDING'
    `;
    const params = [];

    if (deptId) {
      sql += ' AND e.department_id = ?';
      params.push(Number(deptId));
    }
    if (year) {
      sql += ' AND e.year = ?';
      params.push(Number(year));
    }
    if (semester) {
      sql += ' AND e.semester = ?';
      params.push(Number(semester));
    }
    if (ayId) {
      sql += ' AND e.academic_year_id = ?';
      params.push(Number(ayId));
    }

    const rows = await query(sql, params);
    return rows[0]?.count || 0;
  }

  /**
   * Looks up pending student ID by official enrollment number or registration number.
   * @calledBy StudentController.adjudicateRegistration() (controllers/studentController.js)
   * @route POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @param {string} lookupVal - Enrollment or registration number
   * @returns {Promise<number|null>} Student ID or null
   */
  static async lookupPendingStudentId(lookupVal) {
    const rows = await query(
      `SELECT s.id FROM students s JOIN users u ON s.user_id = u.id WHERE (s.official_enrollment_no = ? OR s.registration_no = ?) AND u.status = 'PENDING' LIMIT 1`,
      [lookupVal, lookupVal]
    );
    return rows[0]?.id || null;
  }

  /**
   * Looks up the department ID for a student.
   * @calledBy StudentController.adjudicateRegistration() (controllers/studentController.js)
   * @route POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<number|null>} Department ID or null
   */
  static async getStudentDepartmentId(studentId) {
    const rows = await query(
      `SELECT department_id FROM enrollments WHERE student_id = ? LIMIT 1`,
      [studentId]
    );
    return rows[0]?.department_id || null;
  }

  /**
   * Verifies if a user is the HOD of a specific department.
   * @calledBy StudentController.adjudicateRegistration() (controllers/studentController.js)
   * @route POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @param {number} deptId - Department ID
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} True if user is HOD
   */
  static async isHodOfDepartment(deptId, userId) {
    const rows = await query(
      `SELECT id FROM departments WHERE id = ? AND hod_user_id = ?`,
      [deptId, userId]
    );
    return rows.length > 0;
  }

  /**
   * Executes atomic transaction to approve or reject student self-registration request.
   * @calledBy StudentController.adjudicateRegistration() (controllers/studentController.js)
   * @route POST /api/v1/students/registrations/:id/adjudicate (routes/students.js)
   * @param {Object} params - Adjudication parameters
   * @returns {Promise<Object>} Outcome details
   */
  static async adjudicateRegistrationTransaction({
    resolvedStudentId,
    lookupVal,
    action,
    officialEnrollmentNo,
    enrollmentNo,
    classRollNo,
    rejectionReason
  }) {
    return await withTransaction(async (conn) => {
      let students = [];
      if (resolvedStudentId) {
        const [rows] = await conn.execute(
          `SELECT s.id as student_id, s.user_id, s.official_enrollment_no, s.full_name,
                  e.department_id, e.academic_year_id, e.year, e.semester, e.class_roll_no
           FROM students s
           JOIN enrollments e ON s.id = e.student_id
           WHERE s.id = ? LIMIT 1`,
          [resolvedStudentId]
        );
        students = rows;
      }

      if (students.length === 0 && lookupVal) {
        const [rows] = await conn.execute(
          `SELECT s.id as student_id, s.user_id, s.official_enrollment_no, s.full_name,
                  e.department_id, e.academic_year_id, e.year, e.semester, e.class_roll_no
           FROM students s
           JOIN enrollments e ON s.id = e.student_id
           WHERE (s.official_enrollment_no = ? OR s.registration_no = ?)
           LIMIT 1`,
          [lookupVal, lookupVal]
        );
        students = rows;
      }

      if (students.length === 0) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Student not found' };
      }

      const student = students[0];
      const actualStudentId = student.student_id;
      const userId = student.user_id;
      const studentName = student.full_name;
      let resolvedEnrollNo = null;
      let finalRollNo = null;

      if (action === 'APPROVE') {
        resolvedEnrollNo = (officialEnrollmentNo || enrollmentNo || student.official_enrollment_no || '').trim();
        if (!resolvedEnrollNo) {
          throw { status: 400, code: 'VALIDATION_ERROR', message: 'Official Enrollment Number is required to approve student enrollment' };
        }

        const [conflict] = await conn.execute(
          `SELECT id FROM students WHERE official_enrollment_no = ? AND id != ? LIMIT 1`,
          [resolvedEnrollNo, actualStudentId]
        );
        if (conflict && conflict.length > 0) {
          throw { status: 409, code: 'CONFLICT', message: `Enrollment number "${resolvedEnrollNo}" is already assigned to another student.` };
        }

        finalRollNo = classRollNo ? Number(classRollNo) : null;
        if (!finalRollNo || isNaN(finalRollNo) || finalRollNo <= 0) {
          const [maxRollRow] = await conn.execute(
            `SELECT COALESCE(MAX(class_roll_no), 0) + 1 AS next_roll
             FROM enrollments
             WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ?`,
            [student.department_id, student.year, student.semester, student.academic_year_id]
          );
          finalRollNo = maxRollRow[0]?.next_roll || 1;
        }

        await conn.execute(`UPDATE users SET status = 'ACTIVE', username = ? WHERE id = ?`, [resolvedEnrollNo, userId]);
        await conn.execute(
          `UPDATE enrollments SET class_roll_no = ?, status = 'ENROLLED' WHERE student_id = ?`,
          [finalRollNo, actualStudentId]
        );
        await conn.execute(
          `UPDATE students SET official_enrollment_no = ?, class_roll_no = ? WHERE id = ?`,
          [resolvedEnrollNo, finalRollNo, actualStudentId]
        );

        try {
          await conn.execute(
            `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
             VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
            [actualStudentId, student.department_id, student.academic_year_id, student.year, student.semester, finalRollNo]
          );
        } catch (_) {}
      } else {
        await conn.execute(
          `UPDATE users SET status = 'REJECTED', rejection_reason = ? WHERE id = ?`,
          [rejectionReason || 'Registration rejected by faculty', userId]
        );
      }

      return {
        actualStudentId,
        userId,
        studentName,
        resolvedEnrollNo,
        finalRollNo
      };
    });
  }

  /**
   * Retrieves student details for department transfer validation.
   * @calledBy StudentController.transferDepartment() (controllers/studentController.js)
   * @route POST /api/v1/students/:id/transfer-department (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<Object|null>} Student record or null
   */
  static async getStudentForTransfer(studentId) {
    const rows = await query(
      `SELECT s.id, s.full_name, e.department_id as current_dept_id, e.academic_year_id, e.year, e.semester, e.class_roll_no
       FROM students s
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE s.id = ?`,
      [studentId]
    );
    return rows[0] || null;
  }

  /**
   * Verifies if user is HOD of any of the given department IDs.
   * @calledBy StudentController.transferDepartment() (controllers/studentController.js)
   * @route POST /api/v1/students/:id/transfer-department (routes/students.js)
   * @param {Array<number>} deptIds - Department IDs
   * @param {number} userId - User primary key
   * @returns {Promise<boolean>} True if user is HOD of at least one department
   */
  static async isHodOfAnyDepartment(deptIds, userId) {
    const rows = await query(
      `SELECT id FROM departments WHERE id IN (${deptIds.map(() => '?').join(',')}) AND hod_user_id = ?`,
      [...deptIds, userId]
    );
    return rows.length > 0;
  }

  /**
   * Executes atomic database transaction to transfer student to a new department.
   * @calledBy StudentController.transferDepartment() (controllers/studentController.js)
   * @route POST /api/v1/students/:id/transfer-department (routes/students.js)
   * @param {Object} params - Transfer details
   * @returns {Promise<Object>} Transfer result
   */
  static async transferDepartmentTransaction({ studentId, student, newDepartmentId, reason, actorId }) {
    return await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE student_department_enrollments 
         SET end_date = DATE('now'), status = 'TRANSFERRED', updated_at = CURRENT_TIMESTAMP 
         WHERE student_id = ? AND status = 'ACTIVE'`,
        [studentId]
      );

      await conn.execute(
        `INSERT INTO student_department_enrollments 
         (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status)
         VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'ACTIVE')`,
        [studentId, newDepartmentId, student.academic_year_id, student.year, student.semester, student.class_roll_no]
      );

      await conn.execute(
        `UPDATE enrollments SET department_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND status = 'ENROLLED'`,
        [newDepartmentId, studentId]
      );

      try {
        await conn.execute(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
           VALUES (?, 'STUDENT_DEPARTMENT_TRANSFERRED', 'students', ?, ?)`,
          [actorId, String(studentId), JSON.stringify({ from_dept: student.current_dept_id, to_dept: newDepartmentId, reason: reason || null })]
        );
      } catch (_) {}

      return {
        student_id: Number(studentId),
        from_department_id: student.current_dept_id,
        to_department_id: Number(newDepartmentId),
        transferred_at: new Date().toISOString()
      };
    });
  }

  /**
   * Retrieves department transfer history for a student.
   * @calledBy StudentController.getDepartmentHistory() (controllers/studentController.js)
   * @route GET /api/v1/students/:id/department-history (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<Array>} Chronological department enrollment history
   */
  static async getDepartmentHistory(studentId) {
    return await query(
      `SELECT sde.*, d.name as department_name, d.code as department_code, ay.label as academic_year_label
       FROM student_department_enrollments sde
       JOIN departments d ON sde.department_id = d.id
       LEFT JOIN academic_years ay ON sde.academic_year_id = ay.id
       WHERE sde.student_id = ?
       ORDER BY sde.start_date DESC, sde.id DESC`,
      [studentId]
    );
  }

  /**
   * Retrieves raw academic dossier records including attendance sessions, assignments, and exams.
   * @calledBy StudentController.getAcademicDossier() (controllers/studentController.js)
   * @route GET /api/v1/students/:id/academic-dossier (routes/students.js)
   * @param {number} studentId - Student primary key
   * @returns {Promise<Object|null>} Raw dossier payload or null
   */
  static async getAcademicDossierRaw(studentId) {
    const studentRows = await query(
      `SELECT s.id, s.user_id, s.official_enrollment_no, s.registration_no, s.full_name,
              s.entry_mode, s.admission_year, s.graduation_year, s.is_lateral_entry,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
              s.phone, s.parent_phone, s.parent_name,
              u.username, u.email, u.status as user_status,
              d.id as department_id, d.name as department_name, d.code as department_code,
              d.degree_duration_years as total_years,
              e.year as current_year, e.semester as current_semester, e.status as enrollment_status,
              ay.label as academic_year_label
       FROM students s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN academic_years ay ON e.academic_year_id = ay.id
       WHERE s.id = ?
       LIMIT 1`,
      [studentId]
    );

    if (!studentRows || studentRows.length === 0) {
      return null;
    }

    const student = studentRows[0];
    const isGraduated = student.user_status === 'ALUMNI' || student.enrollment_status === 'COMPLETED' || !!student.graduation_year;
    student.is_passout = isGraduated;
    student.display_status = isGraduated ? 'PASSOUT' : 'ACTIVE';

    const historyRows = await query(
      `SELECT sde.id, sde.year, sde.semester, sde.class_roll_no, sde.start_date, sde.end_date, sde.status,
              ay.label as academic_year_label
       FROM student_department_enrollments sde
       LEFT JOIN academic_years ay ON sde.academic_year_id = ay.id
       WHERE sde.student_id = ?
       ORDER BY sde.semester ASC, sde.id ASC`,
      [studentId]
    );

    const attendanceRows = await query(
      `SELECT ra.id as record_id, ra.attendance_status, ra.teacher_notes as remarks, ra.marked_at as recorded_at,
              s.id as session_id, s.session_date, s.session_type,
              reg.id as register_id, reg.name as register_name, reg.semester, reg.year,
              sub.id as subject_id, sub.code as subject_code, sub.name as subject_name,
              t.full_name as teacher_name
       FROM register_attendance ra
       JOIN attendance_sessions s ON ra.session_id = s.id
       JOIN attendance_registers reg ON s.register_id = reg.id
       LEFT JOIN subjects sub ON reg.subject_id = sub.id
       LEFT JOIN teachers t ON reg.teacher_id = t.id
       WHERE ra.student_id = ?
       ORDER BY reg.semester ASC, s.session_date ASC`,
      [studentId]
    );

    const assignmentRows = await query(
      `SELECT sub.id as submission_id, sub.file_path, sub.original_filename, sub.submitted_at,
              sub.status as submission_status, sub.marks_obtained, sub.feedback, sub.graded_at,
              a.id as assignment_id, a.title as assignment_title, a.description, a.max_marks,
              a.due_date, a.semester, a.year,
              subj.id as subject_id, subj.code as subject_code, subj.name as subject_name,
              t.full_name as teacher_name
       FROM assessment_submissions sub
       JOIN assessments a ON sub.assessment_id = a.id
       LEFT JOIN subjects subj ON a.subject_id = subj.id
       LEFT JOIN teachers t ON a.teacher_id = t.id
       WHERE sub.student_id = ? AND a.type = 'ASSIGNMENT'
       ORDER BY a.semester ASC, sub.submitted_at DESC`,
      [studentId]
    );

    const examRows = await query(
      `SELECT sub.id as score_id, sub.marks_obtained, sub.feedback as remarks, sub.graded_at as created_at,
              a.id as exam_id, a.title as exam_name, a.due_date as exam_date, a.max_marks,
              a.semester, a.year,
              subj.id as subject_id, subj.code as subject_code, subj.name as subject_name,
              t.full_name as teacher_name
       FROM assessment_submissions sub
       JOIN assessments a ON sub.assessment_id = a.id
       LEFT JOIN subjects subj ON a.subject_id = subj.id
       LEFT JOIN teachers t ON a.teacher_id = t.id
       WHERE sub.student_id = ? AND a.type = 'EXAM'
       ORDER BY a.semester ASC, a.due_date DESC`,
      [studentId]
    );

    return {
      student,
      historyRows,
      attendanceRows,
      assignmentRows,
      examRows
    };
  }
}

module.exports = StudentModel;
