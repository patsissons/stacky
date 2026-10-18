/**
 * An error that maps cleanly onto an API response. `code` is stable and
 * machine readable; `message` and `hint` are shown to the user.
 */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (what: string, hint?: string) =>
  new AppError(404, 'not_found', `${what} not found`, hint)

export const badRequest = (message: string, hint?: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, hint, details)

export const conflict = (message: string, hint?: string) =>
  new AppError(409, 'conflict', message, hint)
