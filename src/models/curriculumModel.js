/**
 * Curriculum Model — IRDT Uttarakhand Polytechnic
 * Data access and schema operations for curriculum and syllabus schemes.
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

const IRDT_BOOKLETS = {
  new: {
    label: '2026-27 (New Scheme)',
    base_url: 'https://irdtuttarakhand.org.in/irdt1/uploads/syllabus/',
    departments: {
      CE:    { file: '2627-02 Civil Engineering Booklet Final.pdf',       title: 'Civil Engineering — Syllabus 2026-27' },
      EE:    { file: '2627-08 Electrical Engineering Book Final.pdf',     title: 'Electrical Engineering — Syllabus 2026-27' },
      ECE:   { file: '26-27-9 Electronics Engineering Booklet Final.pdf', title: 'Electronics Engineering — Syllabus 2026-27' },
      IT:    { file: '2627-12 Information Technology Booklet Final.pdf',  title: 'Information Technology — Syllabus 2026-27' },
      ME:    { file: '2627-14 Mechanical Engineering Booklet.pdf',        title: 'Mechanical Engineering — Syllabus 2026-27' },
      PHARM: { url: 'https://www.pci.nic.in/PciPdf/Education/ER-2020.pdf', title: 'D.Pharm — PCI ER-2020 Syllabus' }
    }
  },
  old: {
    label: '2019-20 (Old Scheme)',
    base_url: 'https://irdtuttarakhand.org.in/irdt1/uploads/syllabus/',
    departments: {
      COMMON: { file: 'COMMON SYLLABUS (I & II Sem.) (2019-20).pdf',     title: 'Common Syllabus Sem I & II (2019-20)' },
      CE:     { file: 'CE-2019-20.pdf',                                   title: 'Civil Engineering — Syllabus 2019-20' },
      EE:     { file: 'EE-2019-20.pdf',                                   title: 'Electrical Engineering — Syllabus 2019-20' },
      ECE:    { file: 'ECE-2019-20.pdf',                                  title: 'Electronics Engineering — Syllabus 2019-20' },
      IT:     { file: 'IT-2019-20.pdf',                                   title: 'Information Technology — Syllabus 2019-20' },
      ME:     { file: 'ME-2019-20.pdf',                                   title: 'Mechanical Engineering — Syllabus 2019-20' }
    }
  }
};

/**
 * Resolves the official online URL for an IRDT syllabus booklet PDF.
 * 
 * @calledBy CurriculumController.getBookletByDept() (controllers/curriculumController.js)
 * @calledBy CurriculumModel.getBookletRegistry() (models/curriculumModel.js)
 * @route GET /api/v1/curriculum/booklets/:deptCode (routes/curriculum.js)
 * @param {string} deptCode Department code (CE, EE, ECE, IT, ME, PHARM)
 * @param {string} scheme 'new' (2026-27) or 'old' (2019-20)
 * @returns {string|null} Full PDF URI or null if not found
 */
function getBookletUrl(deptCode, scheme = 'new') {
  const catalog = IRDT_BOOKLETS[scheme];
  if (!catalog) return null;
  const entry = catalog.departments[deptCode.toUpperCase()];
  if (!entry) return null;
  if (entry.url) return entry.url;
  return catalog.base_url + encodeURIComponent(entry.file);
}

/**
 * Compiles the entire booklet registry for all departments across old and new schemes.
 * 
 * @calledBy CurriculumController.getBooklets() (controllers/curriculumController.js)
 * @route GET /api/v1/curriculum/booklets (routes/curriculum.js)
 * @returns {Array<Object>} Array of department syllabus booklet mappings
 */
function getBookletRegistry() {
  const codes = ['CE', 'EE', 'ECE', 'IT', 'ME', 'PHARM'];
  return codes.map(code => ({
    dept_code: code,
    new_scheme: {
      label: IRDT_BOOKLETS.new.label,
      url:   getBookletUrl(code, 'new'),
      title: IRDT_BOOKLETS.new.departments[code] ? IRDT_BOOKLETS.new.departments[code].title : null
    },
    old_scheme: {
      label: IRDT_BOOKLETS.old.label,
      url:   getBookletUrl(code, 'old'),
      title: IRDT_BOOKLETS.old.departments[code] ? IRDT_BOOKLETS.old.departments[code].title : null
    }
  }));
}

/**
 * Migration helper to ensure the syllabus_scheme column exists in the subjects table.
 * 
 * @calledBy CurriculumController.seedCurriculum() (controllers/curriculumController.js)
 * @calledBy server.js startServer()
 * @route POST /api/v1/curriculum/seed (routes/curriculum.js)
 */
async function ensureSyllabusSchemeColumn() {
  try {
    const isMysql = (process.env.DB_CLIENT || '').toLowerCase() === 'mysql';
    if (isMysql) {
      await query("ALTER TABLE subjects ADD COLUMN syllabus_scheme VARCHAR(50) DEFAULT '2026-27'");
    } else {
      await query("ALTER TABLE subjects ADD COLUMN syllabus_scheme TEXT DEFAULT '2026-27'");
    }
    logger.info('[CurriculumModel] Added syllabus_scheme column to subjects table.');
  } catch (err) {
    if (!/duplicate column|already exists|ER_DUP_FIELDNAME/i.test(err.message)) {
      logger.warn('[CurriculumModel] Could not add syllabus_scheme column:', { error: err.message });
    }
  }
}

module.exports = {
  IRDT_BOOKLETS,
  getBookletUrl,
  getBookletRegistry,
  ensureSyllabusSchemeColumn
};
