/**
 * Assessment Process Routes (/api/v1/assessment-process/*)
 * Milestone 323: 13-Record Direct & Indirect Assessment Dossier System
 * Delegates request processing to AssessmentProcessController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const assessmentProcessController = require('../controllers/assessmentProcessController');

const uploadAssessmentProcess = makeUploader('assessment_process');

router.use(auth);

// @route   GET /api/v1/assessment-process/definitions
// @desc    Return standard 13 items schema definitions
router.get('/definitions', (req, res) => assessmentProcessController.getDefinitions(req, res));

// @route   GET /api/v1/assessment-process
// @desc    Fetch or auto-provision assessment process dossier for a teaching group
router.get('/', (req, res) => assessmentProcessController.getAssessmentDossier(req, res));

// @route   POST /api/v1/assessment-process/:id/documents
// @desc    Upload a PDF document for one of the 13 Assessment Process items
router.post('/:id/documents', uploadAssessmentProcess.single('file'), (req, res) => assessmentProcessController.uploadDocument(req, res));

// @route   DELETE /api/v1/assessment-process/:id/documents/:item_key
// @desc    Remove an uploaded document from the assessment process dossier
router.delete('/:id/documents/:item_key', (req, res) => assessmentProcessController.deleteDocument(req, res));

// @route   POST /api/v1/assessment-process/:id/audit
// @desc    HOD / Auditor approves or reviews the Assessment Process dossier
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => assessmentProcessController.auditAssessment(req, res));

module.exports = router;
