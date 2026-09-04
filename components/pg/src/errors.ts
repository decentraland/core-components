/**
 * Thrown instead of attempting a database operation while the component already knows the database
 * is unreachable and its reconnection loop has not brought it back within the wait budget.
 *
 * Callers that mapped the raw driver error before can map this one to the same outcome (typically a
 * `503`); the driver's last error is kept in `cause` and quoted in the message.
 * @public
 */
export class DatabaseUnavailableError extends Error {
  readonly cause?: unknown

  constructor(lastError?: string, cause?: unknown) {
    super(lastError ? `The database is unreachable: ${lastError}` : 'The database is unreachable')
    this.name = 'DatabaseUnavailableError'
    this.cause = cause
  }
}
