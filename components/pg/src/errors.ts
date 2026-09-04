/**
 * Thrown instead of attempting a database operation while the component already knows the database
 * is unreachable and its reconnection loop has not brought it back within the wait budget.
 *
 * Callers that mapped the raw driver error before can map this one to the same outcome (typically a
 * `503`). The driver's last error is kept in `cause`, not in the message: driver messages name hosts,
 * ports, users and databases, and a generic HTTP error serializer that echoes `message` would leak
 * them.
 * @public
 */
export class DatabaseUnavailableError extends Error {
  readonly cause?: unknown

  constructor(cause?: unknown) {
    super('The database is unreachable')
    this.name = 'DatabaseUnavailableError'
    this.cause = cause
  }
}
