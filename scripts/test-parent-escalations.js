/**
 * Verification Test: Parent Escalation System (Milestone 48)
 * Verifies:
 * 1. parent_escalation_logs table exists with correct schema
 * 2. defaulterService includes parent_phone in calculated defaulters
 * 3. POST /api/v1/reports/defaulters/escalate-parents (batch WhatsApp/SMS, logging, stats)
 * 4. GET /api/v1/reports/defaulters/generate-whatsapp-link (direct personalized wa.me link)
 * 5. GET /api/v1/reports/defaulters/communication-logs (chronological audit history)
 * 6. UI Token & Component verification in frontend/faculty/reports.html
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { query } = require('../src/config/db');
const jwt = require('jsonwebtoken');

let testsPassed = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const { generateAccessToken } = require('../src/utils/tokenHelper');

function getAuthToken(userId = 2, role = 'TEACHER', departmentId = 4) {
  return generateAccessToken({
    id: userId,
    user_id: userId,
    username: 'hod@gmail.com',
    role: role,
    roles: [role, 'TEACHER', 'FACULTY', 'HOD'],
    department_id: departmentId
  });
}

(async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 MILESTONE 49: PARENT ESCALATION SYSTEM TEST SUITE');
  console.log('======================================================\n');

  try {
    // 1. Database Table Verification
    console.log('1. Database Schema & Migration Checks:');
    const tableInfo = await query("PRAGMA table_info(parent_escalation_logs)");
    it('parent_escalation_logs table exists', () => {
      assert(tableInfo.length > 0, 'parent_escalation_logs table should exist');
    });

    const colNames = tableInfo.map(c => c.name);
    it('parent_escalation_logs has all required audit columns', () => {
      const required = ['id', 'student_id', 'recipient_phone', 'channel', 'template_type', 'message_payload', 'attendance_pct', 'delivery_status', 'faculty_id', 'sent_at'];
      required.forEach(r => {
        assert(colNames.includes(r), `Column ${r} must exist in parent_escalation_logs`);
      });
    });

    // 2. Defaulter Service Parent Phone Enrichment
    console.log('\n2. Defaulter Service Calculation & Parent Phone Check:');
    const { calculateDefaulterList } = require('../src/services/defaulterService');
    const defaulters = await calculateDefaulterList({ threshold: 100 }); // return all to inspect
    it('Defaulter records include parent_phone and student_phone', () => {
      assert(Array.isArray(defaulters), 'calculateDefaulters should return array');
      assert(defaulters.length > 0, 'Should have student defaulters in database');
      const first = defaulters[0];
      assert('parent_phone' in first, 'Defaulter object must contain parent_phone property');
      assert('student_phone' in first, 'Defaulter object must contain student_phone property');
    });

    // Pick a test student with a phone or set one
    const testStudent = defaulters[0];
    await query(`UPDATE students SET parent_phone = '9876543210' WHERE id = ?`, [testStudent.student_id]);

    // 3. API Endpoints Testing
    console.log('\n3. API Route Authentication & Execution:');
    const facultyToken = getAuthToken(1, 'FACULTY', 1);

    await itAsync('GET /api/v1/reports/defaulters/generate-whatsapp-link generates personalized link', async () => {
      const res = await makeRequest(
        'GET',
        `/api/v1/reports/defaulters/generate-whatsapp-link?student_id=${testStudent.student_id}&template_type=ATTENDANCE_CRITICAL`,
        { Authorization: `Bearer ${facultyToken}` }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(res.body.data.whatsapp_url, 'Should return whatsapp_url');
      assert(res.body.data.whatsapp_url.startsWith('https://wa.me/919876543210?text='), 'Should format standard Indian phone with wa.me');
      assert(res.body.data.whatsapp_url.includes(encodeURIComponent(testStudent.student_name)), 'Encoded message should include student name');
    });

    await itAsync('POST /api/v1/reports/defaulters/escalate-parents logs WhatsApp escalation batch', async () => {
      const res = await makeRequest(
        'POST',
        '/api/v1/reports/defaulters/escalate-parents',
        { Authorization: `Bearer ${facultyToken}` },
        {
          studentIds: [testStudent.student_id],
          channel: 'WHATSAPP',
          templateType: 'ATTENDANCE_CRITICAL'
        }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.delivered_count, 1, 'Should deliver to 1 parent');
      assert.strictEqual(res.body.data.skipped_count, 0, 'Should skip 0');
      assert(res.body.data.dispatches.length > 0, 'Should return dispatches array');
      assert(res.body.data.dispatches[0].whatsapp_web_url, 'Dispatch should include whatsapp_web_url');
    });

    await itAsync('POST /api/v1/reports/defaulters/escalate-parents logs SMS escalation batch', async () => {
      const res = await makeRequest(
        'POST',
        '/api/v1/reports/defaulters/escalate-parents',
        { Authorization: `Bearer ${facultyToken}` },
        {
          studentIds: [testStudent.student_id],
          channel: 'SMS',
          templateType: 'ATTENDANCE_WARNING'
        }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.delivered_count, 1);
    });

    await itAsync('GET /api/v1/reports/defaulters/communication-logs retrieves logged dispatches', async () => {
      const res = await makeRequest(
        'GET',
        '/api/v1/reports/defaulters/communication-logs?limit=10',
        { Authorization: `Bearer ${facultyToken}` }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(Array.isArray(res.body.data), 'Logs should be an array');
      assert(res.body.data.length >= 2, 'Should have at least 2 logged dispatches from prior tests');
      const latest = res.body.data[0];
      assert(latest.recipient_phone, 'Log item should have recipient_phone');
      assert(latest.channel, 'Log item should have channel');
      assert(latest.delivery_status, 'Log item should have delivery_status');
    });

    // 4. Frontend UI Token & Component Checks
    console.log('\n4. Frontend UI Components & Token Integrity:');
    const reportsHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/reports.html'), 'utf8');

    it('reports.html contains Parent Escalation Action button', () => {
      assert(reportsHtml.includes('openParentModal()'), 'Should contain openParentModal trigger');
      assert(reportsHtml.includes('Escalate to Parents'), 'Should have Escalate to Parents button text');
    });

    it('reports.html contains Parent Escalation Studio modal (#parent-escalation-modal)', () => {
      assert(reportsHtml.includes('id="parent-escalation-modal"'), 'Should define #parent-escalation-modal');
      assert(reportsHtml.includes('dispatchParentEscalation()'), 'Should have dispatchParentEscalation handler');
    });

    it('reports.html contains Parent Communication History modal (#comm-logs-modal)', () => {
      assert(reportsHtml.includes('id="comm-logs-modal"'), 'Should define #comm-logs-modal');
      assert(reportsHtml.includes('openCommLogsModal()'), 'Should have openCommLogsModal handler');
    });

    it('reports.html contains Direct WhatsApp link button per row', () => {
      assert(reportsHtml.includes('openSingleWhatsApp('), 'Should have openSingleWhatsApp per row');
      assert(reportsHtml.includes('Parent Alert'), 'Should have Parent Alert table column header');
    });

    it('reports.html has zero hardcoded hex colors', () => {
      const hexMatches = reportsHtml.match(/#[0-9a-fA-F]{3,8}/g);
      assert(!hexMatches || hexMatches.length === 0, `Expected 0 hex colors, found: ${hexMatches ? hexMatches.join(', ') : 0}`);
    });

  } catch (err) {
    console.error('Fatal test error:', err);
  } finally {
    console.log('\n======================================================');
    console.log(`Results: ${testsPassed}/${totalTests} Passed (${totalTests - testsPassed} Failed)`);
    console.log('======================================================\n');
    process.exit(totalTests - testsPassed === 0 ? 0 : 1);
  }
})();
