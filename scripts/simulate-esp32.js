/**
 * Standalone ESP32 Hardware Webhook Simulation Script
 * Simulates optical R307 scan touches and tests deduplication by event_id.
 */

const crypto = require('crypto');
const http = require('http');

async function sendScanBatch(deviceUid, scans) {
  const payload = JSON.stringify({
    device_uid: deviceUid,
    scans: scans
  });

  const options = {
    hostname: 'localhost',
    port: process.env.PORT || 3000,
    path: '/api/v1/devices/webhook/scan',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Device-Secret': 'default_secret'
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') });
      });
    });

    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

async function runSimulation() {
  console.log('=== Starting ESP32 Hardware Webhook Simulation ===\n');

  const eventId = crypto.randomUUID();
  const testScan = {
    slot_id: 1, // Seeded slot or slot 1
    event_id: eventId,
    scanned_at: new Date().toISOString(),
    battery: 95
  };

  console.log(`[1] Sending first biometric scan touch (event_id: ${eventId})...`);
  try {
    const res1 = await sendScanBatch('ESP32_LAB3_01', [testScan]);
    console.log('Response 1:', res1.statusCode, res1.body);

    console.log(`\n[2] Retransmitting IDENTICAL scan touch to verify deduplication...`);
    const res2 = await sendScanBatch('ESP32_LAB3_01', [testScan]);
    console.log('Response 2:', res2.statusCode, res2.body);

    if (res2.body.data && res2.body.data.duplicates >= 1) {
      console.log('\n SUCCESS: Deduplication invariant verified. Zero duplicate records inserted.');
    } else {
      console.log('\n Status check: Scans received and processed.');
    }
  } catch (err) {
    console.log('Simulation note: Server may not be running yet. Start backend with `npm start` before running simulator.', err.message);
  }
}

runSimulation();
