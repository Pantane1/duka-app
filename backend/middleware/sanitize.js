'use strict';

/**
 * sanitize.js
 * Strips unexpected characters from string fields and enforces
 * basic request hygiene before routes see the data.
 */

const DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>/i,
  /javascript:/i,
  /on\w+\s*=/i,      // onclick=, onload=, etc.
  /--/,              // SQL comment
  /;.*?(drop|delete|insert|update|alter|create)\s/i,
];

/**
 * Recursively sanitize a value (string, array, object).
 */
function sanitizeValue(val) {
  if (typeof val === 'string') {
    // Trim, collapse whitespace
    let s = val.trim().replace(/\s{2,}/g, ' ');
    // Check for dangerous patterns
    for (const pat of DANGEROUS_PATTERNS) {
      if (pat.test(s)) {
        throw Object.assign(
          new Error('Request contains disallowed content'),
          { status: 400, expose: true }
        );
      }
    }
    return s;
  }
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = sanitizeValue(v);
    return out;
  }
  return val;
}

/**
 * Express middleware – sanitizes req.body, req.query, req.params.
 */
function sanitize(req, res, next) {
  try {
    if (req.body   && typeof req.body   === 'object') req.body   = sanitizeValue(req.body);
    if (req.query  && typeof req.query  === 'object') req.query  = sanitizeValue(req.query);
    if (req.params && typeof req.params === 'object') req.params = sanitizeValue(req.params);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { sanitize };
