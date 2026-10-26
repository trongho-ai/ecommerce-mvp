import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(logger = console) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.',
        details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
    }
    if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON.' } });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body too large.' } });
    const known = {
      P2002: [409, 'DUPLICATE', 'A unique value already exists.'],
      P2003: [409, 'IN_USE', 'This record is referenced by another record.'],
      P2025: [404, 'NOT_FOUND', 'Record not found.'],
      P2034: [409, 'RETRY_ORDER', 'Concurrent update. Please retry the request.'],
      P1001: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.'],
      P1002: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.'],
      P2024: [503, 'DATABASE_BUSY', 'Database is busy. Try again later.'],
    }[error.code];
    if (known) return res.status(known[0]).json({ error: { code: known[1], message: known[2] } });
    logger.error({ event: 'request_failed', code: error.code ?? 'INTERNAL_ERROR', method: req.method, path: req.path });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  };
}
