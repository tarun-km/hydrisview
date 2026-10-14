/** Consistent error contract: { error: { code, message, details? } } */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (code = 'unauthenticated', message = 'Authentication required') => new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message?: string, details?: unknown) => new HttpError(409, code, message, details);
