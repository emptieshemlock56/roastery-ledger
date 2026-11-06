export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function uuid(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  if (!isUuid(value)) throw badRequest(`${field} is not a valid id`);
  return value;
}

export function text(value, field, { required = false, max = 1000 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return s;
}

export function number(value, field, { required = false, min, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw badRequest(`${field} must be a whole number`);
  if (min !== undefined && n < min) throw badRequest(`${field} must be at least ${min}`);
  return n;
}

export function bool(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`);
  return value;
}

export function oneOf(value, field, options, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  if (!options.includes(value)) throw badRequest(`${field} must be one of: ${options.join(', ')}`);
  return value;
}

export const round4 = (n) => Math.round(n * 10000) / 10000;

// Express 5 forwards thrown/rejected errors here.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  switch (err?.code) {
    case '23505':
      return res.status(409).json({ error: friendlyUnique(err) });
    case '23503':
    case '23001':
      return res.status(409).json({ error: 'This record is in use elsewhere and cannot be removed. Mark it inactive instead.' });
    case '22P02':
    case '23514':
      return res.status(400).json({ error: 'Invalid value' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}

function friendlyUnique(err) {
  const c = err.constraint || '';
  if (c.includes('code')) return 'An item with that code already exists';
  if (c.includes('email')) return 'A user with that email already exists';
  if (c.includes('name')) return 'That name is already used';
  if (c.includes('parent_item_id')) return 'A component is listed twice';
  return 'That value already exists';
}
