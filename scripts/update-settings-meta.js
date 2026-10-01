const { query } = require('../src/config/db');

async function updateSettings() {
  const updates = [
    ['institution_name', 'Government Polytechnic College', 'Official college name displayed on reports and registers'],
    ['institution_code', 'GP-UBTER-101', 'Institutional accreditation and college code'],
    ['affiliating_body', 'UBTER (Uttarakhand Board of Technical Education) / IRDT', 'Affiliating state technical board and curriculum directorate'],
    ['campus_location', 'Uttarakhand, India', 'Campus location and region'],
    ['default_attendance_threshold_percent', '75', 'Minimum attendance percentage required for examination eligibility'],
    ['attendance_threshold', '75', 'Minimum attendance percentage required for examination eligibility'],
    ['defaulter_warning_threshold_percent', '65', 'Warning threshold percentage before student is marked as chronic defaulter'],
    ['self_attendance_default_timer_minutes', '15', 'Default expiration timer for dynamic QR code and 6-digit PIN attendance sessions'],
    ['max_session_duration_hours', '3', 'Automatic timeout period to auto-close inactive live attendance sessions'],
    ['esp32_scan_debounce_seconds', '60', 'Biometric hardware duplicate touch debounce window in seconds'],
    ['allow_student_self_registration', 'true', 'Global portal switch allowing student self-registration subject to Class Teacher approval'],
    ['auto_session_enabled', 'true', 'Autonomous background engine for automated academic session rollover']
  ];

  for (const [k, v, desc] of updates) {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by) VALUES (?, ?, ?, 1)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, description = excluded.description, updated_at = CURRENT_TIMESTAMP`,
      [k, v, desc]
    );
  }

  const rows = await query("SELECT setting_key, setting_value, description FROM system_settings WHERE setting_key IN ('institution_name', 'institution_code', 'affiliating_body', 'default_attendance_threshold_percent', 'attendance_threshold')");
  console.log('Successfully updated system settings:');
  rows.forEach(r => console.log(`   ${r.setting_key}: ${r.setting_value}`));
}

updateSettings().catch(console.error);
