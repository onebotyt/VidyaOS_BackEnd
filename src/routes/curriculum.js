/**
 * Curriculum Routes — IRDT Uttarakhand Syllabus Integration
 * Base: /api/v1/curriculum
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const curriculumController = require('../controllers/curriculumController');

// @route   GET /api/v1/curriculum/booklets
// @desc    Get IRDT booklet PDF registry for all departments
// @access  Public
// @handler CurriculumController.getBooklets -> CurriculumModel.getBookletRegistry()
router.get('/booklets', curriculumController.getBooklets);

// @route   GET /api/v1/curriculum/booklets/:deptCode
// @desc    Get IRDT booklet PDF links for a specific department
// @access  Public
// @handler CurriculumController.getBookletByDept -> CurriculumModel.getBookletUrl()
router.get('/booklets/:deptCode', curriculumController.getBookletByDept);

// @route   POST /api/v1/curriculum/seed
// @desc    Verify syllabus scheme column migration and inform about dynamic teaching groups
// @access  Protected (SYSTEM_ADMIN)
// @handler CurriculumController.seedCurriculum -> CurriculumModel.ensureSyllabusSchemeColumn()
router.post('/seed', auth, requireRole('SYSTEM_ADMIN'), curriculumController.seedCurriculum);

module.exports = router;
