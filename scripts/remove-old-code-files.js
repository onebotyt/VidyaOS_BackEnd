/**
 * Script to remove old loose .html files from frontend/faculty, student, admin, and login
 * keeping ONLY the modular directory packages (e.g. faculty/registers/index.html).
 */
const fs = require('fs');
const path = require('path');

const sections = ['faculty', 'student', 'admin', 'login'];
const frontendDir = path.join(__dirname, '../../frontend');

let removedCount = 0;

sections.forEach(section => {
  const dir = path.join(frontendDir, section);
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(entry => {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      const filePath = path.join(dir, entry.name);
      fs.unlinkSync(filePath);
      console.log(`🗑️ Removed old file: frontend/${section}/${entry.name}`);
      removedCount++;
    }
  });
});

console.log(`\nSuccessfully removed ${removedCount} old code files! Only modular folder-per-page directories remain.`);
