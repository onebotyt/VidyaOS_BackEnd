/**
 * Exam / Test Score Routes (/api/v1/exams/*)
 * Delegates request processing to ExamController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const examController = require('../controllers/examController');

router.use(auth);

// @route   POST /api/v1/exams
// @desc    Teacher/Admin: Schedule a new class test or evaluation
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.createExam() -> ExamModel.create()
router.post(
  '/',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Test name is required'),
    body('subject_id').optional({ nullable: true }),
    body('department_id').optional({ nullable: true }),
    body('year').optional({ nullable: true }),
    body('semester').optional({ nullable: true }),
    body('academic_year_id').optional({ nullable: true }),
    validate
  ],
  (req, res) => examController.createExam(req, res)
);

// @route   GET /api/v1/exams
// @desc    List tests/exams for authenticated student or teacher
// @access  Protected (All Authenticated Users)
// @handler ExamController.listExams() -> ExamModel.listForStudent() / ExamModel.listForTeacher()
router.get('/', (req, res) => examController.listExams(req, res));

// @route   GET /api/v1/exams/:id/roster
// @desc    Teacher/Admin: Retrieve student marks roster and blueprint metadata
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.getRoster() -> ExamModel.getById(), ExamModel.getMeta(), ExamModel.getRoster()
router.get('/:id/roster', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => examController.getRoster(req, res));

// @route   POST /api/v1/exams/:id/scores
// @desc    Teacher/Admin: Bulk-save test marks, question breakdown, and status
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.saveScores() -> ExamModel.saveScores()
router.post(
  '/:id/scores',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [body('scores').isArray({ min: 1 }).withMessage('scores array is required'), validate],
  (req, res) => examController.saveScores(req, res)
);

// @route   GET /api/v1/exams/:id/export/excel
// @desc    Teacher/Admin: Export default class test marksheet (.xlsx)
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.exportExcel() -> ExamModel.getExportDetails(), ExcelExportService.generateClassTestExcel()
router.get('/:id/export/excel', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => examController.exportExcel(req, res));

// @route   POST /api/v1/exams/:id/export/excel
// @desc    Teacher/Admin: Export customized class test marksheet (.xlsx)
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.exportCustomExcel() -> ExamModel.getExportDetails(), ExcelExportService.generateClassTestExcel()
router.post('/:id/export/excel', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => examController.exportCustomExcel(req, res));

// @route   DELETE /api/v1/exams/:id
// @desc    Teacher/Admin: Delete a class test/exam
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler ExamController.deleteExam() -> ExamModel.deleteExam()
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => examController.deleteExam(req, res));

module.exports = router;
