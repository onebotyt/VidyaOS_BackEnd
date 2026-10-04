/**
 * Automated Verification Suite: Faculty Registration, 3-Tier Approval Workflow,
 * Common Faculty Manager Architecture & 3-Tier Anti-Spam Registration Gates
 *
 * Verifies:
 * - Public Faculty Registration (/api/v1/auth/faculty/register)
 * - 3-Tier Anti-Spam Registration Gates (Admin HOD gate, Admin Common Faculty gate, Dept HOD gate)
 * - Anti-spam gate blocking: 403 REGISTRATION_CLOSED when gates closed or no HOD appointed
 * - Anti-spam gate activation: Admin toggle and HOD toggle
 * - Public Gate Telemetry (/api/v1/auth/registration-gates)
 * - Case A: Department Faculty -> Department HOD approval
 * - Case B: Common Faculty (No Dept) -> Common Faculty Manager approval
 * - Case C: HOD Registration -> System Admin approval & 1-HOD-per-dept invariant
 * - Rejection flows & login blocking (PENDING_APPROVAL / REGISTRATION_REJECTED)
 * - Common Faculty Manager assignment & role authorization
 * - Frontend DOM elements & Theme tokenization (zero hardcoded hex colors)
 * - Complete test teardown & DB sanitization (zero residual test rows)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    testsFailed++;
  }
}

function request(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`);
    const reqOpts = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || data });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function loginFaculty(email, password) {
  const pwd = password || (email.includes('admin') ? 'Admin@123' : 'Password@123');
  return await request('/auth/faculty/login', {
    method: 'POST',
    body: { email, password: pwd, device_id: 'test_fac_' + Date.now() + Math.random(), force_logout: true }
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 FACULTY REGISTRATION, 3-TIER APPROVAL & ANTI-SPAM GATES SUITE');
  console.log('================================================================\n');

  const ts = Date.now();
  let adminToken = null;
  let itHodToken = null;
  let targetDept = null;
  let secondDept = null;
  let testDeptId = null;

  const deptFacultyEmail = `faculty.dept.${ts}@gmail.com`;
  const commonFacultyEmail = `faculty.common.${ts}@gmail.com`;
  const newHodEmail = `new.hod.${ts}@gmail.com`;
  const initialHodEmail = `initial.hod.${ts}@gmail.com`;
  const rejectEmail = `faculty.reject.${ts}@gmail.com`;

  try {
    // ─── 0. Authenticate Default System Roles ─────────────────────
    console.log('--- 0. Authentication of Admin & Department HODs ---');
    
    // Admin login
    const adminLogin = await loginFaculty('admin@gmail.com');
    assert(adminLogin.status === 200 && adminLogin.body.success, 'Admin authenticated successfully');
    adminToken = adminLogin.body.data.access_token;

    // HOD login (Department HOD)
    const hodLogin = await loginFaculty('hod@gmail.com');
    assert(hodLogin.status === 200 && hodLogin.body.success, 'HOD authenticated successfully');
    itHodToken = hodLogin.body.data.access_token;
    const itDeptId = hodLogin.body.data.user.hod_department_id || hodLogin.body.data.user.department_id || 4;

    // Fetch department list using admin hierarchy to obtain two distinct departments
    const hierRes = await request('/admin/hierarchy', { token: adminToken });
    const depts = hierRes.body.data.departments || [];
    assert(depts.length >= 2, 'At least 2 departments exist in database');
    targetDept = depts.find(d => d.id === itDeptId) || depts[0];
    secondDept = depts.find(d => d.id !== targetDept.id && !d.hod_user_id) || depts.find(d => d.id !== targetDept.id) || depts[1];

    // Ensure initial gates are closed for baseline testing
    await request('/admin/registration-gates/toggle', {
      method: 'POST',
      token: adminToken,
      body: { target: 'HOD', open: false }
    });
    await request('/admin/registration-gates/toggle', {
      method: 'POST',
      token: adminToken,
      body: { target: 'COMMON_FACULTY', open: false }
    });
    await request('/hod/faculty-registration-toggle', {
      method: 'POST',
      token: itHodToken,
      body: { open: false }
    });

    // ─── 1. Public Registration Validation & Deduplication ─────────
    console.log('\n--- 1. Public Registration Validation & Deduplication ---');

    // Invalid email format
    const invalidEmail = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Test Invalid',
        email: 'not-an-email',
        password: 'Password@123',
        account_type: 'FACULTY',
        department_id: targetDept.id
      }
    });
    assert(invalidEmail.status === 400, 'Registration rejects invalid email format');

    // Missing department for HOD
    const missingDeptHod = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Test Missing Dept',
        email: `hod.missing.${ts}@gmail.com`,
        password: 'Password@123',
        account_type: 'HOD'
      }
    });
    assert(missingDeptHod.status === 400, 'Registration requires department for HOD account type');

    // Duplicate email check against existing user
    const dupUser = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Duplicate',
        email: 'hod@gmail.com',
        password: 'Password@123',
        account_type: 'FACULTY',
        department_id: targetDept.id
      }
    });
    assert(dupUser.status === 409, 'Registration blocks duplicate email matching existing user');

    // ─── 1.5. Anti-Spam Gate Blocking Checks (Closed by Default) ──
    console.log('\n--- 1.5. Anti-Spam Gate Blocking Verification ---');

    // A. Department faculty registration blocked when HOD has registration closed
    const closedDeptFaculty = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Prof. Blocked Teacher',
        email: `blocked.dept.${ts}@gmail.com`,
        password: 'Password@123',
        account_type: 'FACULTY',
        department_id: targetDept.id
      }
    });
    assert(
      closedDeptFaculty.status === 403 && closedDeptFaculty.body.error?.code === 'REGISTRATION_CLOSED',
      'Department faculty blocked when HOD registration gate is closed (403 REGISTRATION_CLOSED)'
    );
    assert(
      closedDeptFaculty.body.error?.message?.includes('not opened faculty registration'),
      'Rejection notice informs applicant that HOD has not opened faculty registration'
    );

    // B. Department faculty registration blocked when Department has NO active HOD
    if (secondDept && !secondDept.hod_user_id) {
      const noHodDeptFaculty = await request('/auth/faculty/register', {
        method: 'POST',
        body: {
          full_name: 'Prof. No HOD Teacher',
          email: `nohod.dept.${ts}@gmail.com`,
          password: 'Password@123',
          account_type: 'FACULTY',
          department_id: secondDept.id
        }
      });
      assert(
        noHodDeptFaculty.status === 403 && noHodDeptFaculty.body.error?.code === 'REGISTRATION_CLOSED',
        'Department faculty blocked when branch has no active HOD (403 REGISTRATION_CLOSED)'
      );
      assert(
        noHodDeptFaculty.body.error?.message?.includes('No active Head of Department (HOD) is currently appointed'),
        'Rejection notice informs applicant that no active HOD is appointed for that branch'
      );
    }

    // C. Common faculty registration blocked when Admin has it closed
    const closedCommonFaculty = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Prof. Blocked Common',
        email: `blocked.common.${ts}@gmail.com`,
        password: 'Password@123',
        account_type: 'FACULTY',
        department_id: null
      }
    });
    assert(
      closedCommonFaculty.status === 403 && closedCommonFaculty.body.error?.code === 'REGISTRATION_CLOSED',
      'Common faculty blocked when Admin gate is closed (403 REGISTRATION_CLOSED)'
    );
    assert(
      closedCommonFaculty.body.error?.message?.toLowerCase().includes('common faculty'),
      'Rejection notice informs applicant that Common Faculty registration is closed'
    );

    // D. HOD registration blocked when Admin has it closed
    const closedHod = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Blocked HOD',
        email: `blocked.hod.${ts}@gmail.com`,
        password: 'Password@123',
        account_type: 'HOD',
        department_id: targetDept.id
      }
    });
    assert(
      closedHod.status === 403 && closedHod.body.error?.code === 'REGISTRATION_CLOSED',
      'HOD registration blocked when Admin gate is closed (403 REGISTRATION_CLOSED)'
    );
    assert(
      closedHod.body.error?.message?.includes('Head of Department (HOD)'),
      'Rejection notice informs applicant that HOD registration is closed'
    );

    // ─── 1.6. Open Anti-Spam Registration Gates ───────────────────
    console.log('\n--- 1.6. Opening Registration Gates ---');

    // HOD opens faculty registration for target department
    const openDeptRes = await request('/hod/faculty-registration-toggle', {
      method: 'POST',
      token: itHodToken,
      body: { open: true }
    });
    assert(openDeptRes.status === 200 && openDeptRes.body.success, 'Department HOD opens faculty registration gate');
    assert(openDeptRes.body.data?.is_open === true, 'HOD registration gate is now OPEN');

    // Admin opens Common Faculty registration
    const openCommonRes = await request('/admin/registration-gates/toggle', {
      method: 'POST',
      token: adminToken,
      body: { target: 'COMMON_FACULTY', open: true }
    });
    assert(openCommonRes.status === 200 && openCommonRes.body.success, 'Admin opens Common Faculty registration gate');

    // Admin opens HOD registration
    const openHodRes = await request('/admin/registration-gates/toggle', {
      method: 'POST',
      token: adminToken,
      body: { target: 'HOD', open: true }
    });
    assert(openHodRes.status === 200 && openHodRes.body.success, 'Admin opens HOD registration gate');

    // Public endpoint reflects updated gates
    const gatesCheck = await request('/auth/registration-gates');
    assert(gatesCheck.status === 200 && gatesCheck.body.success, 'GET /auth/registration-gates is publicly accessible');
    assert(gatesCheck.body.data?.admin?.hod_registration_open === true, 'Public telemetry shows HOD registration OPEN');
    assert(gatesCheck.body.data?.admin?.common_faculty_registration_open === true, 'Public telemetry shows Common Faculty registration OPEN');
    const targetDeptGate = (gatesCheck.body.data?.departments || []).find(d => d.id === targetDept.id);
    assert(targetDeptGate && targetDeptGate.faculty_registration_open === true, 'Public telemetry shows target department faculty registration OPEN');

    // Helper to get verified registration OTP token
    async function getRegistrationOtp(identifier) {
      const sendRes = await request('/auth/otp/send', { method: 'POST', body: { identifier, purpose: 'REGISTRATION' } });
      const debugOtp = sendRes.body?.data?.debug_otp;
      if (!debugOtp) throw new Error(`Could not get debug_otp for ${identifier}: ${JSON.stringify(sendRes.body)}`);
      const verifyRes = await request('/auth/otp/verify', { method: 'POST', body: { identifier, otp_code: debugOtp, purpose: 'REGISTRATION' } });
      return verifyRes.body?.data?.verification_token;
    }

    // ─── 2. Case A: Department Faculty Registration & HOD Approval ──
    console.log('\n--- 2. Case A: Department Faculty -> HOD Approval Flow ---');

    // Assert invalid phone is rejected with 400
    const invalidPhoneRes = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Prof. Anil Kumar',
        email: deptFacultyEmail,
        password: 'Password@123',
        phone: '12345', // invalid phone
        employee_id: `EMP-D-${ts % 10000}`,
        account_type: 'FACULTY',
        department_id: targetDept.id
      }
    });
    assert(invalidPhoneRes.status === 400 && (invalidPhoneRes.body?.error?.code === 'VALIDATION_ERROR' || invalidPhoneRes.body?.error?.code === 'INVALID_PHONE_FORMAT'), 'Faculty registration with invalid phone rejected with 400');

    const regDeptFaculty = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Prof. Anil Kumar',
        email: deptFacultyEmail,
        password: 'Password@123',
        phone: '9876543210',
        employee_id: `EMP-D-${ts % 10000}`,
        account_type: 'FACULTY',
        department_id: targetDept.id
      }
    });
    assert(regDeptFaculty.status === 201 && regDeptFaculty.body.success, 'Department faculty registered successfully');
    assert(regDeptFaculty.body.data.approval_type === 'DEPT_HOD', 'Department faculty approval type is DEPT_HOD');
    const deptFacultyReqId = regDeptFaculty.body.data.request_id;

    // Cannot log in while pending
    const pendingLogin = await loginFaculty(deptFacultyEmail);
    assert(pendingLogin.status === 403 && pendingLogin.body.error.code === 'PENDING_APPROVAL', 'Login blocked for pending faculty account (403 PENDING_APPROVAL)');

    // Target Dept HOD sees request in queue
    const itPending = await request('/hod/registrations/pending-faculty', { token: itHodToken });
    const inIt = (itPending.body.data || []).some(r => r.id === deptFacultyReqId);
    assert(inIt, 'Department HOD successfully retrieves pending faculty in their department queue');

    // Target Dept HOD approves faculty
    const approveFacultyRes = await request(`/hod/registrations/faculty/${deptFacultyReqId}/approve`, {
      method: 'POST',
      token: itHodToken
    });
    assert(approveFacultyRes.status === 200 && approveFacultyRes.body.success, 'Department HOD approves faculty registration');

    // Approved faculty can now log in
    const approvedLogin = await loginFaculty(deptFacultyEmail);
    assert(approvedLogin.status === 200 && approvedLogin.body.success, 'Approved faculty can now log in successfully');
    assert(approvedLogin.body.data.user.roles.includes('TEACHER'), 'Approved faculty has TEACHER role');
    assert(approvedLogin.body.data.user.department_id === targetDept.id, 'Approved faculty belongs to target department');

    // ─── 3. Case B: Common Faculty & Common Manager Approval ───────
    console.log('\n--- 3. Case B: Common Faculty -> Common Faculty Manager Approval ---');
    
    // Register common faculty (no department)
    const regCommonFaculty = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Prof. Sunita Sharma',
        email: commonFacultyEmail,
        password: 'Password@123',
        phone: '9876543211',
        employee_id: `EMP-COM-${ts % 10000}`,
        account_type: 'FACULTY',
        department_id: null
      }
    });
    assert(regCommonFaculty.status === 201 && regCommonFaculty.body.success, 'Common faculty registered with department_id = null');
    assert(regCommonFaculty.body.data.approval_type === 'COMMON_FACULTY_MANAGER', 'Common faculty approval type is COMMON_FACULTY_MANAGER');
    const commonFacultyReqId = regCommonFaculty.body.data.request_id;

    // Login blocked while pending
    const commonPendingLogin = await loginFaculty(commonFacultyEmail);
    assert(commonPendingLogin.status === 403 && commonPendingLogin.body.error.code === 'PENDING_APPROVAL', 'Common faculty login blocked while pending (403)');

    // Appoint a teacher as Common Faculty Manager
    const teachersRes = await request('/admin/teachers', { token: adminToken });
    assert(teachersRes.status === 200 && teachersRes.body.data.length > 0, 'Admin can list teachers across institution');
    const managerCandidate = teachersRes.body.data[0];

    const appointRes = await request('/admin/common-faculty-manager', {
      method: 'POST',
      token: adminToken,
      body: { teacher_id: managerCandidate.teacher_id }
    });
    assert(appointRes.status === 200 && appointRes.body.success, 'Admin appoints teacher as Common Faculty Manager');

    // Verify appointed manager
    const getManagerRes = await request('/admin/common-faculty-manager', { token: adminToken });
    assert(getManagerRes.status === 200 && getManagerRes.body.data?.teacher_id === managerCandidate.teacher_id, 'GET /admin/common-faculty-manager returns active manager');

    // Manager logs in to verify COMMON_FACULTY_MANAGER role and is_common_faculty_manager flag
    const managerLogin = await loginFaculty(managerCandidate.gmail);
    assert(managerLogin.status === 200, 'Common Faculty Manager can log in');
    assert(managerLogin.body.data.user.roles.includes('COMMON_FACULTY_MANAGER'), 'Manager payload includes COMMON_FACULTY_MANAGER role');
    assert(managerLogin.body.data.user.is_common_faculty_manager === true, 'Manager payload includes is_common_faculty_manager: true');
    const managerToken = managerLogin.body.data.access_token;

    // Manager views pending common requests
    const managerPending = await request('/faculty/common/pending', { token: managerToken });
    assert(managerPending.status === 200, 'Common Faculty Manager can access pending common requests queue');
    const inCommonPending = (managerPending.body.data || []).some(r => r.id === commonFacultyReqId);
    assert(inCommonPending, 'Common faculty candidate is present in Common Faculty Manager queue');

    // Regular non-manager faculty cannot access common queue (RBAC test)
    const unauthorizedCommonAccess = await request('/faculty/common/pending', { token: approvedLogin.body.data.access_token });
    assert(unauthorizedCommonAccess.status === 403, 'Unauthorized teacher denied access to Common Manager queue (403 Forbidden)');

    // Manager approves common faculty
    const approveCommonRes = await request(`/faculty/common/${commonFacultyReqId}/approve`, {
      method: 'POST',
      token: managerToken
    });
    assert(approveCommonRes.status === 200 && approveCommonRes.body.success, 'Common Faculty Manager approves common faculty registration');

    // Approved common faculty can log in
    const commonApprovedLogin = await loginFaculty(commonFacultyEmail);
    assert(commonApprovedLogin.status === 200 && commonApprovedLogin.body.success, 'Approved common faculty can log in');
    assert(commonApprovedLogin.body.data.user.roles.includes('TEACHER'), 'Approved common faculty has TEACHER role');
    assert(commonApprovedLogin.body.data.user.department_id === null, 'Approved common faculty has department_id = NULL (institutional cross-department)');

    // Verify common faculty members list
    const commonMembersRes = await request('/faculty/common/members', { token: managerToken });
    assert(commonMembersRes.status === 200, 'Common members roster accessible');
    const inMembers = (commonMembersRes.body.data || []).some(m => m.gmail === commonFacultyEmail);
    assert(inMembers, 'Newly approved common faculty appears in Common Faculty Members roster');

    // ─── 4. Case C: HOD Registration & 1-HOD-per-Dept Invariant ───
    console.log('\n--- 4. Case C: HOD Registration -> Admin Approval & 1-HOD-per-Dept ---');

    // Create an isolated test department so default institutional HOD accounts remain clean
    const testDeptRes = await request('/admin/departments', {
      method: 'POST',
      token: adminToken,
      body: {
        name: `Department of Innovation ${ts % 10000}`,
        code: `DI${ts % 1000}`
      }
    });
    assert(testDeptRes.status === 201 || testDeptRes.status === 200, 'Created isolated test department for Case C testing');
    testDeptId = testDeptRes.body.data?.department_id || testDeptRes.body.data?.id;

    // Appoint an initial HOD for this test department
    const initHodRes = await request('/admin/hods', {
      method: 'POST',
      token: adminToken,
      body: {
        full_name: 'Dr. Initial Department Lead',
        email: initialHodEmail,
        password: 'Password@123',
        department_id: testDeptId
      }
    });
    assert(initHodRes.status === 201 || initHodRes.status === 200, 'Initial HOD appointed to test department');

    // Initial HOD opens faculty registration on the test department for subsequent rejection testing
    const initHodLogin = await loginFaculty(initialHodEmail);
    assert(initHodLogin.status === 200, 'Initial HOD of test department logs in');
    const initHodToken = initHodLogin.body.data.access_token;
    const openTestDeptReg = await request('/hod/faculty-registration-toggle', {
      method: 'POST',
      token: initHodToken,
      body: { open: true }
    });
    assert(openTestDeptReg.status === 200 && openTestDeptReg.body.data?.is_open === true, 'Initial HOD opens faculty registration for test department');

    // Register prospective replacement HOD for test department
    const regHod = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Vikramaditya Singh',
        email: newHodEmail,
        password: 'Password@123',
        phone: '9876543212',
        employee_id: `HOD-NEW-${ts % 10000}`,
        account_type: 'HOD',
        department_id: testDeptId
      }
    });
    assert(regHod.status === 201 && regHod.body.success, 'HOD registration submitted successfully');
    assert(regHod.body.data.approval_type === 'ADMIN', 'HOD registration approval type is ADMIN');
    const hodReqId = regHod.body.data.request_id;

    // Login blocked while pending
    const hodPendingLogin = await loginFaculty(newHodEmail);
    assert(hodPendingLogin.status === 403 && hodPendingLogin.body.error.code === 'PENDING_APPROVAL', 'Prospective HOD login blocked while pending (403)');

    // Admin views pending HOD queue
    const pendingHodsRes = await request('/admin/registrations/pending-hods', { token: adminToken });
    assert(pendingHodsRes.status === 200, 'Admin retrieves pending HOD registrations queue');
    const pendingHodItem = (pendingHodsRes.body.data || []).find(h => h.id === hodReqId);
    assert(!!pendingHodItem, 'Prospective HOD found in Admin pending queue');
    assert(pendingHodItem && pendingHodItem.current_hod !== null, 'Current HOD detected in pending queue impact analysis (1 HOD Invariant)');

    // Admin approves HOD
    const approveHodRes = await request(`/admin/registrations/hods/${hodReqId}/approve`, {
      method: 'POST',
      token: adminToken
    });
    assert(approveHodRes.status === 200 && approveHodRes.body.success, 'Admin approves prospective HOD');

    // Verify newly approved HOD can log in and has HOD privileges
    const approvedHodLogin = await loginFaculty(newHodEmail);
    assert(approvedHodLogin.status === 200, 'Approved HOD logs in successfully');
    assert(approvedHodLogin.body.data.user.is_hod === true, 'Approved HOD has is_hod = true');
    assert(approvedHodLogin.body.data.user.hod_department_id === testDeptId, 'Approved HOD assigned to target Department');

    // Verify 1-HOD-per-Department: Initial HOD is no longer active HOD for this department
    const initialHodCheck = await loginFaculty(initialHodEmail);
    assert(initialHodCheck.status === 200, 'Prior HOD account remains active as faculty');
    assert(initialHodCheck.body.data.user.is_hod === false, '1-HOD-Per-Department Invariant verified: Prior HOD demoted/deactivated from HOD role');

    // ─── 5. Rejection Flow & Login Blocking ───────────────────────
    console.log('\n--- 5. Rejection Flow & Audit Integrity ---');
    const rejectOtpToken = await getRegistrationOtp(rejectEmail);
    const regReject = await request('/auth/faculty/register', {
      method: 'POST',
      body: {
        full_name: 'Dr. Rejected Candidate',
        email: rejectEmail,
        password: 'Password@123',
        account_type: 'FACULTY',
        department_id: testDeptId,
        otp_verification_token: rejectOtpToken
      }
    });
    assert(regReject.status === 201 && regReject.body.success, 'Registration submitted for candidate in test department');
    const rejectReqId = regReject.body.data.request_id;

    // Newly appointed HOD rejects request with reason
    const newHodToken = approvedHodLogin.body.data.access_token;
    const rejectRes = await request(`/hod/registrations/faculty/${rejectReqId}/reject`, {
      method: 'POST',
      token: newHodToken,
      body: { reason: 'Credentials do not match institutional records.' }
    });
    assert(rejectRes.status === 200 && rejectRes.body.success, 'HOD successfully rejected candidate registration');

    // Rejected candidate receives 403 REGISTRATION_REJECTED with custom reason
    const rejectedLogin = await loginFaculty(rejectEmail);
    assert(rejectedLogin.status === 403 && rejectedLogin.body.error.code === 'REGISTRATION_REJECTED', 'Rejected applicant receives 403 REGISTRATION_REJECTED');
    assert(rejectedLogin.body.error.message.includes('Credentials do not match'), 'Rejection message contains administrator rejection reason');

    // ─── 6. Frontend Tokenization & UI Integrity ──────────────────
    console.log('\n--- 6. Frontend Artifact & Theme Compliance ---');
    const filesToCheck = [
      'frontend/login/faculty-register.html',
      'frontend/admin/faculty.html',
      'frontend/faculty/hod-teachers.html',
      'frontend/faculty/common-teachers.html'
    ];

    for (const f of filesToCheck) {
      const filePath = path.join(__dirname, '../../', f);
      const content = fs.readFileSync(filePath, 'utf8');

      // Check for hardcoded hex colors (# followed by 3, 6, 8 hex digits, excluding HTML entities or comments)
      const cleaned = content.replace(/&#[0-9]{2,4};/g, '').replace(/&[a-zA-Z]+;/g, '');
      const hexMatches = cleaned.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      
      const colorHexMatches = hexMatches.filter(m => {
        return !cleaned.includes(`href="${m}"`) && !cleaned.includes(`id="${m.substring(1)}"`);
      });

      assert(colorHexMatches.length === 0, `Zero hardcoded color hex codes in ${f} (found: ${colorHexMatches.length})`);
    }

    // Verify key DOM elements in faculty-register.html
    const regHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login/faculty-register.html'), 'utf8');
    assert(regHtml.includes('id="btn-type-faculty"'), 'faculty-register.html has Faculty selector button');
    assert(regHtml.includes('id="btn-type-hod"'), 'faculty-register.html has HOD selector button');
    assert(regHtml.includes('id="department_id"'), 'faculty-register.html has Department dropdown');
    assert(regHtml.includes('id="routing-callout"'), 'faculty-register.html has dynamic routing explanation banner');

    // Verify key DOM elements in admin/faculty.html
    const adminHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin/faculty.html'), 'utf8');
    assert(adminHtml.includes('id="admin-reg-gates-card"'), 'admin/faculty.html contains Anti-Spam Gates card');
    assert(adminHtml.includes('id="btn-toggle-hod-gate"'), 'admin/faculty.html contains HOD gate toggle button');
    assert(adminHtml.includes('id="btn-toggle-common-gate"'), 'admin/faculty.html contains Common Faculty gate toggle button');
    assert(adminHtml.includes('id="common-faculty-mgr-card"'), 'admin/faculty.html contains Common Faculty Manager card');
    assert(adminHtml.includes('id="pending-hods-card"'), 'admin/faculty.html contains Pending HOD Registrations card');
    assert(adminHtml.includes('id="approve-hod-modal"'), 'admin/faculty.html contains Approve HOD modal');
    assert(adminHtml.includes('id="appoint-common-mgr-modal"'), 'admin/faculty.html contains Appoint Common Manager modal');

    // Verify key DOM elements in hod-teachers.html
    const hodHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/hod-teachers.html'), 'utf8');
    assert(hodHtml.includes('id="hod-faculty-reg-btn"'), 'hod-teachers.html contains HOD faculty registration toggle button');
    assert(hodHtml.includes('id="pending-faculty-card"'), 'hod-teachers.html contains Pending Faculty Approvals card');
    assert(hodHtml.includes('approveFaculty'), 'hod-teachers.html contains approveFaculty function');
    assert(hodHtml.includes('rejectFaculty'), 'hod-teachers.html contains rejectFaculty function');

    // Verify key DOM elements in common-teachers.html
    const commonHtml = fs.readFileSync(path.join(__dirname, '../../frontend/faculty/common-teachers.html'), 'utf8');
    assert(commonHtml.includes('id="pending-common-card"'), 'common-teachers.html contains Pending Common Faculty card');
    assert(commonHtml.includes('id="active-roster-card"'), 'common-teachers.html contains Active Common Faculty card');

  } catch (err) {
    console.error('Test execution error:', err);
    testsFailed++;
  } finally {
    // ─── 7. Teardown & Database Sanitization ─────────────────────
    console.log('\n--- 7. Teardown & Database Sanitization ---');
    try {
      // 1. Reset Admin gates back to closed
      if (adminToken) {
        await request('/admin/registration-gates/toggle', {
          method: 'POST',
          token: adminToken,
          body: { target: 'HOD', open: false }
        });
        await request('/admin/registration-gates/toggle', {
          method: 'POST',
          token: adminToken,
          body: { target: 'COMMON_FACULTY', open: false }
        });
      }

      // 2. Reset HOD gate back to closed
      if (itHodToken) {
        await request('/hod/faculty-registration-toggle', {
          method: 'POST',
          token: itHodToken,
          body: { open: false }
        });
      }

      // 3. Clean up database fixtures directly via db query
      const { query: dbQuery } = require('../src/config/db');

      // Clear common manager assignments, setting, and roles
      await dbQuery(`DELETE FROM common_faculty_manager_assignments`);
      await dbQuery(`DELETE FROM system_settings WHERE setting_key = 'common_faculty_manager_teacher_id'`);
      await dbQuery(`DELETE FROM user_roles WHERE role = 'COMMON_FACULTY_MANAGER'`);

      // Clean test department if created
      if (testDeptId) {
        await dbQuery(`UPDATE departments SET hod_user_id = NULL WHERE id = ?`, [testDeptId]);
        await dbQuery(`DELETE FROM faculty_registration_requests WHERE department_id = ?`, [testDeptId]);
        await dbQuery(`DELETE FROM teacher_assignments WHERE department_id = ?`, [testDeptId]);
        await dbQuery(`DELETE FROM teachers WHERE department_id = ?`, [testDeptId]);
        await dbQuery(`DELETE FROM system_settings WHERE setting_key = ?`, [`faculty_reg_dept_${testDeptId}`]);
        await dbQuery(`DELETE FROM departments WHERE id = ?`, [testDeptId]);
      }
      
      const testEmails = [
        deptFacultyEmail,
        commonFacultyEmail,
        newHodEmail,
        initialHodEmail,
        rejectEmail,
        `blocked.dept.${ts}@gmail.com`,
        `nohod.dept.${ts}@gmail.com`,
        `blocked.common.${ts}@gmail.com`,
        `blocked.hod.${ts}@gmail.com`
      ].filter(Boolean);

      if (testEmails.length > 0) {
        const placeholders = testEmails.map(() => '?').join(',');
        
        // Find users
        const users = await dbQuery(`SELECT id FROM users WHERE email IN (${placeholders})`, testEmails);
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
          const uPlaceholders = userIds.map(() => '?').join(',');
          const teachers = await dbQuery(`SELECT id FROM teachers WHERE user_id IN (${uPlaceholders})`, userIds);
          const teacherIds = teachers.map(t => t.id);

          if (teacherIds.length > 0) {
            const tPlaceholders = teacherIds.map(() => '?').join(',');
            await dbQuery(`DELETE FROM teacher_assignments WHERE teacher_id IN (${tPlaceholders})`, teacherIds);
            await dbQuery(`DELETE FROM teachers WHERE id IN (${tPlaceholders})`, teacherIds);
          }

          await dbQuery(`DELETE FROM user_roles WHERE user_id IN (${uPlaceholders})`, userIds);
          await dbQuery(`DELETE FROM users WHERE id IN (${uPlaceholders})`, userIds);
        }

        // Clean registration requests
        await dbQuery(`DELETE FROM faculty_registration_requests WHERE email IN (${placeholders})`, testEmails);
      }

      console.log('✓ Teardown complete: All test fixtures, users, gates and test departments sanitized.');
    } catch (cleanErr) {
      console.warn('Note on cleanup error:', cleanErr.message);
    }

    console.log('\n================================================================');
    console.log(`SUMMARY: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  }
}

runTests();
