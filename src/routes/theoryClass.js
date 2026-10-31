/**
 * Theory Class Academic Dossier Routes (/api/v1/theory-classes/*)
 * Milestone 316: 7-Record Academic Dossier System for Theory Classes
 * Delegates request processing to TheoryClassController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const theoryClassController = require('../controllers/theoryClassController');

const uploadTheoryClass = makeUploader('theory_classes');

router.use(auth);

// @route   GET /api/v1/theory-classes/definitions
// @desc    Return standard 7 items schema definitions
router.get('/definitions', (req, res) => theoryClassController.getDefinitions(req, res));

// @route   GET /api/v1/theory-classes
// @desc    Fetch or auto-provision theory class dossier for a teaching group
router.get('/', (req, res) => theoryClassController.getTheoryClass(req, res));

// @route   POST /api/v1/theory-classes/:id/documents
// @desc    Upload a document for one of the 7 Theory Class items
router.post('/:id/documents', uploadTheoryClass.single('file'), (req, res) => theoryClassController.uploadDocument(req, res));

// @route   DELETE /api/v1/theory-classes/:id/documents/:item_key
// @desc    Remove an uploaded document from the theory class dossier
router.delete('/:id/documents/:item_key', (req, res) => theoryClassController.deleteDocument(req, res));

// @route   POST /api/v1/theory-classes/:id/audit
// @desc    HOD / Auditor approves or reviews the Theory Class dossier
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => theoryClassController.auditTheoryClass(req, res));

module.exports = router;

