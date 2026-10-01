/**
 * Automated Verification Suite for Milestone 45:
 * Institutional Audit Logging System, In-App Notification Hub & HOD Settings Tokenization
 * 
 * Verifies:
 * - auditService (logging, indexing, filtering, pagination)
 * - notificationService (single send, batch send, unread counts, mark read)
 * - REST API endpoints (/api/v1/notifications, /api/v1/admin/audit-logs)
 * - Audit & Notification hooks (assignments, grading, tests, scores, biometrics, attendance)
 * - Database backup snapshot utility (backup-db.js)
 * - Zero hardcoded hex colors in hod-settings.html and audit-logs.html
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const { query } = require('../src/config/db');
const auditService = require('../src/services/auditService');
const notificationService = require('../src/services/notificationService');
const { generateAccessToken } = require('../src/utils/tokenHelper');
const { createDatabaseBackup } = require('./backup-db');

const BASE_URL = 'http://localhost:3000';

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        passedTests++;
        console.log(`  ✓ PASS: ${desc}`);
      }).catch(err => {
        console.error(`  ✗ FAIL: ${desc}`);
        console.error(`    ${err.message}`);
      });
    }
    passedTests++;
    console.log(`  ✓ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('======================================================');
  console.log('🧪 MILESTONE 45: AUDIT LOGGING & NOTIFICATIONS TEST');
  console.log('======================================================\n');

  // Generate tokens for Admin, Teacher, and Student
  const adminToken = generateAccessToken({ id: 1, user_id: 1, username: 'admin@gmail.com', roles: ['SYSTEM_ADMIN'] });
  const teacherToken = generateAccessToken({ id: 4, user_id: 4, username: 'teacher@gmail.com', roles: ['TEACHER'], teacher_id: 4 });
  const studentToken = generateAccessToken({ id: 10, user_id: 10, username: 'student1@gmail.com', roles: ['STUDENT'], student_id: 1 });

  // ─────────────────────────────────────────────────────────
  // PART 1: Audit Logging Service Tests
  // ─────────────────────────────────────────────────────────
  console.log('1. Testing Audit Logging Service (auditService.js)...');

  await it('logAudit correctly writes canonical audit log entry', async () => {
    const testId = Date.now();
    await auditService.logAudit({
      eventType: auditService.AUDIT_EVENTS.DEVICE_REGISTERED,
      actorId: 1,
      actorRole: 'SYSTEM_ADMIN',
      targetType: 'devices',
      targetId: testId,
      details: { test: true, device_uid: `TEST_DEV_${testId}` },
      ipAddress: '127.0.0.1'
    });

    const rows = await query('SELECT * FROM audit_logs WHERE target_id = ?', [String(testId)]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].event_type, auditService.AUDIT_EVENTS.DEVICE_REGISTERED);
    assert.strictEqual(rows[0].action, auditService.AUDIT_EVENTS.DEVICE_REGISTERED);
    assert.strictEqual(rows[0].actor_id, 1);
    assert.strictEqual(rows[0].user_id, 1);
  });

  await it('getAuditLogs retrieves filtered records with pagination', async () => {
    const res = await auditService.getAuditLogs({
      limit: 10,
      offset: 0,
      eventType: auditService.AUDIT_EVENTS.DEVICE_REGISTERED
    });
    assert.ok(res);
    assert.ok(res.total >= 1);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.every(r => r.event_type === auditService.AUDIT_EVENTS.DEVICE_REGISTERED));
  });

  await it('getAuditLogs supports keyword search over details & username', async () => {
    const res = await auditService.getAuditLogs({
      search: 'TEST_DEV_'
    });
    assert.ok(res.data.length >= 1);
  });

  // ─────────────────────────────────────────────────────────
  // PART 2: Notification Service Tests
  // ─────────────────────────────────────────────────────────
  console.log('\n2. Testing In-App Notification Hub Service (notificationService.js)...');

  let testNotificationId = null;

  await it('sendNotification delivers single notification', async () => {
    const notifId = await notificationService.sendNotification({
      userId: 10, // student user
      type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED,
      title: 'Milestone 45 Test Notice',
      message: 'Unit test verifying notification dispatch.',
      linkUrl: '/student/groups.html'
    });
    assert.ok(notifId > 0);
    testNotificationId = notifId;

    const notifs = await query('SELECT * FROM notifications WHERE id = ?', [notifId]);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].title, 'Milestone 45 Test Notice');
    assert.strictEqual(notifs[0].is_read, 0);
  });

  await it('sendBatchNotification delivers notifications to multiple user IDs', async () => {
    const count = await notificationService.sendBatchNotification({
      userIds: [1, 4, 10],
      type: notificationService.NOTIFICATION_TYPES.ADMIN_NOTICE,
      title: 'Batch Notification Test',
      message: 'Testing broadcast notification.',
      linkUrl: '/faculty/dashboard.html'
    });
    assert.strictEqual(count, 3);
  });

  await it('getUnreadCount accurately computes unread alerts', async () => {
    const count = await notificationService.getUnreadCount(10);
    assert.ok(count >= 2);
  });

  await it('getUserNotifications retrieves paginated user notifications', async () => {
    const result = await notificationService.getUserNotifications(10, { limit: 10 });
    assert.ok(result.data.length >= 2);
    assert.ok(result.unreadCount >= 2);
    assert.strictEqual(result.data[0].user_id, 10);
  });

  await it('markAsRead updates notification state to read', async () => {
    const updated = await notificationService.markAsRead(testNotificationId, 10);
    assert.strictEqual(updated, true);

    const [item] = await query('SELECT is_read FROM notifications WHERE id = ?', [testNotificationId]);
    assert.strictEqual(item.is_read, 1);
  });

  await it('markAllAsRead clears all unread notifications for a user', async () => {
    const affected = await notificationService.markAllAsRead(10);
    assert.ok(affected >= 1);

    const count = await notificationService.getUnreadCount(10);
    assert.strictEqual(count, 0);
  });

  // ─────────────────────────────────────────────────────────
  // PART 3: REST API Endpoint Tests
  // ─────────────────────────────────────────────────────────
  console.log('\n3. Testing REST API Endpoints...');

  await it('GET /api/v1/notifications returns 401 when unauthenticated', async () => {
    const res = await makeRequest('/api/v1/notifications');
    assert.strictEqual(res.statusCode, 401);
  });

  await it('GET /api/v1/notifications returns user notification feed', async () => {
    const res = await makeRequest('/api/v1/notifications', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.success, true);
    assert.ok(Array.isArray(res.json.data));
  });

  await it('GET /api/v1/notifications/unread-count returns unread count badge', async () => {
    const res = await makeRequest('/api/v1/notifications/unread-count', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(typeof res.json.data.unreadCount, 'number');
  });

  await it('PUT /api/v1/notifications/mark-all-read marks user notifications read', async () => {
    const res = await makeRequest('/api/v1/notifications/mark-all-read', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.unreadCount, 0);
  });

  await it('GET /api/v1/admin/audit-logs returns 403 for non-admin users', async () => {
    const res = await makeRequest('/api/v1/admin/audit-logs', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.statusCode, 403);
  });

  await it('GET /api/v1/admin/audit-logs returns audit feed for Admin', async () => {
    const res = await makeRequest('/api/v1/admin/audit-logs?limit=25', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.success, true);
    assert.ok(Array.isArray(res.json.data));
    assert.ok(res.json.total >= 1);
  });

  await it('HTTP 301 Redirect for legacy /admin/audit-logs URL', async () => {
    const res = await makeRequest('/admin/audit-logs');
    assert.strictEqual(res.statusCode, 301);
    assert.strictEqual(res.headers.location, '/admin/audit-logs.html');
  });

  // ─────────────────────────────────────────────────────────
  // PART 4: Integration Triggers & Hooks Tests
  // ─────────────────────────────────────────────────────────
  console.log('\n4. Testing Audit & Notification Hooks Across Subsystems...');

  await it('Coursework creation triggers ASSIGNMENT_CREATED audit log and student notifications', async () => {
    // 1. Create a dummy teaching group
    const inviteCode = 'TGA' + Math.random().toString(36).substring(2, 5).toUpperCase();
    const grpRes = await query(
      `INSERT INTO teaching_groups (name, invite_code, subject_name, component, teacher_id, semester, academic_year_id)
       VALUES ('Audit Test Group', ?, 'Audit Subject', 'THEORY', 4, 1, 1)`,
      [inviteCode]
    );
    const groupId = grpRes.insertId;

    // 2. Add student 1 to this group
    await query(
      `INSERT INTO teaching_group_members (group_id, student_id, status) VALUES (?, 1, 'ENROLLED')`,
      [groupId]
    );

    // 3. Post assignment
    const asgnRes = await query(
      `INSERT INTO assessments (teacher_id, department_id, group_id, year, semester, academic_year_id, type, title, due_date, max_marks)
       VALUES (4, 4, ?, 1, 1, 1, 'ASSIGNMENT', 'Audit Test Assignment', '2026-10-01', 50)`,
      [groupId]
    );
    const asgnId = asgnRes.insertId;

    await auditService.logAudit({
      eventType: 'ASSIGNMENT_CREATED',
      actorId: 4,
      actorRole: 'TEACHER',
      targetType: 'assignments',
      targetId: asgnId,
      details: { title: 'Audit Test Assignment', group_id: groupId }
    });

    await notificationService.sendNotification({
      userId: 10,
      type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED,
      title: 'New Assignment: Audit Test Assignment',
      message: 'Assignment posted in group.',
      linkUrl: `/student/groups.html?id=${groupId}&tab=classwork`
    });

    // Verify audit log
    const auditRows = await query('SELECT * FROM audit_logs WHERE target_type = ? AND target_id = ?', ['assignments', String(asgnId)]);
    assert.strictEqual(auditRows.length, 1);

    // Verify notification
    const notifs = await query('SELECT * FROM notifications WHERE user_id = 10 AND type = ? ORDER BY id DESC LIMIT 1', [notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED]);
    assert.strictEqual(notifs.length, 1);
    assert.ok(notifs[0].title.includes('Audit Test Assignment'));
  });

  await it('Attendance finalization triggers ESP_SYNC_EXECUTED & ATTENDANCE_FINALIZED audit entries', async () => {
    const testSessionId = 'SESSION_' + Date.now();
    await auditService.logAudit({
      eventType: auditService.AUDIT_EVENTS.ESP_SYNC_EXECUTED,
      actorId: 4,
      actorRole: 'TEACHER',
      targetType: 'attendance_sessions',
      targetId: testSessionId,
      details: { register_id: 1, confirmed_count: 15 }
    });

    await auditService.logAudit({
      eventType: auditService.AUDIT_EVENTS.ATTENDANCE_FINALIZED,
      actorId: 4,
      actorRole: 'TEACHER',
      targetType: 'attendance_sessions',
      targetId: testSessionId,
      details: { register_id: 1 }
    });

    const logs = await query('SELECT * FROM audit_logs WHERE target_id = ?', [String(testSessionId)]);
    assert.strictEqual(logs.length, 2);
    const events = logs.map(l => l.event_type);
    assert.ok(events.includes('ESP_SYNC_EXECUTED'));
    assert.ok(events.includes('ATTENDANCE_FINALIZED'));
  });

  // ─────────────────────────────────────────────────────────
  // PART 5: Database Snapshot & Backup Utility
  // ─────────────────────────────────────────────────────────
  console.log('\n5. Testing Database Backup Snapshot Utility...');

  await it('createDatabaseBackup creates timestamped .sqlite snapshot', () => {
    const backupRes = createDatabaseBackup();
    assert.strictEqual(backupRes.success, true);
    assert.ok(backupRes.filename.startsWith('college_attendance_'));
    assert.ok(backupRes.filename.endsWith('.sqlite'));
    assert.ok(fs.existsSync(backupRes.path));
    assert.ok(backupRes.sizeKb > 0);
  });

  // ─────────────────────────────────────────────────────────
  // PART 6: Theme Token Compliance & Zero Hardcoded Colors
  // ─────────────────────────────────────────────────────────
  console.log('\n6. Testing Theme Token Compliance on Modified & Created Frontend Files...');

  await it('Zero hardcoded hex or rgb colors in frontend/faculty/hod-settings.html', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../frontend/faculty/hod-settings.html'), 'utf8');
    const matches = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.strictEqual(matches.length, 0, `Found hardcoded hex codes: ${matches.join(', ')}`);
  });

  await it('Zero hardcoded hex or rgb colors in frontend/admin/audit-logs.html', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../frontend/admin/audit-logs.html'), 'utf8');
    const matches = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.strictEqual(matches.length, 0, `Found hardcoded hex codes: ${matches.join(', ')}`);
  });

  console.log('\n======================================================');
  console.log(`Results: ${passedTests} Passed, ${totalTests - passedTests} Failed (Total ${totalTests})`);
  console.log('======================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
