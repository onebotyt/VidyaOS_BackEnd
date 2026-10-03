/**
 * Express-validator Schema Validation Middleware
 */

const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedDetails = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg
    }));

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: errors.array()[0]?.msg || 'Invalid request payload parameters',
        details: formattedDetails
      }
    });
  }
  next();
}

module.exports = validate;
