/**
 * Thrown when a subgraph query is aborted because it exceeded its timeout.
 *
 * The component owns its own timeout (via `withTimeout`), so it raises this typed error
 * rather than inferring a timeout from however the injected `IFetchComponent` reports an
 * aborted request — e.g. `@dcl/fetch-component` rejects with a generic
 * `Error('Request aborted (timed out)')`, not a native `AbortError`.
 */
export class SubgraphQueryTimeoutError extends Error {
  constructor(public readonly timeout: number) {
    super(`The subgraph query timed out after ${timeout}ms`)
    this.name = 'SubgraphQueryTimeoutError'
  }
}
