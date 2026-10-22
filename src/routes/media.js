/**
 * Faculty Drive & Media Asset Hub API + Omnisearch
 * Location: /src/routes/media.js
 * Delegates request processing to MediaController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { makeUploader } = require('../middleware/upload');
const mediaController = require('../controllers/mediaController');

const uploadMedia = makeUploader('media', 100);

router.use(auth);

// @route   GET /api/v1/media
// @desc    List media assets with search & filtering and metrics
// @access  Protected (All Authenticated Faculty/Admin)
// @handler MediaController.listAssets() -> MediaModel.listAssets()
router.get('/', (req, res) => mediaController.listAssets(req, res));

// @route   POST /api/v1/media/upload
// @desc    Upload and catalog a new media asset
// @access  Protected (Faculty/Admin)
// @handler MediaController.uploadAsset() -> MediaModel.createAsset()
router.post('/upload', uploadMedia.single('file'), (req, res) => mediaController.uploadAsset(req, res));

// @route   GET /api/v1/media/search/omni
// @desc    Unified Global Omnisearch for Ctrl+K Bar
// @access  Protected (All Authenticated Users)
// @handler MediaController.searchOmni() -> MediaModel.searchOmni()
router.get(['/search/omni', '/omni'], (req, res) => mediaController.searchOmni(req, res));

// @route   GET /api/v1/media/:id
// @desc    Fetch single media asset metadata
// @access  Protected (All Authenticated Users)
// @handler MediaController.getAsset() -> MediaModel.getById()
router.get('/:id', (req, res) => mediaController.getAsset(req, res));

// @route   PUT /api/v1/media/:id
// @desc    Edit asset details, category, tags
// @access  Protected (Faculty/Admin)
// @handler MediaController.updateAsset() -> MediaModel.updateAsset()
router.put('/:id', (req, res) => mediaController.updateAsset(req, res));

// @route   DELETE /api/v1/media/:id
// @desc    Delete media asset permanently from database and disk
// @access  Protected (Faculty/Admin)
// @handler MediaController.deleteAsset() -> MediaModel.deleteAsset()
router.delete('/:id', (req, res) => mediaController.deleteAsset(req, res));

module.exports = router;
