import { setTimeout as delay } from 'timers/promises'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { ConnectionStatus, IMetricsComponent, ReconnectionOptions } from './types'
import { DatabaseUnavailableError } from './errors'

/**
 * Socket-level failures and PostgreSQL SQLSTATEs that mean "the connection to the database is gone,
 * was refused, or cannot be opened right now" — never "the statement was wrong". Anything outside
 * this list is a real query error and must reach the caller untouched.
 * @internal
 */
const CONNECTION_ERROR_CODES = new Set([
  // Node / libuv socket errors.
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EADDRNOTAVAIL',
  // PostgreSQL class 08 — connection exception.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  // The server is going away, restarting, or not accepting connections yet.
  '57P01',
  '57P02',
  '57P03',
  // No connection slots left: the server is up but unusable until it drains.
  '53300'
])

/**
 * `pg` reports most transport failures as plain `Error`s with no `code`, so the message is the only
 * signal available. Matched case-insensitively as substrings.
 * @internal
 */
const CONNECTION_ERROR_MESSAGES = [
  // Also covers pg-pool's "Connection terminated due to connection timeout", the real connect
  // timeout. Its other timeout, "timeout exceeded when trying to connect", is deliberately absent: pg-pool
  // raises that one while *waiting for a free client in a full pool*, which means saturation, not a
  // database that went away — retrying it would only add another waiter to the queue.
  'connection terminated',
  'connection ended unexpectedly',
  'server closed the connection unexpectedly',
  'the database system is starting up',
  'the database system is shutting down',
  'terminating connection'
]

/**
 * Errors `pg` raises *before* writing anything to the socket: the client it handed us was already
 * dead. They prove the statement never reached the server, which is what makes retrying them safe
 * even for writes — the single most common symptom of a database restart behind a warm pool.
 * @internal
 */
const NOT_SENT_ERROR_MESSAGES = [
  'client has encountered a connection error and is not queryable',
  'client was closed and is not queryable',
  'cannot use a client after it has been ended'
]

/**
 * Failures that a reconnection can never fix: the pool itself was shut down. Reconnecting after one
 * of these would spin forever against an object that will never accept a connection again.
 * @internal
 */
const TERMINAL_ERROR_MESSAGES = ['calling end on the pool', 'called end on pool more than once']

/**
 * @public
 */
export const DEFAULT_RECONNECTION_OPTIONS: Required<
  Omit<ReconnectionOptions, 'onDisconnection' | 'onReconnection'>
> = {
  enabled: true,
  maxRetries: 3,
  startMaxRetries: 30,
  initialDelayInMilliseconds: 300,
  maxDelayInMilliseconds: 1_000,
  backoffFactor: 2,
  probeTimeoutInMilliseconds: 5_000,
  retrySentStatements: false
}

/**
 * @internal
 */
export type ResolvedReconnectionOptions = Required<
  Omit<ReconnectionOptions, 'onDisconnection' | 'onReconnection'>
> &
  Pick<ReconnectionOptions, 'onDisconnection' | 'onReconnection'>

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }
  return String(error ?? '')
}

function matchesAnyMessage(error: unknown, fragments: string[]): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return message.length > 0 && fragments.some((fragment) => message.includes(fragment))
}

/**
 * Whether the error means the database connection is unusable, as opposed to the statement being
 * invalid. Drives both the retry decision and the reported connection status.
 * @public
 */
export function isConnectionError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false
  }

  if (error instanceof DatabaseUnavailableError) {
    return true
  }

  // A pool that was explicitly ended is not a disconnection; no amount of retrying revives it.
  if (matchesAnyMessage(error, TERMINAL_ERROR_MESSAGES)) {
    return false
  }

  if (typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
      return true
    }
  }

  return matchesAnyMessage(error, CONNECTION_ERROR_MESSAGES) || isNotSentError(error)
}

/**
 * Whether the error proves the statement never reached the server, which makes retrying it safe even
 * when the statement is not idempotent.
 * @public
 */
export function isNotSentError(error: unknown): boolean {
  return matchesAnyMessage(error, NOT_SENT_ERROR_MESSAGES)
}

/**
 * Exponential backoff capped at `maxDelayInMilliseconds`, with half of the delay jittered so a fleet
 * of instances reconnecting after the same outage does not stampede the recovering database.
 * @public
 */
export function getBackoffDelay(
  attempt: number,
  options: Pick<ResolvedReconnectionOptions, 'initialDelayInMilliseconds' | 'maxDelayInMilliseconds' | 'backoffFactor'>
): number {
  const exponential = options.initialDelayInMilliseconds * Math.pow(options.backoffFactor, attempt)
  const capped = Math.min(exponential, options.maxDelayInMilliseconds)
  return Math.round(capped / 2 + Math.random() * (capped / 2))
}

/**
 * @internal
 */
export type OperationContext = {
  /**
   * Marks the point from which the operation may already have been applied by the server. Failures
   * after this point are only retried when the error proves the statement never left the client, or
   * when `retrySentStatements` is enabled.
   */
  markStatementSent(): void
}

/**
 * @internal
 */
export type RunOptions = {
  /** Overrides the configured attempt budget for this operation. */
  maxRetries?: number
  /**
   * Whether the operation may be retried at all once `markStatementSent()` has been called.
   * Defaults to `true`, which still requires the error to prove the statement never left the client
   * unless `retrySentStatements` is enabled.
   *
   * Operations that run caller-provided code set it to `false`, which overrides
   * `retrySentStatements` too: no error can prove that someone else's callback is safe to run twice.
   */
  retryAfterStatementSent?: boolean
}

/**
 * @internal
 */
export type ReconnectionManager = {
  /** Runs an operation, retrying it with backoff while the failure is a recoverable disconnection. */
  run<T>(name: string, operation: (context: OperationContext) => Promise<T>, options?: RunOptions): Promise<T>
  /** Records that the database answered, restoring the connected state. */
  notifySuccess(): void
  /** Records a failure, flipping the state to disconnected when it is a connection error. */
  notifyFailure(error: unknown): void
  /** Opens a connection and runs a trivial statement, updating the state with the outcome. */
  probe(): Promise<boolean>
  /** Schedules a deduplicated probe without waiting for it. */
  scheduleProbe(error?: unknown): void
  getStatus(): ConnectionStatus
  /** Aborts pending backoff waits and the background reconnection loop. */
  stop(): void
}

/**
 * Tracks the connection state, retries operations that failed because the connection dropped, and
 * keeps a background loop probing the database while it is unreachable so the pool is warm again
 * before the next request arrives.
 *
 * The pool instance is never replaced: `pg` opens a fresh connection whenever a client is checked
 * out, so recovery is a matter of evicting broken clients and retrying, and callers holding a
 * reference from `getPool()` keep a valid one across outages.
 * @internal
 */
export function createReconnectionManager(
  components: { logs: ILoggerComponent; metrics?: IMetricsComponent },
  options: ResolvedReconnectionOptions,
  probeConnection: () => Promise<void>
): ReconnectionManager {
  const { logs, metrics } = components
  const logger = logs.getLogger('pg-component-reconnection')
  const abortController = new AbortController()

  let connected = false
  let since = Date.now()
  let lastError: string | undefined
  let lastErrorCause: unknown
  let recoveryWaiters: Array<(recovered: boolean) => void> = []
  let reconnectionAttempts = 0
  let disconnections = 0
  let stopped = false
  let loopRunning = false
  let inFlightProbe: Promise<boolean> | undefined
  let warnedAboutMissingMetrics = false

  function recordMetric(record: (metricsComponent: IMetricsComponent) => void): void {
    if (!metrics) {
      return
    }
    try {
      record(metrics)
    } catch (error) {
      // A metrics component whose declarations predate these metrics throws on an unknown name.
      // Observability must never break a query, so the failure is reported once and dropped.
      if (!warnedAboutMissingMetrics) {
        warnedAboutMissingMetrics = true
        logger.warn('Reconnection metrics are not declared in the metrics component', {
          error: getErrorMessage(error)
        })
      }
    }
  }

  function notifyListener<T>(name: string, listener: ((argument: T) => void) | undefined, argument: T): void {
    if (!listener) {
      return
    }
    try {
      listener(argument)
    } catch (error) {
      logger.error('Connection status listener threw', { listener: name, error: getErrorMessage(error) })
    }
  }

  function markConnected(): void {
    if (connected) {
      return
    }

    const downtimeInMilliseconds = Date.now() - since
    const attempts = reconnectionAttempts
    // Only a connection that follows an observed outage is a recovery. Note that a database which
    // was unreachable while the service booted counts as one such outage, so a slow-starting
    // database does report a disconnection and then a reconnection.
    const isRecovery = disconnections > 0

    connected = true
    since = Date.now()
    reconnectionAttempts = 0

    recordMetric((metricsComponent) => metricsComponent.observe('dcl_db_connection_status', {}, 1))
    settleRecoveryWaiters(true)

    if (isRecovery) {
      logger.info('Database connection restored', { downtimeInMilliseconds, attempts })
      notifyListener('onReconnection', options.onReconnection, downtimeInMilliseconds)
    }
  }

  function markDisconnected(error: unknown): void {
    lastError = getErrorMessage(error)
    lastErrorCause = error

    // The logs, the metric and the listener describe a transition, so they only fire on the edge:
    // a hundred queries failing at once is one outage, not a hundred.
    if (connected || disconnections === 0) {
      connected = false
      since = Date.now()
      disconnections += 1

      logger.warn('Database connection lost', { error: lastError })
      recordMetric((metricsComponent) => metricsComponent.observe('dcl_db_connection_status', {}, 0))
      notifyListener('onDisconnection', options.onDisconnection, error instanceof Error ? error : new Error(lastError))
    }

    // Starting the loop is not edge-triggered: being disconnected must always imply that a loop is
    // running, whatever the transition did. It is a no-op when one already is.
    startReconnectionLoop()
  }

  function notifySuccess(): void {
    markConnected()
  }

  function notifyFailure(error: unknown): void {
    // A client `pg` refused to use because it was already dead says something about that client,
    // not about the database: the pool evicts it and the next checkout opens a fresh one. Only a
    // failure to reach the server is treated as an outage.
    if (isConnectionError(error) && !isNotSentError(error)) {
      markDisconnected(error)
    }
  }

  function settleRecoveryWaiters(recovered: boolean): void {
    const waiters = recoveryWaiters
    recoveryWaiters = []
    for (const waiter of waiters) {
      waiter(recovered)
    }
  }

  /**
   * Parks an operation until the reconnection loop reports a verdict — the database answered a probe
   * (`true`) or refused one (`false`) — or until the cap expires without one (`false`). This is what
   * turns N concurrent callers during an outage into a single stream of probes instead of N × retries.
   */
  function waitForRecovery(capInMilliseconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      const waiter = (recovered: boolean) => {
        clearTimeout(cap)
        resolve(recovered)
      }
      const cap = globalThis.setTimeout(() => {
        recoveryWaiters = recoveryWaiters.filter((candidate) => candidate !== waiter)
        resolve(false)
      }, capInMilliseconds)

      recoveryWaiters.push(waiter)
    })
  }

  /**
   * Bounds a probe: with no `connectionTimeoutMillis` or `query_timeout` configured, `pg` waits on an
   * unreachable host for as long as the OS lets it, which would leave `ping()` hanging and the
   * background loop parked on a promise that never settles.
   */
  async function runProbeWithDeadline(): Promise<void> {
    const deadline = new AbortController()
    const attempt = probeConnection()
    // The deadline may win the race; keep a late failure from escaping as an unhandled rejection.
    attempt.catch(() => undefined)

    try {
      await Promise.race([
        attempt,
        delay(options.probeTimeoutInMilliseconds, undefined, { signal: deadline.signal, ref: false }).then(
          () => {
            throw new Error(
              `The connection probe did not answer within ${options.probeTimeoutInMilliseconds}ms`
            )
          },
          // Aborted because the probe already answered: never settle, so the probe decides the race.
          () => new Promise<never>(() => undefined)
        )
      ])
    } finally {
      deadline.abort()
    }
  }

  async function probe(): Promise<boolean> {
    // A stopped component cannot serve queries, so it is not reachable — but neither is that an
    // outage worth reporting: the pool was closed on purpose, and `pool.connect()` would fail with
    // an error this module classifies as terminal. Answering without touching the pool keeps a
    // readiness endpoint polled during a deploy from firing `onDisconnection` on every shutdown.
    if (stopped) {
      return false
    }

    if (!inFlightProbe) {
      inFlightProbe = (async () => {
        try {
          await runProbeWithDeadline()
          markConnected()
          return true
        } catch (error) {
          // Any failure to open a connection and run `SELECT 1` means the database is unusable,
          // whatever the reason, so the state flips regardless of how the error is classified.
          markDisconnected(error)
          settleRecoveryWaiters(false)
          return false
        } finally {
          inFlightProbe = undefined
        }
      })()
    }

    return inFlightProbe
  }

  function scheduleProbe(error?: unknown): void {
    if (error !== undefined) {
      lastError = getErrorMessage(error)
    }

    // `enabled: false` means fail fast: keep the record of what happened, but never touch the
    // database off the back of someone else's failure. An explicit `probe()` (`ping()`) still runs.
    if (stopped || !options.enabled) {
      return
    }

    // Fire-and-forget: a health probe must not delay the caller that reported the error. `probe()`
    // already swallows failures, so the catch only guards against an unexpected throw.
    probe().catch((probeError) => logger.error('Connection probe failed', { error: getErrorMessage(probeError) }))
  }

  function startReconnectionLoop(): void {
    if (loopRunning || stopped || !options.enabled) {
      return
    }

    loopRunning = true

    // Fire-and-forget: the loop owns its own lifecycle and no caller waits on it. Failures inside
    // are already handled, so the catch only guards against an unexpected throw.
    void (async () => {
      let attempt = 0

      try {
        while (!connected && !stopped) {
          try {
            // `ref: false` keeps the loop from holding the process open while it waits.
            await delay(getBackoffDelay(attempt, options), undefined, { signal: abortController.signal, ref: false })
          } catch {
            return
          }

          if (connected || stopped) {
            return
          }

          attempt += 1
          reconnectionAttempts = attempt
          logger.debug('Attempting to reconnect to the database', { attempt })

          const succeeded = await probe()
          recordMetric((metricsComponent) =>
            metricsComponent.increment('dcl_db_reconnection_attempts_total', {
              source: 'probe',
              status: succeeded ? 'success' : 'failure'
            })
          )
        }
      } finally {
        // Cleared here rather than in a `.finally()` on the promise: this runs in the same tick as
        // the loop's own exit, so there is no window in which the manager is disconnected, no loop
        // is running, and a stale handle still makes `startReconnectionLoop()` a no-op.
        loopRunning = false
      }
    })().catch((error) => logger.error('Reconnection loop failed', { error: getErrorMessage(error) }))
  }

  async function run<T>(
    name: string,
    operation: (context: OperationContext) => Promise<T>,
    runOptions: RunOptions = {}
  ): Promise<T> {
    const maxRetries = options.enabled ? (runOptions.maxRetries ?? options.maxRetries) : 0
    const retryAfterStatementSent = runOptions.retryAfterStatementSent ?? true
    let attempt = 0

    for (;;) {
      // Circuit open: the database is known to be down and the loop is already probing it. Piling
      // this operation's own connection attempts on top would slow the recovery and cost this caller
      // the full backoff schedule, so it waits for the loop's verdict instead, one bounded wait per
      // attempt. Nothing is sent, so nothing here can violate the statement-level retry rules.
      if (!connected && loopRunning && !stopped) {
        const recovered = await waitForRecovery(options.maxDelayInMilliseconds)

        if (!recovered) {
          if (stopped || attempt >= maxRetries) {
            throw new DatabaseUnavailableError(lastError, lastErrorCause)
          }
          attempt += 1
          continue
        }
      }

      let statementSent = false
      const context: OperationContext = {
        markStatementSent: () => {
          statementSent = true
        }
      }

      try {
        const result = await operation(context)
        markConnected()
        if (attempt > 0) {
          logger.info('Database operation recovered after a connection error', { operation: name, attempt })
          recordMetric((metricsComponent) =>
            metricsComponent.increment('dcl_db_reconnection_attempts_total', { source: 'operation', status: 'success' })
          )
        }
        return result
      } catch (error) {
        notifyFailure(error)

        const isConnectionFailure = isConnectionError(error)
        if (isConnectionFailure) {
          // Counted before the budget check so the attempt that exhausts it is not invisible.
          recordMetric((metricsComponent) =>
            metricsComponent.increment('dcl_db_reconnection_attempts_total', {
              source: 'operation',
              status: 'failure'
            })
          )
        }

        const canRetry =
          isConnectionFailure &&
          (!statementSent ||
            (retryAfterStatementSent && (options.retrySentStatements || isNotSentError(error))))

        if (stopped || !canRetry || attempt >= maxRetries) {
          throw error
        }

        attempt += 1
        logger.warn('Retrying a database operation after a connection error', {
          operation: name,
          attempt,
          maxRetries,
          error: getErrorMessage(error)
        })

        // No backoff of its own. A dead pooled client is retried straight away on a fresh one — the
        // database is presumed fine. A failure to reach the server just opened the circuit through
        // notifyFailure(), so the next iteration is paced by the reconnection loop's probes.
      }
    }
  }

  function getStatus(): ConnectionStatus {
    return { connected, since, lastError, reconnectionAttempts, disconnections }
  }

  function stop(): void {
    stopped = true
    abortController.abort()
    settleRecoveryWaiters(false)
    // The loop is deliberately not awaited: it may be blocked on a probe against an unreachable host,
    // which can outlast the shutdown deadline. The flag keeps it from starting further work, and
    // closing the pool is what actually bounds the connection attempt already in flight.
  }

  return { run, notifySuccess, notifyFailure, probe, scheduleProbe, getStatus, stop }
}
