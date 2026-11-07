const { ZodError } = require('zod');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

/** validate({ body, query, params }) with zod schemas; parsed values replace originals. */
const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.query) req.valid = { ...(req.valid || {}), query: schemas.query.parse(req.query) };
    if (schemas.params) req.valid = { ...(req.valid || {}), params: schemas.params.parse(req.params) };
    next();
  } catch (e) { next(e); }
};

const notFoundHandler = (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: { code: 'VALIDATION', message: 'Please check the highlighted fields', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File is too large' } });
  if (String(err?.code || '').startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: { code: 'CONSTRAINT', message: /UNIQUE/.test(err.message) ? 'A record with these details already exists' : 'Invalid reference or constraint' } });
  }
  if (!env.isTest) console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: env.isProd ? 'Something went wrong' : err.message } });
};

module.exports = { validate, notFoundHandler, errorHandler };
