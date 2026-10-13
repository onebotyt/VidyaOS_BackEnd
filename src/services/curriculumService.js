/**
 * Curriculum Service — IRDT Uttarakhand Polytechnic
 *
 * Master registry of official IRDT Booklets (New 2026-27 & Old 2019-20) and
 * pre-seeded subject lists for all 6 institutional departments:
 *   CE  – Civil Engineering
 *   EE  – Electrical Engineering
 *   ECE – Electronics Engineering
 *   IT  – Information Technology
 *   ME  – Mechanical Engineering
 *   PHARM – Pharmacy (D.Pharm)
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Official IRDT Booklet Registry
// ─────────────────────────────────────────────────────────────────────────────
const IRDT_BOOKLETS = {
  new: {
    label: '2026-27 (New Scheme)',
    base_url: 'https://irdtuttarakhand.org.in/irdt1/uploads/syllabus/',
    departments: {
      CE:    { file: '2627-02 Civil Engineering Booklet Final.pdf',          title: 'Civil Engineering — Syllabus 2026-27' },
      EE:    { file: '2627-08 Electrical Engineering Book Final.pdf',        title: 'Electrical Engineering — Syllabus 2026-27' },
      ECE:   { file: '26-27-9 Electronics Engineering Booklet Final.pdf',    title: 'Electronics Engineering — Syllabus 2026-27' },
      IT:    { file: '2627-12 Information Technology Booklet Final.pdf',     title: 'Information Technology — Syllabus 2026-27' },
      ME:    { file: '2627-14 Mechanical Engineering Booklet.pdf',           title: 'Mechanical Engineering — Syllabus 2026-27' },
      PHARM: { url: 'https://www.pci.nic.in/PciPdf/Education/ER-2020.pdf',  title: 'D.Pharm — PCI ER-2020 Syllabus' }
    }
  },
  old: {
    label: '2019-20 (Old Scheme)',
    base_url: 'https://irdtuttarakhand.org.in/irdt1/uploads/syllabus/',
    departments: {
      COMMON: { file: 'COMMON SYLLABUS (I & II Sem.) (2019-20).pdf',        title: 'Common Syllabus Sem I & II (2019-20)' },
      CE:     { file: 'CE-2019-20.pdf',                                      title: 'Civil Engineering — Syllabus 2019-20' },
      EE:     { file: 'EE-2019-20.pdf',                                      title: 'Electrical Engineering — Syllabus 2019-20' },
      ECE:    { file: 'ECE-2019-20.pdf',                                     title: 'Electronics Engineering — Syllabus 2019-20' },
      IT:     { file: 'IT-2019-20.pdf',                                      title: 'Information Technology — Syllabus 2019-20' },
      ME:     { file: 'ME-2019-20.pdf',                                      title: 'Mechanical Engineering — Syllabus 2019-20' }
    }
  }
};

function getBookletUrl(deptCode, scheme) {
  if (!scheme) scheme = 'new';
  const catalog = IRDT_BOOKLETS[scheme];
  if (!catalog) return null;
  const entry = catalog.departments[deptCode.toUpperCase()];
  if (!entry) return null;
  if (entry.url) return entry.url;
  return catalog.base_url + encodeURIComponent(entry.file);
}

function getBookletRegistry() {
  const codes = ['CE', 'EE', 'ECE', 'IT', 'ME', 'PHARM'];
  return codes.map(function(code) {
    return {
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
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Common Sem 1 & 2 subjects shared by all Engineering branches
// ─────────────────────────────────────────────────────────────────────────────
const COMMON_ENGG = [
  { code: 'CM101', name: 'Communication Skills in English',       year: 1, semester: 1, has_practical: 0 },
  { code: 'CM102', name: 'Engineering Mathematics - I',           year: 1, semester: 1, has_practical: 0 },
  { code: 'CM103', name: 'Engineering Physics',                   year: 1, semester: 1, has_practical: 1 },
  { code: 'CM104', name: 'Engineering Chemistry',                 year: 1, semester: 1, has_practical: 1 },
  { code: 'CM105', name: 'Engineering Drawing',                   year: 1, semester: 1, has_practical: 1 },
  { code: 'CM106', name: 'Workshop Practice',                     year: 1, semester: 1, has_practical: 1 },
  { code: 'CM201', name: 'Engineering Mathematics - II',          year: 1, semester: 2, has_practical: 0 },
  { code: 'CM202', name: 'Basic Electrical Engineering',          year: 1, semester: 2, has_practical: 1 },
  { code: 'CM203', name: 'Basic Electronics Engineering',         year: 1, semester: 2, has_practical: 1 },
  { code: 'CM204', name: 'Computer Fundamentals & Programming',   year: 1, semester: 2, has_practical: 1 },
  { code: 'CM205', name: 'Environmental Studies',                 year: 1, semester: 2, has_practical: 0 },
  { code: 'CM206', name: 'Physical Education & Life Skills',      year: 1, semester: 2, has_practical: 0 }
];

const CE_SUBJECTS = COMMON_ENGG.concat([
  { code: 'CE301', name: 'Surveying - I',                         year: 2, semester: 3, has_practical: 1 },
  { code: 'CE302', name: 'Building Materials & Construction',     year: 2, semester: 3, has_practical: 1 },
  { code: 'CE303', name: 'Fluid Mechanics',                       year: 2, semester: 3, has_practical: 1 },
  { code: 'CE304', name: 'Strength of Materials',                 year: 2, semester: 3, has_practical: 0 },
  { code: 'CE305', name: 'Concrete Technology',                   year: 2, semester: 3, has_practical: 1 },
  { code: 'CE306', name: 'Engineering Mathematics - III',         year: 2, semester: 3, has_practical: 0 },
  { code: 'CE401', name: 'Surveying - II',                        year: 2, semester: 4, has_practical: 1 },
  { code: 'CE402', name: 'Structural Analysis',                   year: 2, semester: 4, has_practical: 0 },
  { code: 'CE403', name: 'Water Supply Engineering',              year: 2, semester: 4, has_practical: 1 },
  { code: 'CE404', name: 'Highway Engineering',                   year: 2, semester: 4, has_practical: 1 },
  { code: 'CE405', name: 'Irrigation Engineering',                year: 2, semester: 4, has_practical: 0 },
  { code: 'CE406', name: 'Computer Aided Civil Drafting',         year: 2, semester: 4, has_practical: 1 },
  { code: 'CE501', name: 'Design of Steel Structures',            year: 3, semester: 5, has_practical: 0 },
  { code: 'CE502', name: 'Design of RCC Structures',              year: 3, semester: 5, has_practical: 0 },
  { code: 'CE503', name: 'Wastewater Engineering',                year: 3, semester: 5, has_practical: 1 },
  { code: 'CE504', name: 'Foundation Engineering',                year: 3, semester: 5, has_practical: 0 },
  { code: 'CE505', name: 'Building Drawing & Estimation',         year: 3, semester: 5, has_practical: 1 },
  { code: 'CE506', name: 'Project Work - I',                      year: 3, semester: 5, has_practical: 1 },
  { code: 'CE601', name: 'Construction Management',               year: 3, semester: 6, has_practical: 0 },
  { code: 'CE602', name: 'Quantity Surveying & Valuation',        year: 3, semester: 6, has_practical: 1 },
  { code: 'CE603', name: 'Environmental Engineering',             year: 3, semester: 6, has_practical: 0 },
  { code: 'CE604', name: 'Pre-stressed Concrete',                 year: 3, semester: 6, has_practical: 0 },
  { code: 'CE605', name: 'Entrepreneurship Development',          year: 3, semester: 6, has_practical: 0 },
  { code: 'CE606', name: 'Project Work - II (Industrial)',        year: 3, semester: 6, has_practical: 1 }
]);

const EE_SUBJECTS = COMMON_ENGG.concat([
  { code: 'EE301', name: 'Electrical Circuits & Networks',        year: 2, semester: 3, has_practical: 1 },
  { code: 'EE302', name: 'Electrical Machines - I',               year: 2, semester: 3, has_practical: 1 },
  { code: 'EE303', name: 'Power Generation',                      year: 2, semester: 3, has_practical: 0 },
  { code: 'EE304', name: 'Measuring Instruments',                 year: 2, semester: 3, has_practical: 1 },
  { code: 'EE305', name: 'Engineering Mathematics - III',         year: 2, semester: 3, has_practical: 0 },
  { code: 'EE306', name: 'Electronic Devices & Circuits',         year: 2, semester: 3, has_practical: 1 },
  { code: 'EE401', name: 'Electrical Machines - II',              year: 2, semester: 4, has_practical: 1 },
  { code: 'EE402', name: 'Electrical Power Transmission',         year: 2, semester: 4, has_practical: 0 },
  { code: 'EE403', name: 'Control Systems',                       year: 2, semester: 4, has_practical: 1 },
  { code: 'EE404', name: 'Industrial Electronics',                year: 2, semester: 4, has_practical: 1 },
  { code: 'EE405', name: 'Electrical Estimation & Costing',       year: 2, semester: 4, has_practical: 1 },
  { code: 'EE406', name: 'Computer Applications in Electrical Engineering', year: 2, semester: 4, has_practical: 1 },
  { code: 'EE501', name: 'Power Electronics',                     year: 3, semester: 5, has_practical: 1 },
  { code: 'EE502', name: 'Switchgear & Protection',               year: 3, semester: 5, has_practical: 0 },
  { code: 'EE503', name: 'Utilization of Electrical Energy',      year: 3, semester: 5, has_practical: 1 },
  { code: 'EE504', name: 'Microcontrollers & Applications',       year: 3, semester: 5, has_practical: 1 },
  { code: 'EE505', name: 'Electrical Design & Drawing',           year: 3, semester: 5, has_practical: 1 },
  { code: 'EE506', name: 'Project Work - I',                      year: 3, semester: 5, has_practical: 1 },
  { code: 'EE601', name: 'High Voltage Engineering',              year: 3, semester: 6, has_practical: 0 },
  { code: 'EE602', name: 'PLC & Industrial Automation',           year: 3, semester: 6, has_practical: 1 },
  { code: 'EE603', name: 'Energy Audit & Management',             year: 3, semester: 6, has_practical: 0 },
  { code: 'EE604', name: 'Renewable Energy Systems',              year: 3, semester: 6, has_practical: 1 },
  { code: 'EE605', name: 'Entrepreneurship Development',          year: 3, semester: 6, has_practical: 0 },
  { code: 'EE606', name: 'Project Work - II (Industrial)',        year: 3, semester: 6, has_practical: 1 }
]);

const ECE_SUBJECTS = COMMON_ENGG.concat([
  { code: 'EC301', name: 'Electronic Devices & Circuits - I',    year: 2, semester: 3, has_practical: 1 },
  { code: 'EC302', name: 'Digital Electronics',                   year: 2, semester: 3, has_practical: 1 },
  { code: 'EC303', name: 'Network Analysis',                      year: 2, semester: 3, has_practical: 0 },
  { code: 'EC304', name: 'Signals & Systems',                     year: 2, semester: 3, has_practical: 0 },
  { code: 'EC305', name: 'Engineering Mathematics - III',         year: 2, semester: 3, has_practical: 0 },
  { code: 'EC306', name: 'Electronic Measurement & Instruments',  year: 2, semester: 3, has_practical: 1 },
  { code: 'EC401', name: 'Electronic Devices & Circuits - II',   year: 2, semester: 4, has_practical: 1 },
  { code: 'EC402', name: 'Analog Communication',                  year: 2, semester: 4, has_practical: 1 },
  { code: 'EC403', name: 'Microprocessors & Interfaces',          year: 2, semester: 4, has_practical: 1 },
  { code: 'EC404', name: 'Industrial Electronics',                year: 2, semester: 4, has_practical: 1 },
  { code: 'EC405', name: 'Linear Integrated Circuits',            year: 2, semester: 4, has_practical: 1 },
  { code: 'EC406', name: 'Computer Organization',                 year: 2, semester: 4, has_practical: 0 },
  { code: 'EC501', name: 'Digital Communication',                 year: 3, semester: 5, has_practical: 1 },
  { code: 'EC502', name: 'Microcontrollers & Embedded Systems',   year: 3, semester: 5, has_practical: 1 },
  { code: 'EC503', name: 'Television & Video Engineering',        year: 3, semester: 5, has_practical: 1 },
  { code: 'EC504', name: 'Digital Signal Processing',             year: 3, semester: 5, has_practical: 1 },
  { code: 'EC505', name: 'Fibre Optic Communication',             year: 3, semester: 5, has_practical: 0 },
  { code: 'EC506', name: 'Project Work - I',                      year: 3, semester: 5, has_practical: 1 },
  { code: 'EC601', name: 'Mobile & Wireless Communication',       year: 3, semester: 6, has_practical: 1 },
  { code: 'EC602', name: 'VLSI Design',                           year: 3, semester: 6, has_practical: 1 },
  { code: 'EC603', name: 'Satellite Communication',               year: 3, semester: 6, has_practical: 0 },
  { code: 'EC604', name: 'Radar & Navigational Aids',             year: 3, semester: 6, has_practical: 0 },
  { code: 'EC605', name: 'Entrepreneurship Development',          year: 3, semester: 6, has_practical: 0 },
  { code: 'EC606', name: 'Project Work - II (Industrial)',        year: 3, semester: 6, has_practical: 1 }
]);

const IT_SUBJECTS = COMMON_ENGG.concat([
  { code: 'IT301', name: 'Data Structures',                       year: 2, semester: 3, has_practical: 1 },
  { code: 'IT302', name: 'Object Oriented Programming (C++)',     year: 2, semester: 3, has_practical: 1 },
  { code: 'IT303', name: 'Computer Organization & Architecture',  year: 2, semester: 3, has_practical: 0 },
  { code: 'IT304', name: 'Operating Systems',                     year: 2, semester: 3, has_practical: 1 },
  { code: 'IT305', name: 'Engineering Mathematics - III',         year: 2, semester: 3, has_practical: 0 },
  { code: 'IT306', name: 'Database Management Systems',           year: 2, semester: 3, has_practical: 1 },
  { code: 'IT401', name: 'Web Technologies',                      year: 2, semester: 4, has_practical: 1 },
  { code: 'IT402', name: 'Computer Networks',                     year: 2, semester: 4, has_practical: 1 },
  { code: 'IT403', name: 'Java Programming',                      year: 2, semester: 4, has_practical: 1 },
  { code: 'IT404', name: 'Software Engineering',                  year: 2, semester: 4, has_practical: 0 },
  { code: 'IT405', name: 'Digital Electronics & Microprocessors', year: 2, semester: 4, has_practical: 1 },
  { code: 'IT406', name: 'Python Programming',                    year: 2, semester: 4, has_practical: 1 },
  { code: 'IT501', name: 'Advanced Database Systems',             year: 3, semester: 5, has_practical: 1 },
  { code: 'IT502', name: 'Cyber Security & Ethical Hacking',      year: 3, semester: 5, has_practical: 1 },
  { code: 'IT503', name: 'Mobile Application Development',        year: 3, semester: 5, has_practical: 1 },
  { code: 'IT504', name: 'Cloud Computing & DevOps',              year: 3, semester: 5, has_practical: 1 },
  { code: 'IT505', name: 'Artificial Intelligence & ML Basics',   year: 3, semester: 5, has_practical: 1 },
  { code: 'IT506', name: 'Project Work - I',                      year: 3, semester: 5, has_practical: 1 },
  { code: 'IT601', name: 'Internet of Things (IoT)',              year: 3, semester: 6, has_practical: 1 },
  { code: 'IT602', name: 'Data Science & Analytics',              year: 3, semester: 6, has_practical: 1 },
  { code: 'IT603', name: 'Network Administration & Security',     year: 3, semester: 6, has_practical: 1 },
  { code: 'IT604', name: 'Enterprise Resource Planning (ERP)',    year: 3, semester: 6, has_practical: 0 },
  { code: 'IT605', name: 'Entrepreneurship Development',          year: 3, semester: 6, has_practical: 0 },
  { code: 'IT606', name: 'Project Work - II (Industrial)',        year: 3, semester: 6, has_practical: 1 }
]);

const ME_SUBJECTS = COMMON_ENGG.concat([
  { code: 'ME301', name: 'Engineering Materials',                 year: 2, semester: 3, has_practical: 1 },
  { code: 'ME302', name: 'Fluid Mechanics & Machinery',           year: 2, semester: 3, has_practical: 1 },
  { code: 'ME303', name: 'Manufacturing Technology - I',          year: 2, semester: 3, has_practical: 1 },
  { code: 'ME304', name: 'Thermodynamics',                        year: 2, semester: 3, has_practical: 0 },
  { code: 'ME305', name: 'Engineering Mathematics - III',         year: 2, semester: 3, has_practical: 0 },
  { code: 'ME306', name: 'Machine Drawing',                       year: 2, semester: 3, has_practical: 1 },
  { code: 'ME401', name: 'Manufacturing Technology - II',         year: 2, semester: 4, has_practical: 1 },
  { code: 'ME402', name: 'Theory of Machines',                    year: 2, semester: 4, has_practical: 0 },
  { code: 'ME403', name: 'Heat Transfer',                         year: 2, semester: 4, has_practical: 1 },
  { code: 'ME404', name: 'Strength of Materials',                 year: 2, semester: 4, has_practical: 1 },
  { code: 'ME405', name: 'Metrology & Quality Control',           year: 2, semester: 4, has_practical: 1 },
  { code: 'ME406', name: 'Computer Aided Design (CAD)',           year: 2, semester: 4, has_practical: 1 },
  { code: 'ME501', name: 'Machine Design',                        year: 3, semester: 5, has_practical: 0 },
  { code: 'ME502', name: 'Thermal Engineering',                   year: 3, semester: 5, has_practical: 1 },
  { code: 'ME503', name: 'CNC Machines & Automation',             year: 3, semester: 5, has_practical: 1 },
  { code: 'ME504', name: 'Industrial Management',                 year: 3, semester: 5, has_practical: 0 },
  { code: 'ME505', name: 'Refrigeration & Air Conditioning',      year: 3, semester: 5, has_practical: 1 },
  { code: 'ME506', name: 'Project Work - I',                      year: 3, semester: 5, has_practical: 1 },
  { code: 'ME601', name: 'Automobile Engineering',                year: 3, semester: 6, has_practical: 1 },
  { code: 'ME602', name: 'Power Plant Engineering',               year: 3, semester: 6, has_practical: 0 },
  { code: 'ME603', name: 'Robotics & Industrial Automation',      year: 3, semester: 6, has_practical: 1 },
  { code: 'ME604', name: 'Operations Research',                   year: 3, semester: 6, has_practical: 0 },
  { code: 'ME605', name: 'Entrepreneurship Development',          year: 3, semester: 6, has_practical: 0 },
  { code: 'ME606', name: 'Project Work - II (Industrial)',        year: 3, semester: 6, has_practical: 1 }
]);

const PHARM_SUBJECTS = [
  { code: 'DP101', name: 'Pharmaceutics - I',                    year: 1, semester: 1, has_practical: 1 },
  { code: 'DP102', name: 'Pharmaceutical Chemistry - I',         year: 1, semester: 1, has_practical: 1 },
  { code: 'DP103', name: 'Pharmacognosy',                        year: 1, semester: 1, has_practical: 1 },
  { code: 'DP104', name: 'Human Anatomy & Physiology',           year: 1, semester: 1, has_practical: 1 },
  { code: 'DP105', name: 'Social Pharmacy',                      year: 1, semester: 1, has_practical: 0 },
  { code: 'DP106', name: 'Biochemistry & Clinical Pathology',    year: 1, semester: 1, has_practical: 1 },
  { code: 'DP201', name: 'Pharmaceutics - II',                   year: 2, semester: 2, has_practical: 1 },
  { code: 'DP202', name: 'Pharmaceutical Chemistry - II',        year: 2, semester: 2, has_practical: 1 },
  { code: 'DP203', name: 'Pharmacology & Toxicology',            year: 2, semester: 2, has_practical: 1 },
  { code: 'DP204', name: 'Pharmaceutical Jurisprudence',         year: 2, semester: 2, has_practical: 0 },
  { code: 'DP205', name: 'Drug Store & Business Management',     year: 2, semester: 2, has_practical: 0 },
  { code: 'DP206', name: 'Hospital & Clinical Pharmacy',         year: 2, semester: 2, has_practical: 1 }
];

const SUBJECTS_2026 = {
  CE:    CE_SUBJECTS,
  EE:    EE_SUBJECTS,
  ECE:   ECE_SUBJECTS,
  IT:    IT_SUBJECTS,
  ME:    ME_SUBJECTS,
  PHARM: PHARM_SUBJECTS
};

// ─────────────────────────────────────────────────────────────────────────────
// Database Utilities
// ─────────────────────────────────────────────────────────────────────────────

async function ensureSyllabusSchemeColumn() {
  try {
    await query("ALTER TABLE subjects ADD COLUMN syllabus_scheme TEXT DEFAULT '2026-27'");
    logger.info('[Curriculum] Added syllabus_scheme column to subjects table.');
  } catch (err) {
    if (!/duplicate column|already exists/i.test(err.message)) {
      logger.warn('[Curriculum] Could not add syllabus_scheme column:', { error: err.message });
    }
  }
}

async function seedDepartmentSubjects(deptId, deptCode, scheme) {
  if (!scheme) scheme = '2026-27';
  const subjects = SUBJECTS_2026[deptCode.toUpperCase()];
  if (!subjects || !subjects.length) {
    logger.warn('[Curriculum] No preset subjects for: ' + deptCode);
    return 0;
  }
  var inserted = 0;
  for (var i = 0; i < subjects.length; i++) {
    var sub = subjects[i];
    try {
      var result = await query(
        'INSERT OR IGNORE INTO subjects (department_id, year, semester, name, code, has_practical, is_active, syllabus_scheme) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        [deptId, sub.year, sub.semester, sub.name, sub.code, sub.has_practical ? 1 : 0, scheme]
      );
      if (result && (result.changes > 0 || result.affectedRows > 0)) inserted++;
    } catch (err) {
      logger.warn('[Curriculum] Failed to seed ' + sub.code + ': ' + err.message);
    }
  }
  logger.info('[Curriculum] Seeded ' + inserted + '/' + subjects.length + ' subjects for ' + deptCode + ' (' + scheme + ')');
  return inserted;
}

async function seedAllCurriculumSubjects(scheme) {
  if (!scheme) scheme = '2026-27';
  await ensureSyllabusSchemeColumn();
  var codes = Object.keys(SUBJECTS_2026);
  var totalInserted = 0;
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    var depts = await query('SELECT id FROM departments WHERE code = ? AND is_active = 1', [code]);
    if (!depts || !depts.length) {
      logger.warn('[Curriculum] Department ' + code + ' not found — skipping.');
      continue;
    }
    var deptId = depts[0].id;
    var count = await seedDepartmentSubjects(deptId, code, scheme);
    totalInserted += count;
  }
  logger.info('[Curriculum] Total subjects seeded: ' + totalInserted);
  return totalInserted;
}

module.exports = {
  IRDT_BOOKLETS: IRDT_BOOKLETS,
  SUBJECTS_2026: SUBJECTS_2026,
  getBookletUrl: getBookletUrl,
  getBookletRegistry: getBookletRegistry,
  ensureSyllabusSchemeColumn: ensureSyllabusSchemeColumn,
  seedDepartmentSubjects: seedDepartmentSubjects,
  seedAllCurriculumSubjects: seedAllCurriculumSubjects
};
