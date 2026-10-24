import type { Issue } from '@alimentation/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (why = 'You are not allowed to do that.') =>
  new ApiError(403, 'forbidden', why);
export const invalid = (message: string, issues?: Issue[]) =>
  new ApiError(422, 'invalid', message, issues);

/** Turns what Postgres says into what a caller should hear. Anything unrecognised is re-thrown as it was. */
export function mapDbError(e: unknown): unknown {
  if (e instanceof ApiError) return e;
  const err = e as { code?: string; message?: string };
  const message = String(err?.message ?? '');
  const after = (prefix: string) => message.slice(message.indexOf(prefix) + prefix.length).trim();
  if (message.includes('ALIMENTATION_QUOTA:'))
    return new ApiError(409, 'quota_exceeded', after('ALIMENTATION_QUOTA:'));
  if (message.includes('ALIMENTATION_RULE:'))
    return new ApiError(422, 'rule', after('ALIMENTATION_RULE:'));
  if (message.includes('ALIMENTATION_IMMUTABLE:'))
    return new ApiError(409, 'immutable', after('ALIMENTATION_IMMUTABLE:'));
  switch (err?.code) {
    case '42501':
      return forbidden();
    case '23505':
      return new ApiError(409, 'conflict', 'That already exists.');
    case '23503':
      return new ApiError(409, 'in_use', 'Something else depends on that.');
    case '23514':
      return invalid('That is not allowed.');
    case '22P02':
    case '22007':
    case '22008':
      return invalid('That value is not valid.');
    case '57014':
      return new ApiError(503, 'busy', 'That took too long. Try again.');
    case '53300':
      return new ApiError(503, 'busy', 'The workspace is busy. Try again.');
    default:
      return e;
  }
}
