/**
 * Shared Institutional String & Data Formatters
 */

function normalizePhone(raw) {
  if (!raw) return '';
  let cleaned = String(raw).trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
  return cleaned.length >= 10 ? cleaned.slice(-10) : cleaned;
}

module.exports = {
  normalizePhone
};
