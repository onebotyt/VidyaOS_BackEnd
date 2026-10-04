/**
 * Verification test for Roll Call upgrade (Manual, QR, PIN) and removal of "+ Add Class"
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function testRollCallUpgrade() {
  console.log('--- Testing Roll Call Studio & Add Class Removal ---');

  // 1. Verify frontend/faculty/registers.html
  const htmlPath = path.join(__dirname, '../../frontend/faculty/registers.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Check + Add Class button is removed from esp-toolbar
  assert(!html.includes('>+ Add Class<'), '"+ Add Class" button must be removed from toolbar');
  console.log('✓ "+ Add Class" button successfully removed');

  // Check Roll Call Studio elements
  assert(html.includes('id="rc-tab-btn-manual"'), 'Must have Manual Roll Call tab button');
  assert(html.includes('id="rc-tab-btn-live"'), 'Must have Unified Live QR & PIN tab button');
  console.log('✓ Roll Call Studio tab buttons present');

  assert(html.includes('id="rc-view-manual"'), 'Must have Manual subview container');
  assert(html.includes('id="rc-view-live"'), 'Must have Unified Live QR & PIN subview container');
  console.log('✓ Roll Call Studio subviews present');

  assert(html.includes('id="rc-qr-code-img"'), 'Must have QR Code image element');
  assert(html.includes('id="rc-qr-pin-display"'), 'Must have QR PIN display element');
  assert(html.includes('id="rc-qr-token-display"'), 'Must have QR Token display element');
  assert(html.includes('id="rc-claim-count"'), 'Must have Live Check-In counter');
  assert(html.includes('id="rc-claims-roster"'), 'Must have Live Student Check-In Log roster');
  console.log('✓ Dynamic QR, PIN display, and Live Check-In Log roster present');

  // Check JS functions
  assert(html.includes('switchRollCallMode'), 'Must define switchRollCallMode function');
  assert(html.includes('generateNewQr'), 'Must define generateNewQr function');
  assert(html.includes('generateNewPin'), 'Must define generateNewPin function');
  assert(html.includes('copyPinCode'), 'Must define copyPinCode function');
  assert(html.includes('copyQrToken'), 'Must define copyQrToken function');
  assert(html.includes('finalizeClaimsAttendance'), 'Must define finalizeClaimsAttendance function');
  console.log('✓ All Roll Call Studio JS controllers present');

  // 2. Test Backend API session PIN and QR generation
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'hod@gmail.com',
      password: 'Password@123',
      device_id: 'test_roll_call_dev',
      force_logout: true
    })
  });
  const loginData = await loginRes.json();
  assert(loginRes.ok && loginData.success, 'Faculty login must succeed');
  const token = loginData.data?.access_token || loginData.data?.token;

  // Test PIN generation on session 1
  const pinRes = await fetch('http://localhost:3000/api/v1/attendance/sessions/1/pin', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const pinData = await pinRes.json();
  assert(pinRes.ok && pinData.success, 'POST /sessions/1/pin must succeed');
  assert(pinData.data?.pin && pinData.data.pin.length === 6, 'Generated PIN must be 6 digits');
  console.log(`✓ Generated 6-digit session PIN: ${pinData.data.pin}`);

  // Test QR generation on session 1
  const qrRes = await fetch('http://localhost:3000/api/v1/attendance/sessions/1/qr', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const qrData = await qrRes.json();
  assert(qrRes.ok && qrData.success, 'POST /sessions/1/qr must succeed');
  assert(qrData.data?.token_hash && qrData.data.payload, 'Generated QR must include token_hash and payload');
  console.log(`✓ Generated dynamic QR token: ${qrData.data.token_hash.slice(0, 16)}...`);

  console.log('\nAll Roll Call Studio & Add Class Removal checks PASSED!');
}

testRollCallUpgrade().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
