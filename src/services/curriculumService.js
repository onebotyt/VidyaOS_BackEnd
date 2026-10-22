/**
 * Curriculum Service — Backward compatibility layer delegating to CurriculumModel.
 */

const curriculumModel = require('../models/curriculumModel');

module.exports = {
  IRDT_BOOKLETS: curriculumModel.IRDT_BOOKLETS,
  getBookletUrl: curriculumModel.getBookletUrl,
  getBookletRegistry: curriculumModel.getBookletRegistry,
  ensureSyllabusSchemeColumn: curriculumModel.ensureSyllabusSchemeColumn
};
