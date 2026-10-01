const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('🧪 VERIFYING WHATSAPP OTP REGISTRATION DOM & CLIENT LOGIC');
console.log('======================================================\n');

// 1. Read student-register.html
const studentHtmlPath = path.join(__dirname, '../../frontend/login/student-register.html');
const studentHtml = fs.readFileSync(studentHtmlPath, 'utf8');

console.log('1. Checking student-register.html elements & handlers...');
assert(studentHtml.includes('id="reg-email"'), 'student-register.html has #reg-email');
assert(studentHtml.includes('id="reg-phone"'), 'student-register.html has #reg-phone');
assert(studentHtml.includes('id="btn-send-otp"'), 'student-register.html has #btn-send-otp');
assert(studentHtml.includes('id="otp-verified-badge"'), 'student-register.html has #otp-verified-badge');
assert(studentHtml.includes('id="otp-box"'), 'student-register.html has #otp-box');
assert(studentHtml.includes('id="wa-qr-card"'), 'student-register.html has #wa-qr-card');
assert(studentHtml.includes('id="wa-qr-img"'), 'student-register.html has #wa-qr-img');
assert(studentHtml.includes('id="wa-direct-link"'), 'student-register.html has #wa-direct-link');
assert(studentHtml.includes('id="reg-otp"'), 'student-register.html has #reg-otp');
assert(studentHtml.includes('id="btn-verify-otp"'), 'student-register.html has #btn-verify-otp');
assert(studentHtml.includes('id="btn-resend-otp"'), 'student-register.html has #btn-resend-otp');
assert(studentHtml.includes('id="otp-timer"'), 'student-register.html has #otp-timer');
assert(studentHtml.includes('handleSendOtp'), 'student-register.html defines handleSendOtp()');
assert(studentHtml.includes('handleVerifyOtp'), 'student-register.html defines handleVerifyOtp()');
assert(studentHtml.includes('autoFillOtp'), 'student-register.html defines autoFillOtp()');
assert(studentHtml.includes('resetOtpVerification'), 'student-register.html defines resetOtpVerification()');
assert(studentHtml.includes('updateSubmitButtonState'), 'student-register.html defines updateSubmitButtonState()');
assert(studentHtml.includes('otp_verification_token'), 'student-register.html submits otp_verification_token in payload');
assert(studentHtml.includes('WhatsApp Verified via OTP'), 'student-register.html has "WhatsApp Verified via OTP" label');
console.log('✓ PASS: All student registration WhatsApp OTP widgets and methods verified\n');

// 2. Read faculty-register.html
const facultyHtmlPath = path.join(__dirname, '../../frontend/login/faculty-register.html');
const facultyHtml = fs.readFileSync(facultyHtmlPath, 'utf8');

console.log('2. Checking faculty-register.html elements & handlers...');
assert(facultyHtml.includes('id="email"'), 'faculty-register.html has #email');
assert(facultyHtml.includes('id="phone"'), 'faculty-register.html has #phone');
assert(facultyHtml.includes('id="btn-send-otp"'), 'faculty-register.html has #btn-send-otp');
assert(facultyHtml.includes('id="otp-verified-badge"'), 'faculty-register.html has #otp-verified-badge');
assert(facultyHtml.includes('id="otp-box"'), 'faculty-register.html has #otp-box');
assert(facultyHtml.includes('id="wa-qr-card"'), 'faculty-register.html has #wa-qr-card');
assert(facultyHtml.includes('id="wa-qr-img"'), 'faculty-register.html has #wa-qr-img');
assert(facultyHtml.includes('id="wa-direct-link"'), 'faculty-register.html has #wa-direct-link');
assert(facultyHtml.includes('id="faculty-otp"'), 'faculty-register.html has #faculty-otp');
assert(facultyHtml.includes('id="btn-verify-otp"'), 'faculty-register.html has #btn-verify-otp');
assert(facultyHtml.includes('id="btn-resend-otp"'), 'faculty-register.html has #btn-resend-otp');
assert(facultyHtml.includes('id="otp-timer"'), 'faculty-register.html has #otp-timer');
assert(facultyHtml.includes('handleSendOtp'), 'faculty-register.html defines handleSendOtp()');
assert(facultyHtml.includes('handleVerifyOtp'), 'faculty-register.html defines handleVerifyOtp()');
assert(facultyHtml.includes('autoFillOtp'), 'faculty-register.html defines autoFillOtp()');
assert(facultyHtml.includes('resetOtpVerification'), 'faculty-register.html defines resetOtpVerification()');
assert(facultyHtml.includes('updateSubmitButtonState'), 'faculty-register.html defines updateSubmitButtonState()');
assert(facultyHtml.includes('otp_verification_token'), 'faculty-register.html submits otp_verification_token in payload');
assert(facultyHtml.includes('WhatsApp Verified via OTP'), 'faculty-register.html has "WhatsApp Verified via OTP" label');
console.log('✓ PASS: All faculty registration WhatsApp OTP widgets and methods verified\n');

// 3. Scan for hardcoded colors in both files
console.log('3. Verifying Zero Hardcoded Hex Colors...');
const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
const studentHex = studentHtml.match(hexRegex) || [];
const facultyHex = facultyHtml.match(hexRegex) || [];

assert(studentHex.length === 0, `student-register.html has hardcoded hex colors: ${studentHex.join(', ')}`);
assert(facultyHex.length === 0, `faculty-register.html has hardcoded hex colors: ${facultyHex.join(', ')}`);
console.log('✓ PASS: Zero hardcoded hex colors found in student & faculty registration pages\n');

console.log('======================================================');
console.log('Results: All WhatsApp OTP DOM and Client Verifications PASSED ✓');
console.log('======================================================');
