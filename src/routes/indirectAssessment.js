/**
 * Indirect Assessment Routes (/api/v1/indirect-assessment/*)
 * Milestone 324: Dedicated 5-Record Indirect Assessment Dossier System
 * Location: src/routes/indirectAssessment.js
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const assessmentProcessController = require('../controllers/assessmentProcessController');

const uploadAssessmentProcess = makeUploader('assessment_process');

router.use(auth);
router.use(requireRole('TEACHER', 'FACULTY', 'HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'));

// @route   GET /api/v1/indirect-assessment/definitions
// @desc    Return 5 Indirect Assessment items schema definitions
router.get('/definitions', (req, res) => assessmentProcessController.getIndirectDefinitions(req, res));

// @route   GET /api/v1/indirect-assessment
// @desc    Fetch or auto-provision Indirect Assessment dossier for a teaching group
router.get('/', (req, res) => assessmentProcessController.getIndirectAssessmentDossier(req, res));

// @route   POST /api/v1/indirect-assessment/documents
router.post('/documents', uploadAssessmentProcess.single('file'), (req, res) => assessmentProcessController.uploadDocument(req, res));

// @route   POST /api/v1/indirect-assessment/:id/documents
router.post('/:id/documents', uploadAssessmentProcess.single('file'), (req, res) => assessmentProcessController.uploadDocument(req, res));

// @route   DELETE /api/v1/indirect-assessment/documents
router.delete('/documents', (req, res) => assessmentProcessController.deleteDocument(req, res));

// @route   DELETE /api/v1/indirect-assessment/documents/:item_key
router.delete('/documents/:item_key', (req, res) => assessmentProcessController.deleteDocument(req, res));

// @route   DELETE /api/v1/indirect-assessment/:id/documents/:item_key
router.delete('/:id/documents/:item_key', (req, res) => assessmentProcessController.deleteDocument(req, res));

// @route   POST /api/v1/indirect-assessment/audit
router.post('/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => assessmentProcessController.auditAssessment(req, res));

// @route   POST /api/v1/indirect-assessment/:id/audit
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => assessmentProcessController.auditAssessment(req, res));

module.exports = router;

