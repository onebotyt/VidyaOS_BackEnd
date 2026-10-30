/**
 * Session & Academic Year Automation Service
 * 
 * Automatically resolves and synchronizes the active academic session (e.g. "2026 Session")
 * based on calendar dates. Completely eliminates manual term and session toggling by admins.
 */

const { query, withTransaction } = require('../config/db');

/**
 * Automatically computes institutional Academic Session label (e.g. "2026-27 (Odd Semester)" or "2026-27 (Even Semester)")
 * from session calendar bounds (July 1 - Dec 31 = Odd Semester, Jan 1 - June 30 = Even Semester).
 */
function computeAutoSessionLabel(startStr, endStr, refDate = new Date()) {
  const ref = (refDate instanceof Date && !isNaN(refDate)) ? refDate : new Date();
  const refMonth = ref.getMonth() + 1;
  const refYear = ref.getFullYear();

  let ayStartYear;
  let ayEndYear;
  let cycle;

  if (refMonth >= 7) {
    ayStartYear = refYear;
    ayEndYear = refYear + 1;
    cycle = 'Odd Semester';
  } else {
    ayStartYear = refYear - 1;
    ayEndYear = refYear;
    cycle = 'Even Semester';
  }

  const shortEnd = String(ayEndYear).slice(-2);
  return `${ayStartYear}-${shortEnd} (${cycle})`;
}

/**
 * Resolves the academic semester details for a given date.
 * Strict Institutional 6-month cycles:
 * - Odd Semester: July 1 to December 31
 * - Even Semester: January 1 to June 30
 */
function resolveSession(date = new Date()) {
  const d = new Date(date);
  const currentYear = d.getFullYear();
  const currentMonth = d.getMonth() + 1; // 1-12

  let sessionYear;
  let ayEndYear;
  let cycle;
  let termType;
  let termName;
  let startDate;
  let endDate;
  let nextRolloverDate;
  let nextStart;
  let nextEnd;
  let nextCycle;
  let nextSessionYear;
  let nextAyEndYear;

  if (currentMonth >= 7) {
    // July 1 - December 31 (Odd Semester)
    sessionYear = currentYear;
    ayEndYear = currentYear + 1;
    cycle = 'Odd Semester';
    termType = 'ODD';
    termName = 'Odd Semester (July - Dec)';

    startDate = new Date(Date.UTC(sessionYear, 6, 1));
    endDate = new Date(Date.UTC(sessionYear, 11, 31, 23, 59, 59, 999));
    nextRolloverDate = new Date(Date.UTC(sessionYear + 1, 0, 1));

    nextSessionYear = sessionYear;
    nextAyEndYear = sessionYear + 1;
    nextCycle = 'Even Semester';
    nextStart = new Date(Date.UTC(sessionYear + 1, 0, 1));
    nextEnd = new Date(Date.UTC(sessionYear + 1, 5, 30, 23, 59, 59, 999));
  } else {
    // January 1 - June 30 (Even Semester)
    sessionYear = currentYear - 1;
    ayEndYear = currentYear;
    cycle = 'Even Semester';
    termType = 'EVEN';
    termName = 'Even Semester (Jan - June)';

    startDate = new Date(Date.UTC(currentYear, 0, 1));
    endDate = new Date(Date.UTC(currentYear, 5, 30, 23, 59, 59, 999));
    nextRolloverDate = new Date(Date.UTC(currentYear, 6, 1));

    nextSessionYear = currentYear;
    nextAyEndYear = currentYear + 1;
    nextCycle = 'Odd Semester';
    nextStart = new Date(Date.UTC(currentYear, 6, 1));
    nextEnd = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));
  }

  const formatDate = (dt) => dt.toISOString().split('T')[0];
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);
  const shortEnd = String(ayEndYear).slice(-2);
  const sessionLabel = `${sessionYear}-${shortEnd} (${cycle})`;

  const nextShortEnd = String(nextAyEndYear).slice(-2);
  const nextSessionLabel = `${nextSessionYear}-${nextShortEnd} (${nextCycle})`;

  const diffMs = nextRolloverDate.getTime() - d.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return {
    session_year: sessionYear,
    session_label: sessionLabel,
    auto_session_label: sessionLabel,
    next_session_label: nextSessionLabel,
    cycle,
    term_type: termType,
    term_name: termName,
    start_date: startStr,
    end_date: endStr,
    next_rollover_date: formatDate(nextRolloverDate),
    days_remaining: daysRemaining
  };
}

/**
 * Reads institutional calendar settings from system_settings.
 */
async function getSessionSettings() {
  try {
    const rows = await query(
      `SELECT setting_key, setting_value FROM system_settings 
       WHERE setting_key IN ('academic_year_start_month', 'academic_year_start_day', 'auto_session_enabled')`
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });

    return {
      start_month: parseInt(map.academic_year_start_month || '7', 10),
      start_day: parseInt(map.academic_year_start_day || '1', 10),
      auto_enabled: map.auto_session_enabled !== 'false'
    };
  } catch (err) {
    return { start_month: 7, start_day: 1, auto_enabled: true };
  }
}

/**
 * Automatically synchronizes academic_years and departments in SQLite.
 * Ensures the active session record exists, has is_current = 1, and synchronizes departments.
 */
async function syncAcademicSession(targetDate = new Date()) {
  const cfg = await getSessionSettings();
  const resolved = resolveSession(targetDate, cfg.start_month, cfg.start_day);

  let activeRecord = null;

  await withTransaction(async (conn) => {
    // 1. Check if an academic_years record covers targetDate or matches session label/year
    const dateStr = (targetDate instanceof Date ? targetDate : new Date(targetDate)).toISOString().split('T')[0];
    
    let existing = await conn.query(
      `SELECT id, label, start_date, end_date, is_current 
       FROM academic_years 
       WHERE (? BETWEEN start_date AND end_date) 
          OR label LIKE ? 
          OR label LIKE ?
       ORDER BY CASE WHEN ? BETWEEN start_date AND end_date THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
      [dateStr, `%${resolved.session_year}%`, resolved.session_label, dateStr]
    );

    let currentAyId;

    if (existing && existing.length > 0) {
      activeRecord = existing[0];
      currentAyId = activeRecord.id;

      const currentLabel = activeRecord.label;
      // Upgrade legacy 'YYYY Session', bare 'YYYY-YY', or legacy '(Winter)' / '(Summer)' to canonical institutional label (e.g. 2026-27 (Odd Semester))
      let targetLabel = resolved.session_label;
      if (currentLabel && 
          !/^\d{4}\s+Session$/i.test(currentLabel.trim()) && 
          !/^\d{4}-\d{2}$/.test(currentLabel.trim()) &&
          !/Winter|Summer/i.test(currentLabel.trim())) {
        targetLabel = currentLabel.trim();
      }

      // Ensure is_current = 1
      await conn.execute(`UPDATE academic_years SET is_current = 0 WHERE id != ?`, [currentAyId || 0]);
      await conn.execute(`UPDATE academic_years SET is_current = 1, label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetLabel, currentAyId]);
      resolved.session_label = targetLabel;
    } else {
      // Auto-create new academic session record
      const result = await conn.query(
        `INSERT INTO academic_years (label, start_date, end_date, is_current) 
         VALUES (?, ?, ?, 1)`,
        [resolved.session_label, resolved.start_date, resolved.end_date]
      );
      currentAyId = result?.insertId ?? result[0]?.insertId ?? result?.lastInsertRowid ?? 1;
      await conn.execute(`UPDATE academic_years SET is_current = 0 WHERE id != ?`, [currentAyId]);
    }

    // 2. Synchronize active_term in departments to the current session
    await conn.execute(
      `UPDATE departments SET active_term = ?, updated_at = CURRENT_TIMESTAMP WHERE active_term != ? OR active_term IS NULL`,
      [resolved.session_label, resolved.session_label]
    );

    // 3. Option 3: Automatically archive active teaching groups and registers from expired sessions
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
  });

  return {
    success: true,
    active_session: resolved.session_label,
    resolved,
    synced_at: new Date().toISOString()
  };
}

/**
 * Returns complete session metadata for Admin and Faculty APIs.
 */
async function getSessionStatus() {
  const cfg = await getSessionSettings();
  const resolved = resolveSession(new Date(), cfg.start_month, cfg.start_day);

  const currentAyRow = (await query(`SELECT id, label, start_date, end_date FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];

  let sessionLabel = currentAyRow?.label || resolved.session_label;
  if (/^\d{4}\s+Session$/i.test(sessionLabel.trim())) {
    sessionLabel = resolved.session_label;
  }
  const startDate = currentAyRow?.start_date || resolved.start_date;
  const endDate = currentAyRow?.end_date || resolved.end_date;

  // Next rollover date calculation: day following endDate
  let nextRolloverDate = resolved.next_rollover_date;
  if (endDate) {
    const endDt = new Date(endDate + 'T00:00:00.000Z');
    endDt.setUTCDate(endDt.getUTCDate() + 1);
    nextRolloverDate = endDt.toISOString().split('T')[0];
  }

  // Days remaining calculation: until endDate 23:59:59
  let daysRemaining = resolved.days_remaining;
  if (endDate) {
    const endDt = new Date(endDate + 'T23:59:59.999Z');
    const now = new Date();
    const diffMs = endDt.getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const autoSessionLabel = computeAutoSessionLabel(startDate, endDate, new Date());

  return {
    session_label: sessionLabel,
    auto_session_label: autoSessionLabel,
    db_academic_year_label: sessionLabel,
    academic_year_id: currentAyRow?.id || 1,
    start_date: startDate,
    end_date: endDate,
    next_rollover_date: nextRolloverDate,
    next_session_label: resolved.next_session_label,
    days_remaining: daysRemaining,
    auto_enabled: cfg.auto_enabled,
    start_month: cfg.start_month,
    start_day: cfg.start_day,
    status: 'AUTOMATED_ACTIVE'
  };
}

/**
 * Returns current active session information (id, label, start_date, end_date).
 * Prevents hardcoding of session names across all routes and services.
 */
async function getActiveSession() {
  const status = await getSessionStatus();
  return {
    id: status.academic_year_id,
    label: status.session_label,
    start_date: status.start_date,
    end_date: status.end_date
  };
}

/**
 * Updates the active academic session duration and/or label.
 * Synchronizes academic_years and departments.active_term.
 */
async function updateSessionDuration(startDate, endDate, label) {
  if (!startDate || !endDate) {
    throw new Error('Both start_date and end_date are required');
  }
  if (new Date(endDate) <= new Date(startDate)) {
    throw new Error('End date must be strictly after start date');
  }

  const currentAyRow = (await query(`SELECT id, label, start_date, end_date FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];

  let currentAyId;
  let effectiveLabel = label?.trim();

  // If label is not provided or explicitly 'auto', automatically compute institutional label
  if (!effectiveLabel || effectiveLabel.toLowerCase() === 'auto') {
    effectiveLabel = computeAutoSessionLabel(startDate, endDate);
  }

  if (!effectiveLabel) {
    const cfg = await getSessionSettings();
    const resolved = resolveSession(new Date(), cfg.start_month, cfg.start_day);
    effectiveLabel = resolved.session_label;
  }

  await withTransaction(async (conn) => {
    if (currentAyRow) {
      currentAyId = currentAyRow.id;
      await conn.execute(
        `UPDATE academic_years 
         SET start_date = ?, end_date = ?, label = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [startDate, endDate, effectiveLabel, currentAyId]
      );
    } else {
      const res = await conn.query(
        `INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 1)`,
        [effectiveLabel, startDate, endDate]
      );
      currentAyId = res[0]?.insertId ?? res.lastInsertRowid;
      await conn.execute(`UPDATE academic_years SET is_current = 0 WHERE id != ?`, [currentAyId]);
    }

    // Synchronize active_term across all departments
    await conn.execute(
      `UPDATE departments SET active_term = ?, updated_at = CURRENT_TIMESTAMP WHERE active_term != ? OR active_term IS NULL`,
      [effectiveLabel, effectiveLabel]
    );
  });

  return await getSessionStatus();
}

module.exports = {
  computeAutoSessionLabel,
  resolveSession,
  getSessionSettings,
  syncAcademicSession,
  getSessionStatus,
  getActiveSession,
  updateSessionDuration
};

