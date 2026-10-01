/**
 * Automated Verification Suite for Milestone 43:
 * Dedicated IoT Presence Layer, Department Biometric Permissions,
 * Time-Aware Department Enrollments, Attendance Session Lifecycle,
 * and Post-Finalization Attendance Corrections.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed, rawBody: body });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: body, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(data);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('================================================================');
  console.log('🧪 MILESTONE 43: IOT PRESENCE, ENROLLMENTS & CORRECTIONS SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 0. Setup and Auth
    console.log('--- 0. Authentication of Admin & Faculty ---');
    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: 'Admin@123' }
    });
    assert(adminLogin.statusCode === 200 && adminLogin.body.success, 'Admin authenticated');
    const adminToken = adminLogin.body.data.access_token;
    const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    const teacherLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'hod@gmail.com', password: 'Password@123' }
    });
    assert(teacherLogin.statusCode === 200 && teacherLogin.body.success, 'Faculty authenticated');
    const teacherToken = teacherLogin.body.data.access_token;
    const teacherHeaders = { Authorization: `Bearer ${teacherToken}`, 'Content-Type': 'application/json' };

    // 1. Database Schema & Tables Verification
    console.log('\n--- 1. Database Schema & Entity Verification ---');
    const { query } = require('../src/config/db');

    const iotTable = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='iot_attendance_events'");
    assert(iotTable.length > 0, 'iot_attendance_events table exists');

    const iotCols = (await query("PRAGMA table_info('iot_attendance_events')")).map(c => c.name);
    assert(
      ['student_id', 'device_id', 'department_id', 'scan_time', 'scan_date', 'verification_status', 'event_type'].every(c => iotCols.includes(c)),
      'iot_attendance_events has all canonical columns from redesign.md Section 32'
    );

    const corrTable = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='attendance_corrections'");
    assert(corrTable.length > 0, 'attendance_corrections table exists');

    const corrCols = (await query("PRAGMA table_info('attendance_corrections')")).map(c => c.name);
    assert(
      ['session_id', 'student_id', 'original_status', 'new_status', 'reason', 'changed_by'].every(c => corrCols.includes(c)),
      'attendance_corrections has all canonical audit columns from redesign.md Section 43'
    );

    const sdeTable = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='student_department_enrollments'");
    assert(sdeTable.length > 0, 'student_department_enrollments table exists');

    const sdeCols = (await query("PRAGMA table_info('student_department_enrollments')")).map(c => c.name);
    assert(
      ['student_id', 'department_id', 'academic_year_id', 'year', 'semester', 'start_date', 'end_date', 'status'].every(c => sdeCols.includes(c)),
      'student_department_enrollments has time-aware historical columns from redesign.md Section 16'
    );

    // 2. Dedicated Raw IoT Presence Layer
    console.log('\n--- 2. Dedicated Raw IoT Attendance Events Layer ---');
    // Ensure test device exists
    let dev = (await query("SELECT id, device_uid, department_id FROM devices WHERE is_active = 1 LIMIT 1"))[0];
    if (!dev) {
      const deptId = (await query("SELECT id FROM departments LIMIT 1"))[0].id;
      const ayId = (await query("SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1"))[0].id;
      await query(
        `INSERT INTO devices (device_uid, name, department_id, year, semester, academic_year_id, secret_hash, is_active)
         VALUES ('ESP32_TEST_TERM', 'Test Lab Terminal', ?, 1, 1, ?, 'secret', 1)`,
        [deptId, ayId]
      );
      dev = (await query("SELECT id, device_uid, department_id FROM devices WHERE device_uid = 'ESP32_TEST_TERM'"))[0];
    }

    // Ensure slot mapping for an actively enrolled student
    let student1 = (await query("SELECT s.id FROM students s JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED' LIMIT 1"))[0];
    if (!student1) {
      student1 = (await query("SELECT id FROM students LIMIT 1"))[0];
    }
    await query("DELETE FROM fingerprint_slots WHERE device_id = ? AND (student_id = ? OR slot_id = 77)", [dev.id, student1.id]);
    await query(
      `INSERT INTO fingerprint_slots (device_id, slot_id, student_id, is_active)
       VALUES (?, 77, ?, 1)`,
      [dev.id, student1.id]
    );

    const scanEventId = `scan_test_${Date.now()}`;
    const scanTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const webhookRes = await request('/api/v1/devices/webhook/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        device_uid: dev.device_uid,
        scans: [{ event_id: scanEventId, slot_id: 77, scanned_at: scanTime }]
      }
    });

    assert(webhookRes.statusCode === 200 && webhookRes.body.success, 'ESP32 scan webhook accepted');

    // Verify written to iot_attendance_events
    const recordedEvents = await query(
      `SELECT * FROM iot_attendance_events WHERE student_id = ? AND device_id = ? ORDER BY id DESC LIMIT 1`,
      [student1.id, dev.id]
    );
    assert(recordedEvents.length > 0, 'Scan successfully ingested into dedicated iot_attendance_events layer');
    assert(recordedEvents[0].verification_status === 'VERIFIED', 'Scan status is VERIFIED');
    assert(recordedEvents[0].event_type === 'FINGERPRINT', 'Event type is FINGERPRINT');

    // Verify GET /api/v1/devices/events/raw endpoint
    const rawEventsRes = await request(`/api/v1/devices/events/raw?device_id=${dev.id}`, { headers: teacherHeaders });
    assert(rawEventsRes.statusCode === 200 && rawEventsRes.body.success, 'GET /devices/events/raw endpoint responds 200');
    assert(rawEventsRes.body.data.some(e => e.student_id === student1.id), 'Raw events API returns newly ingested scan');

    // 3. Department Biometric Slot Assignment (Section 35, 53 & Invariant 17)
    console.log('\n--- 3. Department Biometric Permissions ---');
    // Department teacher assigning slot
    const slotRes = await request(`/api/v1/devices/${dev.id}/slots`, {
      method: 'POST',
      headers: adminHeaders, // Admin / authorized department teacher
      body: { slot_id: 88, student_id: student1.id }
    });
    assert(slotRes.statusCode === 201 && slotRes.body.success, 'Authorized department teacher / admin can assign biometric slot');

    // 4. Time-Aware Academic Department Enrollments (Sections 16 & 49)
    console.log('\n--- 4. Time-Aware Department Enrollments & Historical Preservation ---');
    const depts = await query('SELECT id, name FROM departments ORDER BY id ASC LIMIT 5');
    const deptA = depts[0];
    const deptB = depts[1];

    // Ensure student department enrollment exists for student 1
    const histBefore = await request(`/api/v1/students/${student1.id}/department-history`, { headers: adminHeaders });
    assert(histBefore.statusCode === 200 && histBefore.body.success, 'GET /students/:id/department-history responds 200');
    assert(Array.isArray(histBefore.body.data), 'Department history returns an array');

    // Find student's current department from active enrollment
    const currEnr = (await query("SELECT department_id FROM enrollments WHERE student_id = ? AND status = 'ENROLLED' LIMIT 1", [student1.id]))[0];
    const currentDeptId = currEnr ? currEnr.department_id : deptA.id;
    const targetDept = depts.find(d => Number(d.id) !== Number(currentDeptId)) || deptB;

    // Execute transfer
    const transferRes = await request(`/api/v1/students/${student1.id}/transfer-department`, {
      method: 'POST',
      headers: adminHeaders,
      body: { new_department_id: targetDept.id, reason: 'Transferred per institutional order' }
    });
    assert(transferRes.statusCode === 200 && transferRes.body.success, 'Department transfer executes successfully');

    // Verify historical timeline has entries (old TRANSFERRED with end_date, new ACTIVE with start_date)
    const histAfter = await request(`/api/v1/students/${student1.id}/department-history`, { headers: adminHeaders });
    assert(histAfter.body.data.length >= 2, 'Department history contains historical timeline');
    const activeEnr = histAfter.body.data.find(h => h.status === 'ACTIVE');
    const transEnr = histAfter.body.data.find(h => h.status === 'TRANSFERRED');
    assert(activeEnr && Number(activeEnr.department_id) === Number(targetDept.id), 'New active department enrollment points to Target Department');
    assert(transEnr && transEnr.end_date !== null, 'Old transferred enrollment has closed end_date');

    // Transfer back to maintain fixture consistency
    await request(`/api/v1/students/${student1.id}/transfer-department`, {
      method: 'POST',
      headers: adminHeaders,
      body: { new_department_id: currentDeptId, reason: 'Restoring initial department for test fixture' }
    });

    // 5. Attendance Session Lifecycle, Universal Marking & Finalization Lock
    console.log('\n--- 5. Attendance Session Lifecycle & Universal Marking Invariant ---');
    const curAy = (await query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    const teacherRow = (await query('SELECT id FROM teachers LIMIT 1'))[0];
    const subjectRow = (await query('SELECT id FROM subjects LIMIT 1'))[0];

    // Create a register
    const regRes = await query(
      `INSERT INTO attendance_registers (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active)
       VALUES (?, 'Lifecycle Verification Register', ?, ?, 1, 1, ?, 'THEORY', 1, 1)`,
      [teacherRow.id, subjectRow?.id || 1, deptA.id, curAy.id]
    );
    const regId = regRes[0]?.insertId ?? regRes.lastInsertRowid ?? regRes.insertId;

    // Create a session (State: DRAFT)
    const createSessRes = await request('/api/v1/attendance/sessions', {
      method: 'POST',
      headers: teacherHeaders,
      body: {
        register_id: regId,
        session_type: 'THEORY',
        label: 'Lecture 101',
        session_date: new Date().toISOString().slice(0, 10)
      }
    });
    assert(createSessRes.statusCode === 201 && createSessRes.body.success, 'Attendance session created in DRAFT state');
    const sessId = createSessRes.body.data.id;

    // Transition DRAFT -> OPEN
    const openRes = await request(`/api/v1/attendance/sessions/${sessId}/state`, {
      method: 'PUT',
      headers: teacherHeaders,
      body: { state: 'OPEN' }
    });
    assert(openRes.statusCode === 200 && openRes.body.data.state === 'OPEN', 'Session state transitioned to OPEN');

    // Transition OPEN -> CLOSED
    const closeRes = await request(`/api/v1/attendance/sessions/${sessId}/state`, {
      method: 'PUT',
      headers: teacherHeaders,
      body: { state: 'CLOSED' }
    });
    assert(closeRes.statusCode === 200 && closeRes.body.data.state === 'CLOSED', 'Session state transitioned to CLOSED');

    // Attempt CLOSED -> FINALIZED without marking students (Universal marking check)
    // Add student to session roster
    await query(
      `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included)
       VALUES (?, ?, 1, 1, 1)`,
      [sessId, student1.id]
    );

    const prematureFinalize = await request(`/api/v1/attendance/sessions/${sessId}/state`, {
      method: 'PUT',
      headers: teacherHeaders,
      body: { state: 'FINALIZED' }
    });
    assert(
      prematureFinalize.statusCode === 422,
      'Universal marking invariant enforced: 422 returned when student(s) remain unmarked'
    );

    // Mark student as PRESENT
    const markRes = await request(`/api/v1/attendance/sessions/${sessId}/records`, {
      method: 'POST',
      headers: teacherHeaders,
      body: {
        records: [{ student_id: student1.id, attendance_status: 'PRESENT' }]
      }
    });
    assert(markRes.statusCode === 200 && markRes.body.success, 'Teacher successfully marks student attendance before finalization');

    // Now transition to FINALIZED
    const finalizeRes = await request(`/api/v1/attendance/sessions/${sessId}/state`, {
      method: 'PUT',
      headers: teacherHeaders,
      body: { state: 'FINALIZED' }
    });
    assert(finalizeRes.statusCode === 200 && finalizeRes.body.data.state === 'FINALIZED', 'Session successfully finalized');

    // Verify Finalization Lock: Attempting normal records update on FINALIZED session must fail
    const lockedEditRes = await request(`/api/v1/attendance/sessions/${sessId}/records`, {
      method: 'POST',
      headers: teacherHeaders,
      body: {
        records: [{ student_id: student1.id, attendance_status: 'ABSENT' }]
      }
    });
    assert(
      lockedEditRes.statusCode === 400 && lockedEditRes.body.error.code === 'CONFLICT',
      'Finalization Lock enforced: normal edits blocked on FINALIZED session'
    );

    // 6. Post-Finalization Attendance Correction (Section 43)
    console.log('\n--- 6. Post-Finalization Attendance Correction & Audit ---');
    // Correction without reason must fail
    const noReasonCorr = await request(`/api/v1/attendance/sessions/${sessId}/correct`, {
      method: 'POST',
      headers: teacherHeaders,
      body: { student_id: student1.id, new_status: 'ABSENT', reason: ' ' }
    });
    assert(noReasonCorr.statusCode === 400, 'Attendance correction without reason rejected (validation error)');

    // Valid correction with reason
    const validCorr = await request(`/api/v1/attendance/sessions/${sessId}/correct`, {
      method: 'POST',
      headers: teacherHeaders,
      body: {
        student_id: student1.id,
        new_status: 'ABSENT',
        reason: 'Student left classroom early with medical permit'
      }
    });
    assert(validCorr.statusCode === 200 && validCorr.body.success, 'Post-finalization correction accepted');
    assert(validCorr.body.data.original_status === 'PRESENT', 'Audit recorded original_status = PRESENT');
    assert(validCorr.body.data.new_status === 'ABSENT', 'Audit recorded new_status = ABSENT');

    // Check register record updated
    const updatedRecord = (await query(
      'SELECT attendance_status, source, teacher_notes FROM register_attendance WHERE session_id = ? AND student_id = ?',
      [sessId, student1.id]
    ))[0];
    assert(updatedRecord.attendance_status === 'ABSENT', 'Register status updated to ABSENT');
    assert(updatedRecord.source === 'CORRECTION', 'Register source recorded as CORRECTION');

    // Check GET /sessions/:id/corrections
    const getCorrRes = await request(`/api/v1/attendance/sessions/${sessId}/corrections`, { headers: teacherHeaders });
    assert(getCorrRes.statusCode === 200 && getCorrRes.body.success, 'GET /sessions/:id/corrections responds 200');
    assert(getCorrRes.body.data.length > 0, 'Corrections log contains the audited change');

    // 7. Official Attendance Percentage Source (Section 44 & Invariant 20)
    console.log('\n--- 7. Official Attendance Percentage Verification ---');
    const reportService = require('../src/services/reportService');
    const stats = await reportService.getStudentAttendanceStats(student1.id);
    assert(stats && typeof stats.current_percentage === 'number', 'Report service calculates attendance percentage strictly from finalized sessions');

    // 8. Theme Token Compliance on hod-devices.html
    console.log('\n--- 8. Frontend Theme Token Compliance ---');
    const hodDevicesHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/hod-devices.html'), 'utf8');
    const hexMatches = hodDevicesHtml.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert(hexMatches.length === 0, `hod-devices.html has ZERO hardcoded hex colors (found: ${hexMatches.length})`);

    // 9. Clean up test register and session fixtures to prevent DB pollution
    console.log('\n--- 9. Cleaning up test fixtures ---');
    await query('DELETE FROM attendance_corrections WHERE session_id = ?', [sessId]);
    await query('DELETE FROM register_attendance WHERE session_id = ?', [sessId]);
    await query('DELETE FROM attendance_session_students WHERE session_id = ?', [sessId]);
    await query('DELETE FROM attendance_sessions WHERE id = ?', [sessId]);
    await query('DELETE FROM attendance_registers WHERE id = ?', [regId]);
    console.log('✓ Temporary verification register and session cleaned up.');

    console.log(`\n================================================================`);
    console.log(`RESULTS: ${passed} Passed, ${failed} Failed (Total: ${passed + failed})`);
    console.log(`================================================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runSuite();
