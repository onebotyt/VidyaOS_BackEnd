/**
 * Automated Verification Suite:
 * UBTER 3-Identifier Scheme Integration in Registers Workspace
 * Tab 1: REGISTER (Attendance Matrix, Roll Call Studio, ESP32 Modal)
 * Tab 2: ASSIGNMENT (Coursework & Submissions Table)
 * Tab 3: TEST (Class Tests & Marksheet Spreadsheet Studio)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
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

function makeRequest(pathStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: options.headers || {}
    };

    if (postData) {
      if (typeof postData === 'object' && !Buffer.isBuffer(postData)) {
        postData = JSON.stringify(postData);
        reqOptions.headers['Content-Type'] = 'application/json';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('======================================================');
  console.log('🧪 AUTOMATED TEST: REGISTERS WORKSPACE UBTER UPGRADE');
  console.log('======================================================\n');

  try {
    // 1. Authenticate Faculty
    console.log('1. Authenticating Faculty Teacher...');
    const loginRes = await makeRequest('/api/v1/auth/login', {
      method: 'POST'
    }, {
      email: 'hod@gmail.com',
      password: 'Password@123'
    });

    assert(loginRes.status === 200, 'Faculty login succeeded (200 OK)');
    const token = loginRes.body?.data?.access_token || loginRes.body?.data?.token || loginRes.body?.data?.tokens?.accessToken;
    assert(Boolean(token), 'Received JWT access token for faculty');
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 2. Tab 1 (REGISTER): GET /faculty/registers/:id
    console.log('\n2. Testing Tab 1 (REGISTER) - Attendance Matrix & Roster Projection...');
    const regListRes = await makeRequest('/api/v1/faculty/registers', { headers: authHeaders });
    assert(regListRes.status === 200 && Array.isArray(regListRes.body?.data), 'GET /faculty/registers returned register list');
    const registerId = regListRes.body?.data?.[0]?.id || 1;

    const regRes = await makeRequest(`/api/v1/faculty/registers/${registerId}`, { headers: authHeaders });
    assert(regRes.status === 200, `GET /faculty/registers/${registerId} returned 200 OK`);
    const gridStudents = regRes.body?.data?.grid?.students || [];
    assert(gridStudents.length > 0, `Register grid contains enrolled students (${gridStudents.length} found)`);

    const st1 = gridStudents[0];
    assert(st1.registration_no !== undefined, `gridData.students includes registration_no (got: ${st1.registration_no})`);
    assert(st1.class_roll_no !== undefined, `gridData.students includes class_roll_no (got: ${st1.class_roll_no})`);
    assert(!String(st1.class_roll_no).startsWith('#'), 'class_roll_no does not contain # prefix');
    assert(Boolean(st1.official_enrollment_no), `gridData.students includes official_enrollment_no (got: ${st1.official_enrollment_no})`);

    // 3. Tab 2 (ASSIGNMENT): GET /assignments/:id/submissions
    console.log('\n3. Testing Tab 2 (ASSIGNMENT) - Coursework Submissions Roster...');
    const asgListRes = await makeRequest(`/api/v1/assignments?subject_id=1`, { headers: authHeaders });
    let asgId = asgListRes.body?.data?.[0]?.id;
    if (!asgId) {
      // Create test assignment if none exists
      const createAsgRes = await makeRequest('/api/v1/assignments', {
        method: 'POST',
        headers: authHeaders
      }, {
        title: 'Test Coursework Assignment',
        description: 'Automated verification assignment',
        subject_id: 1,
        department_id: 4,
        branch_id: 4,
        year: 3,
        semester: 5,
        academic_year_id: 1,
        max_marks: 20
      });
      asgId = createAsgRes.body?.data?.id;
    }

    if (asgId) {
      const subRes = await makeRequest(`/api/v1/assignments/${asgId}/submissions`, { headers: authHeaders });
      assert(subRes.status === 200, `GET /assignments/${asgId}/submissions returned 200 OK`);
      const subRoster = subRes.body?.data?.roster || [];
      assert(subRoster.length > 0, `Submissions roster contains students (${subRoster.length} found)`);
      const subSt1 = subRoster[0];
      assert(subSt1.registration_no !== undefined, `Assignment submission student contains registration_no (got: ${subSt1.registration_no})`);
      assert(subSt1.class_roll_no !== undefined, `Assignment submission student contains class_roll_no (got: ${subSt1.class_roll_no})`);
      assert(!String(subSt1.class_roll_no).startsWith('#'), 'Assignment student class_roll_no has no # prefix');
      assert(Boolean(subSt1.official_enrollment_no), `Assignment student contains official_enrollment_no (got: ${subSt1.official_enrollment_no})`);
    } else {
      assert(false, 'Failed to resolve or create assignment for submissions test');
    }

    // 4. Tab 3 (TEST): GET /exams/:id/roster
    console.log('\n4. Testing Tab 3 (TEST) - Class Tests & Marksheet Roster...');
    const examListRes = await makeRequest('/api/v1/exams?subject_id=1', { headers: authHeaders });
    let examId = examListRes.body?.data?.[0]?.id;
    if (!examId) {
      const createExamRes = await makeRequest('/api/v1/exams', {
        method: 'POST',
        headers: authHeaders
      }, {
        name: 'Unit Test 1',
        subject_id: 1,
        department_id: 4,
        branch_id: 4,
        year: 3,
        semester: 5,
        academic_year_id: 1,
        max_marks: 25
      });
      examId = createExamRes.body?.data?.id;
    }

    assert(Boolean(examId), `Resolved test/exam ID (${examId})`);
    const examRosterRes = await makeRequest(`/api/v1/exams/${examId}/roster`, { headers: authHeaders });
    assert(examRosterRes.status === 200, `GET /exams/${examId}/roster returned 200 OK`);
    const examRoster = examRosterRes.body?.data?.roster || [];
    assert(examRoster.length > 0, `Exam roster contains students (${examRoster.length} found)`);
    const examSt1 = examRoster[0];
    assert(examSt1.registration_no !== undefined, `Exam roster student contains registration_no (got: ${examSt1.registration_no})`);
    assert(examSt1.class_roll_no !== undefined, `Exam roster student contains class_roll_no (got: ${examSt1.class_roll_no})`);
    assert(!String(examSt1.class_roll_no).startsWith('#'), 'Exam student class_roll_no has no # prefix');
    assert(Boolean(examSt1.official_enrollment_no), `Exam student contains official_enrollment_no (got: ${examSt1.official_enrollment_no})`);

    // 5. ESP32 Day Scans Endpoint
    console.log('\n5. Testing ESP32 Day Scans Endpoint...');
    const espRes = await makeRequest(`/api/v1/attendance/registers/${registerId}/esp32-day-scans?date=2026-09-20`, { headers: authHeaders });
    assert(espRes.status === 200, 'GET /attendance/registers/:id/esp32-day-scans returned 200 OK');

    // 6. Frontend DOM & Presentation Standards in registers.html
    console.log('\n6. Verifying Frontend DOM & Presentation Standards in registers.html...');
    const registersHtmlPath = path.join(__dirname, '../../frontend/faculty/registers.html');
    const htmlContent = fs.readFileSync(registersHtmlPath, 'utf8');

    // Register Tab Matrix
    assert(htmlContent.includes('cleanRoll'), 'registers.html computes cleanRoll for attendance matrix');
    assert(htmlContent.includes('st.registration_no'), 'registers.html references st.registration_no in matrix student info');
    assert(htmlContent.includes('UBTER Reg:'), 'registers.html includes UBTER Reg in student title/hover attribute');

    // Manual Roll Call & Quick Roster
    assert(htmlContent.includes('Roll ${rollDisplay}'), 'registers.html formats roll as Roll ${rollDisplay} without #');
    assert(htmlContent.includes('st.registration_no ?'), 'registers.html conditionally renders UBTER Reg No on roll call cards');

    // Live Check-In Feed
    assert(htmlContent.includes('Roll ${String(req.class_roll_no).replace(/^#/, \'\')}'), 'registers.html cleans # in live check-in log');
    assert(htmlContent.includes('req.registration_no || req.official_enrollment_no'), 'registers.html displays UBTER Reg No in live check-in feed');

    // Assignment Submissions Table
    assert(htmlContent.includes('<th style="width: 130px;">UBTER Reg No</th>'), 'registers.html submissions table has UBTER Reg No column header');
    assert(htmlContent.includes('r.registration_no || r.official_enrollment_no || \'—\''), 'registers.html submissions table renders registration_no in UBTER Reg cell');

    // Exam Marksheet Spreadsheet Studio
    assert(htmlContent.includes('r.registration_no || r.official_enrollment_no'), 'registers.html exam marksheet renders UBTER Reg No under student name');

    // ESP32 Confirmation Modal
    assert(htmlContent.includes('<th style="width: 130px;">UBTER Reg No</th>'), 'registers.html ESP32 modal table has UBTER Reg No column header');
    assert(htmlContent.includes('s.registration_no || \'—\''), 'registers.html ESP32 modal renders registration_no in UBTER cell');

    // Zero hardcoded hex colors (canonical check matching test-theme-support.js)
    const lines = htmlContent.split('\n');
    let hexFound = 0;
    lines.forEach((l, idx) => {
      if (l.includes('&#') || l.includes('exceljs') || l.includes('xlsx') || l.includes('canvas')) return;
      const matches = l.match(/#[0-9a-fA-F]{3,6}\b/g);
      if (matches) {
        const nonFallback = matches.filter(m => !new RegExp('var\\\\([^)]*' + m + '[^)]*\\\\)').test(l));
        if (nonFallback.length > 0 && /background|color|border|fill|stroke|box-shadow/i.test(l)) {
          hexFound++;
        }
      }
    });
    assert(hexFound === 0, `registers.html has zero hardcoded hex colors (found: ${hexFound})`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
