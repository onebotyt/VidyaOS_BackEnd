/**
 * Autonomous Bi-Annual Student Promotion & Progression Engine
 * 
 * Automatically promotes students across semester boundaries:
 * - Odd Semester Cycle (July 1 - December 31):
 *     July 1 Rollover: Even semesters advance to next Odd semesters (Sem 2 -> 3, Sem 4 -> 5).
 *     Terminal semester students (Sem 6 for 3-yr Eng, Sem 4 for Pharmacy) graduate as PASSOUT / ALUMNI.
 * - Even Semester Cycle (January 1 - June 30):
 *     January 1 Rollover: Odd semesters advance to Even semesters (Sem 1 -> 2, Sem 3 -> 4, Sem 5 -> 6).
 * 
 * Invariant: Student academic data belongs to the student. Historical records in
 * student_department_enrollments are preserved with COMPLETED / GRADUATED statuses.
 * Expired teaching groups and registers are automatically transitioned to ARCHIVED.
 */

const { query, withTransaction } = require('../config/db');
const { resolveSession } = require('./sessionService');
const logger = require('../utils/logger');

/**
 * Executes autonomous semester promotion if not already executed for current active semester.
 * @param {Date} targetDate Reference date (defaults to now)
 * @param {boolean} force Force execution even if already recorded for this term
 */
async function checkAndRunAutomatedSemesterPromotion(targetDate = new Date(), force = false) {
  try {
    const session = resolveSession(targetDate);
    const activeLabel = session.session_label;
    const termType = session.term_type; // 'ODD' or 'EVEN'

    // 1. Check idempotency setting
    const settingRows = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'last_auto_promoted_term'`
    );
    const lastTerm = settingRows[0]?.setting_value;

    if (!force && lastTerm === activeLabel) {
      return {
        executed: false,
        reason: 'ALREADY_EXECUTED_FOR_TERM',
        active_term: activeLabel,
        term_type: termType
      };
    }

    // 2. Fetch current active academic_year_id
    const currentAyRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const currentAyId = currentAyRows[0]?.id || 1;

    let promotedCount = 0;
    let graduatedCount = 0;

    await withTransaction(async (conn) => {
      // Fetch all active departments with degree_duration_years
      const departments = await conn.query(`SELECT id, code, degree_duration_years FROM departments`);
      const deptMaxSemMap = {};
      departments.forEach(d => {
        deptMaxSemMap[d.id] = (d.degree_duration_years ? d.degree_duration_years * 2 : (d.code === 'PHARM' ? 4 : 6));
      });

      // Fetch all currently active enrollments
      const activeEnrollments = await conn.query(`
        SELECT e.id, e.student_id, e.department_id, e.year, e.semester, e.class_roll_no,
               s.user_id, s.full_name
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        WHERE e.status = 'ENROLLED'
      `);

      for (const en of activeEnrollments) {
        const maxSem = deptMaxSemMap[en.department_id] || 6;

        if (termType === 'EVEN') {
          // January 1 - June 30: Only promote students who are currently in an ODD semester (1, 3, 5)
          if (en.semester % 2 === 1) {
            const nextSem = en.semester + 1;
            const currentYr = en.year;

            // Update active enrollment
            await conn.execute(
              `UPDATE enrollments SET semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [nextSem, en.id]
            );

            // Close current department enrollment entry
            await conn.execute(
              `UPDATE student_department_enrollments 
               SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP 
               WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
              [en.student_id, en.department_id]
            );

            // Insert new semester enrollment entry
            await conn.execute(
              `INSERT INTO student_department_enrollments 
               (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) 
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
              [en.student_id, en.department_id, currentAyId, currentYr, nextSem, en.class_roll_no || null]
            );

            promotedCount++;
          }
        } else if (termType === 'ODD') {
          // July 1 - December 31: Promote students who are currently in an EVEN semester (2, 4, 6)
          if (en.semester % 2 === 0) {
            if (en.semester >= maxSem) {
              // Terminal semester: Student graduates / PASSOUT
              const gradYear = targetDate.getFullYear();
              await conn.execute(
                `UPDATE enrollments SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [en.id]
              );
              await conn.execute(
                `UPDATE users SET status = 'ALUMNI', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [en.user_id]
              );
              await conn.execute(
                `UPDATE students SET graduation_year = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [gradYear, en.student_id]
              );
              await conn.execute(
                `UPDATE fingerprint_slots SET is_active = 0 WHERE student_id = ?`,
                [en.student_id]
              );
              await conn.execute(
                `UPDATE student_department_enrollments 
                 SET status = 'GRADUATED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP 
                 WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
                [en.student_id, en.department_id]
              );

              graduatedCount++;
            } else {
              // Non-terminal: Year increments by 1, Semester increments by 1 (e.g. Sem 2 -> 3, Sem 4 -> 5)
              const nextSem = en.semester + 1;
              const nextYr = en.year + 1;

              await conn.execute(
                `UPDATE enrollments SET year = ?, semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [nextYr, nextSem, en.id]
              );

              await conn.execute(
                `UPDATE student_department_enrollments 
                 SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP 
                 WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
                [en.student_id, en.department_id]
              );

              await conn.execute(
                `INSERT INTO student_department_enrollments 
                 (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) 
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
                [en.student_id, en.department_id, currentAyId, nextYr, nextSem, en.class_roll_no || null]
              );

              promotedCount++;
            }
          }
        }
      }

      // Auto-archive active teaching groups from expired sessions
      await conn.execute(`
        UPDATE teaching_groups 
        SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP 
        WHERE status = 'ACTIVE' AND academic_year_id IN (SELECT id FROM academic_years WHERE is_current = 0)
      `);
      await conn.execute(`
        UPDATE attendance_registers
        SET is_active = 0
        WHERE group_id IN (SELECT id FROM teaching_groups WHERE status = 'ARCHIVED')
      `);

      // Update system settings to mark term promotion as executed
      await conn.execute(
        `INSERT INTO system_settings (setting_key, setting_value, description) 
         VALUES ('last_auto_promoted_term', ?, 'Last academic semester where automated promotion executed')
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
        [activeLabel]
      );
      await conn.execute(
        `INSERT INTO system_settings (setting_key, setting_value, description) 
         VALUES ('last_auto_promoted_at', CURRENT_TIMESTAMP, 'Timestamp of last automated semester promotion')
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`
      );
    });

    logger.info(`Autonomous Semester Promotion Executed: [${activeLabel}] Promoted: ${promotedCount}, Graduated: ${graduatedCount}`);

    return {
      executed: true,
      active_term: activeLabel,
      term_type: termType,
      promoted_count: promotedCount,
      graduated_count: graduatedCount
    };
  } catch (err) {
    logger.error(`Automated semester promotion failed: ${err.message}`);
    throw err;
  }
}

/**
 * Returns diagnostic promotion engine status.
 */
async function getPromotionEngineStatus(targetDate = new Date()) {
  const session = resolveSession(targetDate);
  const rows = await query(`
    SELECT setting_key, setting_value 
    FROM system_settings 
    WHERE setting_key IN ('last_auto_promoted_term', 'last_auto_promoted_at')
  `);
  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

  return {
    active_term: session.session_label,
    term_type: session.term_type,
    start_date: session.start_date,
    end_date: session.end_date,
    next_rollover_date: session.next_rollover_date,
    days_remaining: session.days_remaining,
    last_auto_promoted_term: settings.last_auto_promoted_term || null,
    last_auto_promoted_at: settings.last_auto_promoted_at || null,
    already_promoted_for_term: settings.last_auto_promoted_term === session.session_label
  };
}

module.exports = {
  checkAndRunAutomatedSemesterPromotion,
  getPromotionEngineStatus
};
