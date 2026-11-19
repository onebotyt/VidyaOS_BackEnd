const { SerialPort } = require('e:/uiap/VidyaOS/backend/node_modules/serialport');

// If serialport is not installed in backend, test if it exists or use PowerShell
async function run() {
  try {
    const port = new SerialPort({ path: 'COM5', baudRate: 115200 });
    console.log('Opened COM5 at 115200');
    port.on('data', data => {
      process.stdout.write(data.toString());
    });
    setTimeout(() => {
      port.close();
      process.exit(0);
    }, 10000);
  } catch (err) {
    console.error('SerialPort error:', err.message);
    process.exit(1);
  }
}

run();
