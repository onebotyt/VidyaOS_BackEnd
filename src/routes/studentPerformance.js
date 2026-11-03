/**
 * Student Performance Monitoring Routes (/api/v1/student-performance/*)
 * Milestone 322: 8-Record Student Performance Monitoring Academic Dossier System
 * Delegates request processing to StudentPerformanceController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const studentPerformanceController = require('../controllers/studentPerformanceController');

const uploadStudentPerformance = makeUploader('student_performance');

router.use(auth);

// @route   GET /api/v1/student-performance/definitions
// @desc    Return standard 8 items schema definitions
router.get('/definitions', (req, res) => studentPerformanceController.getDefinitions(req, res));

// @route   GET /api/v1/student-performance
// @desc    Fetch or auto-provision student performance dossier for a teaching group
router.get('/', (req, res) => studentPerformanceController.getPerformanceDossier(req, res));

// @route   POST /api/v1/student-performance/:id/documents
// @desc    Upload a PDF document for one of the 8 Student Performance items
router.post('/:id/documents', uploadStudentPerformance.single('file'), (req, res) => studentPerformanceController.uploadDocument(req, res));

// @route   DELETE /api/v1/student-performance/:id/documents/:item_key
// @desc    Remove an uploaded document from the student performance dossier
router.delete('/:id/documents/:item_key', (req, res) => studentPerformanceController.deleteDocument(req, res));

// @route   POST /api/v1/student-performance/:id/audit
// @desc    HOD / Auditor approves or reviews the Student Performance dossier
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => studentPerformanceController.auditPerformance(req, res));

module.exports = router;
