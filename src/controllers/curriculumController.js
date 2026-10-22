/**
 * Curriculum Controller — Handles HTTP requests for IRDT curriculum & syllabus
 */

const curriculumModel = require('../models/curriculumModel');
const logger = require('../utils/logger');

/**
 * Retrieves official IRDT booklet registry (PDF links) for all departments.
 * 
 * @route GET /api/v1/curriculum/booklets (routes/curriculum.js)
 * @access Public
 * @usesModel CurriculumModel.getBookletRegistry() (models/curriculumModel.js)
 * @param {Request} req Express request
 * @param {Response} res Express response
 */
function getBooklets(req, res) {
  try {
    const registry = curriculumModel.getBookletRegistry();
    return res.json({ success: true, data: registry });
  } catch (err) {
    logger.error('[CurriculumController] getBooklets error:', { error: err.message });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
}

/**
 * Retrieves booklet links for a specific department code (e.g. IT, CE, PHARM).
 * 
 * @route GET /api/v1/curriculum/booklets/:deptCode (routes/curriculum.js)
 * @access Public
 * @usesModel CurriculumModel.getBookletUrl() (models/curriculumModel.js)
 * @param {Request} req Express request with params.deptCode
 * @param {Response} res Express response
 */
function getBookletByDept(req, res) {
  try {
    const code = (req.params.deptCode || '').toUpperCase();
    const newUrl = curriculumModel.getBookletUrl(code, 'new');
    const oldUrl = curriculumModel.getBookletUrl(code, 'old');

    if (!newUrl && !oldUrl) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No booklet found for department: ${code}` }
      });
    }

    return res.json({
      success: true,
      data: {
        dept_code: code,
        new_scheme: { label: curriculumModel.IRDT_BOOKLETS.new.label, url: newUrl },
        old_scheme: { label: curriculumModel.IRDT_BOOKLETS.old.label, url: oldUrl }
      }
    });
  } catch (err) {
    logger.error('[CurriculumController] getBookletByDept error:', { error: err.message });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
}

/**
 * Migration & seeding acknowledgment endpoint.
 * 
 * @route POST /api/v1/curriculum/seed (routes/curriculum.js)
 * @access Protected (SYSTEM_ADMIN)
 * @usesModel CurriculumModel.ensureSyllabusSchemeColumn() (models/curriculumModel.js)
 * @param {Request} req Express request
 * @param {Response} res Express response
 */
async function seedCurriculum(req, res) {
  try {
    await curriculumModel.ensureSyllabusSchemeColumn();
    return res.json({
      success: true,
      data: {
        message: 'Subjects and syllabi are dynamically managed by faculty via Teaching Groups.'
      }
    });
  } catch (err) {
    logger.error('[CurriculumController] seedCurriculum error:', { error: err.message });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
}

module.exports = {
  getBooklets,
  getBookletByDept,
  seedCurriculum
};
