/**
 * ══════════════════════════════════════════════════════════════
 * OCR CONTROLLER
 * backend/src/controllers/ocrController.js
 * ══════════════════════════════════════════════════════════════
 */

const ocrService = require('../services/ocrService');
const logger = require('../utils/logger');

class OcrController {
  /**
   * Extracts questions and metadata from uploaded document (PDF or image).
   * 
   * @route POST /api/v1/ocr/extract-questions
   * @access Protected (Faculty, Admin)
   */
  async extractQuestions(req, res) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_REQUIRED',
            message: 'Please upload a PDF or image file (JPG, PNG, WebP) to extract questions.'
          }
        });
      }

      const file = req.file;
      const result = await ocrService.extractQuestions(
        file.buffer,
        file.originalname || 'document',
        file.mimetype || 'application/octet-stream'
      );

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      logger.error('[OcrController] extractQuestions error:', { error: err.message });
      return res.status(500).json({
        success: false,
        error: {
          code: 'OCR_EXTRACTION_FAILED',
          message: err.message || 'Failed to extract questions from uploaded document.'
        }
      });
    }
  }
}

module.exports = new OcrController();
