const { query } = require('../src/config/db');

async function main() {
  const devices = await query('SELECT id, device_uid, status, battery_voltage, battery_pct, wifi_rssi, ip_address, last_heartbeat_at FROM devices');
  console.log('DEVICES:', JSON.stringify(devices, null, 2));

  const cmds = await query('SELECT id, device_id, command_type, status, created_at, updated_at FROM esp32_command_queue ORDER BY id DESC LIMIT 5');
  console.log('COMMANDS:', JSON.stringify(cmds, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
