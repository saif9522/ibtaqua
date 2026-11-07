class AppError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const bad = (msg, details) => new AppError(400, msg, 'BAD_REQUEST', details);
const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'UNAUTHORIZED');
const forbidden = (msg = 'You do not have permission for this action') => new AppError(403, msg, 'FORBIDDEN');
const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'NOT_FOUND');
const conflict = (msg) => new AppError(409, msg, 'CONFLICT');

// Wrap async route handlers so thrown errors reach the error middleware.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, bad, unauthorized, forbidden, notFound, conflict, ah };
