/**
 * Environment configuration helper
 * Proxies process.env with defaults
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

module.exports = process.env;
