/**
 * Shared Multer Upload Configuration
 * Used by assignments (teacher attachments + student submissions).
 * Accepts common document/slide/spreadsheet/PDF/image formats.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.resolve(process.cwd(), process.env.UPLOADS_DIR))
  : path.join(__dirname, '../../uploads');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv',
  '.txt', '.rtf', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif',
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.json', '.md', '.py', '.java', '.cpp', '.c', '.html', '.css', '.js', '.ts'
];

function makeUploader(subfolder, maxFileSizeMb = 100) {
  const dest = path.join(UPLOAD_ROOT, subfolder);
  ensureDir(dest);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const safeBase = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 60);
      const unique = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
      cb(null, `${safeBase}_${unique}${path.extname(file.originalname).toLowerCase()}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(new Error(`File type ${ext} is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
      }
      cb(null, true);
    }
  });
}

module.exports = { makeUploader, UPLOAD_ROOT, ALLOWED_EXTENSIONS };
