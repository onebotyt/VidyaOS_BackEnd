/**
 * Laboratory Class Academic Dossier Routes (/api/v1/lab-classes/*)
 * Milestone 317: 7-Record Academic Dossier System for Laboratory Classes
 * Delegates request processing to LabClassController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const labClassController = require('../controllers/labClassController');

const uploadLabClass = makeUploader('lab_classes');

router.use(auth);

// @route   GET /api/v1/lab-classes/definitions
// @desc    Return standard 7 items schema definitions
router.get('/definitions', (req, res) => labClassController.getDefinitions(req, res));

// @route   GET /api/v1/lab-classes
// @desc    Fetch or auto-provision laboratory class dossier for a teaching group
router.get('/', (req, res) => labClassController.getLabClass(req, res));

// @route   POST /api/v1/lab-classes/:id/documents
// @desc    Upload a document for one of the 7 Laboratory Class items
router.post('/:id/documents', uploadLabClass.single('file'), (req, res) => labClassController.uploadDocument(req, res));

// @route   DELETE /api/v1/lab-classes/:id/documents/:item_key
// @desc    Remove an uploaded document from the laboratory class dossier
router.delete('/:id/documents/:item_key', (req, res) => labClassController.deleteDocument(req, res));

// @route   POST /api/v1/lab-classes/:id/audit
// @desc    HOD / Auditor approves or reviews the Laboratory Class dossier
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => labClassController.auditLabClass(req, res));

module.exports = router;
