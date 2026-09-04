import { AsyncLocalStorage } from 'async_hooks'
import { IBaseComponent, IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { Client, Pool, PoolClient, PoolConfig } from 'pg'
import { NoticeMessage } from 'pg-protocol/dist/messages'
import QueryStream from 'pg-query-stream'
import runner, { RunnerOption } from 'node-pg-migrate'
import { SQLStatement } from 'sql-template-strings'
import { setTimeout } from 'timers/promises'
import {
  ConnectionStatus,
  Options,
  IPgComponent,
  IMetricsComponent,
  QueryStreamWithCallback,
  QueryResult,
  ReconnectionOptions
} from './types'
import {
  createReconnectionManager,
  isConnectionError,
  ResolvedReconnectionOptions,
  DEFAULT_RECONNECTION_OPTIONS
} from './reconnection'

export * from './types'
export * from './metrics'
// Named rather than a star re-export: the rest of `./reconnection` is `@internal`, and with no
// api-extractor in the build a star would publish it as part of the package surface.
export { DEFAULT_RECONNECTION_OPTIONS, getBackoffDelay, isConnectionError, isNotSentError } from './reconnection'

/**
 * @internal
 */
export async function runReportingQueryDurationMetric<T>(
  components: { metrics: IMetricsComponent },
  queryNameLabel: string,
  functionToRun: () => Promise<T>
): Promise<T> {
  const { metrics } = components

  const { end: endTimer } = metrics.startTimer('dcl_db_query_duration_seconds', {
    query: queryNameLabel
  })
  try {
    const res = await functionToRun()
    endTimer({ status: 'success' })
    return res
  } catch (err) {
    endTimer({ status: 'error' })
    throw err
  }
}

const TRUE_CONFIG_VALUES = ['true', '1', 'yes']
const FALSE_CONFIG_VALUES = ['false', '0', 'no']

/**
 * Rejects anything that is not recognizably a boolean instead of falling back silently: a typo in
 * `PG_COMPONENT_RECONNECTION_ENABLED` would otherwise turn reconnection off without a trace.
 */
function parseBooleanConfig(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (TRUE_CONFIG_VALUES.includes(normalized)) {
    return true
  }
  if (FALSE_CONFIG_VALUES.includes(normalized)) {
    return false
  }

  const accepted = [...TRUE_CONFIG_VALUES, ...FALSE_CONFIG_VALUES].join(', ')
  throw new TypeError(`${name} must be one of ${accepted}, got "${value}"`)
}

/**
 * @internal
 */
export function assertValidReconnectionOptions(options: ResolvedReconnectionOptions): void {
  const invalidField = (
    [
      ['maxRetries', options.maxRetries, 0],
      ['startMaxRetries', options.startMaxRetries, 0],
      // The delays have a floor of one millisecond: a zero delay would turn the background
      // reconnection loop into an unthrottled hammer against a database that is already struggling.
      ['initialDelayInMilliseconds', options.initialDelayInMilliseconds, 1],
      ['maxDelayInMilliseconds', options.maxDelayInMilliseconds, 1],
      ['probeTimeoutInMilliseconds', options.probeTimeoutInMilliseconds, 1],
      ['backoffFactor', options.backoffFactor, 1]
    ] as const
  ).find(([, value, minimum]) => !Number.isFinite(value) || value < minimum)

  if (invalidField) {
    const [name, value, minimum] = invalidField
    throw new TypeError(
      `reconnection: "${name}" must be a finite number greater than or equal to ${minimum}, got ${value}`
    )
  }
}

/**
 * Query a Postgres (https://www.postgresql.org) database with ease.
 * It uses a pool behind the scenes and will try to gracefully close it after finishing the connection.
 * @public
 */
export async function createPgComponent(
  components: { logs: ILoggerComponent; config: IConfigComponent; metrics?: IMetricsComponent },
  options: Options = {}
): Promise<IPgComponent & IBaseComponent> {
  const { config, logs } = components
  const logger = logs.getLogger('pg-component')

  // Environment
  const [
    connectionString,
    port,
    host,
    database,
    user,
    password,
    idleTimeoutMillis,
    query_timeout,
    connectionTimeoutMillis
  ] = await Promise.all([
    config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING'),
    config.getNumber('PG_COMPONENT_PSQL_PORT'),
    config.getString('PG_COMPONENT_PSQL_HOST'),
    config.getString('PG_COMPONENT_PSQL_DATABASE'),
    config.getString('PG_COMPONENT_PSQL_USER'),
    config.getString('PG_COMPONENT_PSQL_PASSWORD'),
    config.getNumber('PG_COMPONENT_IDLE_TIMEOUT'),
    config.getNumber('PG_COMPONENT_QUERY_TIMEOUT'),
    config.getNumber('PG_COMPONENT_CONNECTION_TIMEOUT')
  ])
  const defaultOptions: PoolConfig = {
    connectionString,
    port,
    host,
    database,
    user,
    password,
    idleTimeoutMillis,
    query_timeout,
    // Reconnection only reacts to failures it can see. A host that silently drops packets — a load
    // balancer failing over, a security group change, a half-open socket — produces none, so
    // without these two settings a connection attempt hangs for the OS's SYN timeout (minutes) and
    // an established connection never learns the peer is gone. Both are overridable through
    // `options.pool`.
    connectionTimeoutMillis: connectionTimeoutMillis ?? 10_000,
    keepAlive: true
  }

  const STREAM_QUERY_TIMEOUT = await config.getNumber('PG_COMPONENT_STREAM_QUERY_TIMEOUT')
  const GRACE_PERIODS = (await config.getNumber('PG_COMPONENT_GRACE_PERIODS')) ?? 10
  const STOP_TIMEOUT = (await config.getNumber('PG_COMPONENT_STOP_TIMEOUT')) ?? 30_000
  const MIGRATION_RETRY_ATTEMPTS = (await config.getNumber('PG_COMPONENT_MIGRATION_RETRY_ATTEMPTS')) ?? 30
  const MIGRATION_RETRY_DELAY = (await config.getNumber('PG_COMPONENT_MIGRATION_RETRY_DELAY')) ?? 1000

  const finalOptions: PoolConfig = { ...defaultOptions, ...options.pool }

  const reconnectionOptions = await resolveReconnectionOptions(config, options.reconnection)
  assertValidReconnectionOptions(reconnectionOptions)

  // Config
  const pool: Pool = new Pool(finalOptions)

  // Async context for transaction client
  const transactionContext = new AsyncLocalStorage<PoolClient>()

  const reconnection = createReconnectionManager({ logs, metrics: components.metrics }, reconnectionOptions, () =>
    probeConnection()
  )

  // Idle-client errors are emitted on the pool and would otherwise become
  // unhandled Node errors. Surface them through the logger so the process stays up.
  const onPoolError = (error: Error) => {
    logger.error('Idle pg client error', {
      error: error?.message ?? String(error),
      stack: error?.stack ?? ''
    })
    // An idle client dying can mean anything from a server-side idle timeout to the database going
    // away, so confirm with a probe rather than flipping the reported status on the error alone.
    reconnection.scheduleProbe(error)
  }
  pool.on('error', onPoolError)

  let didStart = false

  // node-pg-migrate guards against concurrent migrations with a non-blocking advisory lock
  // (pg_try_advisory_lock) and throws "Another migration is already running" when it cannot acquire
  // it. When several pg-components migrate the same database around the same time (e.g. multiple
  // components started together on boot), the ones that lose the race would otherwise fail outright
  // — and a caller that does not fail fast (such as a components lifecycle) can hang on that error.
  // Retry with a short backoff so they serialize behind whichever migration currently holds the
  // lock instead of erroring.
  async function runMigrations(opt: RunnerOption) {
    for (let attempt = 1; attempt <= MIGRATION_RETRY_ATTEMPTS; attempt++) {
      try {
        await runner(opt)
        return
      } catch (err: any) {
        // node-pg-migrate does not export a typed error for this, so we match the message it throws
        // from its lock() helper. This is coupled to node-pg-migrate's wording (verified against
        // node-pg-migrate@7.x); if the message changes upstream, this matcher must be updated.
        const isAnotherMigrationRunning = /Another migration is already running/i.test(err?.message ?? String(err))

        if (!isAnotherMigrationRunning || attempt === MIGRATION_RETRY_ATTEMPTS) {
          throw err
        }

        // Jitter the backoff so concurrent retriers don't retry in lockstep and keep colliding.
        const delay = MIGRATION_RETRY_DELAY + Math.floor(Math.random() * (MIGRATION_RETRY_DELAY / 2))
        logger.warn(`Another migration is already running, retrying (attempt ${attempt}/${MIGRATION_RETRY_ATTEMPTS})`)
        await setTimeout(delay)
      }
    }
  }

  /**
   * Opens a connection and runs a trivial statement. Used both by the health check and by the
   * background reconnection loop to decide whether the database is reachable again.
   */
  async function probeConnection(): Promise<void> {
    const client = await pool.connect()
    const detachClientErrorHandler = attachClientErrorHandler(client)
    let probeError: unknown

    try {
      await client.query('SELECT 1')
    } catch (error) {
      probeError = error
      throw error
    } finally {
      detachClientErrorHandler()
      releaseClient(client, probeError)
    }
  }

  /**
   * Releasing with an error makes `pg` destroy the client instead of returning a broken connection
   * to the pool, so the next checkout opens a fresh one instead of failing the same way.
   */
  function releaseClient(client: PoolClient, error?: unknown): void {
    client.release(isConnectionError(error) ? true : undefined)
  }

  /**
   * `pg-pool` removes its own 'error' listener while a client is checked out, so a socket dying
   * mid-statement emits an unhandled 'error' event and takes the process down with it. Holding a
   * listener for the duration of the checkout keeps the failure to the rejected statement, which the
   * caller already sees. Returns the function that detaches it, which must run before releasing the
   * client so the pool's own listener is not shadowed.
   */
  function attachClientErrorHandler(client: PoolClient): () => void {
    const onClientError = (error: Error) => {
      logger.error('Checked out pg client error', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? ''
      })
      reconnection.notifyFailure(error)
    }

    client.on('error', onClientError)
    return () => {
      client.off('error', onClientError)
    }
  }

  // Methods
  async function start() {
    if (didStart) {
      logger.warn('Start called more than once, ignoring')
      return
    }
    didStart = true

    try {
      // The database is frequently still booting when the service starts, so the initial connection
      // gets its own, larger attempt budget.
      await reconnection.run(
        'start',
        async ({ markStatementSent }) => {
          const db = await pool.connect()
          const detachClientErrorHandler = attachClientErrorHandler(db)
          let connectionError: unknown

          try {
            if (options.migration) {
              logger.debug('Running migrations:')

              const opt: RunnerOption = {
                ...options.migration,
                dbClient: db
              }

              if (!opt.logger) {
                opt.logger = logger
              }

              // Migrations mutate the schema: past this point a retry could re-apply work.
              markStatementSent()
              await runMigrations(opt)
            }
          } catch (err: any) {
            connectionError = err
            logger.error('Migration failed', {
              error: err?.message ?? String(err),
              stack: err?.stack ?? ''
            })
            throw err
          } finally {
            detachClientErrorHandler()
            releaseClient(db, connectionError)
          }
        },
        // Migrations are caller-provided code and can be non-transactional (`CREATE INDEX
        // CONCURRENTLY` and friends), so a half-applied one must never be replayed. Connect-phase
        // retries are unaffected: the marker is only set once migrations begin.
        { maxRetries: reconnectionOptions.startMaxRetries, retryAfterStatementSent: false }
      )
    } catch (error: any) {
      logger.error('Error starting pg-component', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? ''
      })
      throw error
    }
  }

  async function executeInTransaction<T>(runCallback: (client: PoolClient) => Promise<T>): Promise<T> {
    // A retry re-runs the caller's callback, so it is only allowed while the transaction has not
    // started yet: after `BEGIN` succeeds the callback may already have applied writes or caused
    // side effects outside the database. `retrySentStatements` does not lift this — it speaks for
    // single statements, which the component can reason about, not for arbitrary callbacks.
    return reconnection.run(
      'transaction',
      async ({ markStatementSent }) => {
        const client = await pool.connect()
        const detachClientErrorHandler = attachClientErrorHandler(client)
        let rollbackError: Error | undefined
        let transactionError: unknown

        try {
          await client.query('BEGIN')
          markStatementSent()
          const result = await runCallback(client)
          await client.query('COMMIT')

          return result
        } catch (error) {
          transactionError = error
          try {
            await client.query('ROLLBACK')
          } catch (err: any) {
            rollbackError = err
            logger.error('Error rolling back transaction', { error: err?.message ?? String(err) })
          }
          throw error
        } finally {
          detachClientErrorHandler()
          if (rollbackError) {
            client.release(rollbackError)
          } else {
            releaseClient(client, transactionError)
          }
        }
      },
      { retryAfterStatementSent: false }
    )
  }

  async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return executeInTransaction(callback)
  }

  async function withAsyncContextTransaction<T>(callback: () => Promise<T>): Promise<T> {
    return executeInTransaction((client) => transactionContext.run(client, callback))
  }

  async function runQueryOnClient<T extends Record<string, any>>(
    client: PoolClient,
    sql: string | SQLStatement
  ): Promise<QueryResult<T>> {
    const notices: NoticeMessage[] = []

    function listenNotice(notice: NoticeMessage) {
      notices.push(notice)
    }

    try {
      client.on('notice', listenNotice)

      const result = await client.query<T>(sql)
      return { ...result, rowCount: result.rowCount ?? 0, notices }
    } finally {
      client.off('notice', listenNotice)
    }
  }

  async function doQuery<T extends Record<string, any>>(sql: string | SQLStatement): Promise<QueryResult<T>> {
    const transactionClient = transactionContext.getStore()

    // Inside a transaction the statement must run on the transaction's own client: retrying it on a
    // fresh connection would silently execute it outside the transaction, so the error is surfaced
    // and the whole transaction is left to fail.
    if (transactionClient) {
      try {
        const result = await runQueryOnClient<T>(transactionClient, sql)
        reconnection.notifySuccess()
        return result
      } catch (error) {
        reconnection.notifyFailure(error)
        throw error
      }
    }

    return reconnection.run('query', async ({ markStatementSent }) => {
      const client = await pool.connect()
      const detachClientErrorHandler = attachClientErrorHandler(client)
      let queryError: unknown

      try {
        markStatementSent()
        return await runQueryOnClient<T>(client, sql)
      } catch (error) {
        queryError = error
        throw error
      } finally {
        detachClientErrorHandler()
        releaseClient(client, queryError)
      }
    })
  }

  const metricsComponent = components.metrics

  async function query<T extends Record<string, any>>(
    sql: string | SQLStatement,
    durationQueryNameLabel?: string
  ): Promise<QueryResult<T>> {
    if (durationQueryNameLabel && metricsComponent) {
      return runReportingQueryDurationMetric({ metrics: metricsComponent }, durationQueryNameLabel, () =>
        doQuery<T>(sql)
      )
    }
    return doQuery<T>(sql)
  }

  async function* streamQuery<T>(sql: SQLStatement, config?: { batchSize?: number }): AsyncGenerator<T> {
    // Socket errors on the dedicated stream client would otherwise bubble up as
    // unhandled 'error' events on the EventEmitter. Surface them through the logger.
    const onClientError = (error: Error) => {
      logger.error('Stream pg client error', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? ''
      })
      reconnection.notifyFailure(error)
    }

    // Only the connection is retried: rows already yielded cannot be un-yielded, so a stream that
    // breaks mid-iteration is surfaced to the caller instead of silently restarting.
    const client = await reconnection.run('streamQuery.connect', async () => {
      const streamClient = new Client({
        ...finalOptions,
        // Only override when a stream-specific timeout is configured, otherwise fall back
        // to `finalOptions.query_timeout` (an explicit `undefined` here would clobber it).
        ...(STREAM_QUERY_TIMEOUT !== undefined ? { query_timeout: STREAM_QUERY_TIMEOUT } : {})
      })

      streamClient.on('error', onClientError)

      try {
        await streamClient.connect()
        return streamClient
      } catch (err) {
        streamClient.off('error', onClientError)
        // A client whose connection failed cannot be reused, so the next attempt builds a new one.
        await streamClient.end().catch(() => undefined)
        throw err
      }
    })

    // A connection that dies mid-stream leaves `pg-cursor` waiting for a `readyForQuery` that can
    // never arrive, so destroying the stream never completes and the iteration would hang forever.
    // The client's 'end' event fires as soon as the socket is gone, which is what unblocks it.
    let signalConnectionLost: (error: Error) => void = () => undefined
    const connectionLost = new Promise<never>((_, reject) => {
      signalConnectionLost = reject
    })
    // Only the race below ever consumes this promise; keep the rejection from escaping unhandled.
    connectionLost.catch(() => undefined)

    const onClientEnd = () => {
      signalConnectionLost(new Error('Connection terminated unexpectedly'))
    }
    client.on('end', onClientEnd)

    // TODO: remove this workaround once node-postgres/pg-query-stream#1860 is fixed.
    // https://github.com/brianc/node-postgres/issues/1860
    // Symptom: `Uncaught TypeError: queryCallback is not a function` when
    // `query_timeout` is configured. We must install a noop `callback` on the
    // stream (see `stream.callback` below) and invoke it on both success and
    // failure so pg's timer cleanup can run.
    const stream = new QueryStream(sql.text, sql.values, config) as QueryStreamWithCallback

    stream.callback = function () {
      // noop
    }

    try {
      client.query(stream)

      const iterator = stream[Symbol.asyncIterator]()

      for (;;) {
        const result = await Promise.race([iterator.next(), connectionLost])
        if (result.done) {
          break
        }
        yield result.value
      }

      stream.callback(undefined, undefined)
      reconnection.notifySuccess()
    } catch (err) {
      stream.callback(err, undefined)
      reconnection.notifyFailure(err)
      throw err
    } finally {
      stream.destroy()
      client.off('error', onClientError)
      client.off('end', onClientEnd)
      await client.end()
    }
  }

  async function ping(): Promise<boolean> {
    return reconnection.probe()
  }

  function getConnectionStatus(): ConnectionStatus {
    return reconnection.getStatus()
  }

  let didStop = false

  async function stop() {
    if (didStop) {
      logger.error('Stop called more than once')
      return
    }
    didStop = true

    // Stop reconnecting before draining: the pool is about to be closed, so any further attempt
    // would either race the shutdown or keep it from finishing.
    reconnection.stop()

    pool.off('error', onPoolError)

    let gracePeriods = GRACE_PERIODS

    while (gracePeriods > 0 && pool.waitingCount > 0) {
      logger.debug('Draining connections', {
        waitingCount: pool.waitingCount,
        gracePeriods
      })
      await setTimeout(200)
      gracePeriods -= 1
    }

    const promise = pool.end()
    let finished = false
    let endError: unknown

    promise.then(
      () => {
        finished = true
      },
      (err) => {
        finished = true
        endError = err
      }
    )

    const deadline = Date.now() + STOP_TIMEOUT

    while (
      !finished &&
      Date.now() < deadline &&
      (pool.totalCount > 0 || pool.idleCount > 0 || pool.waitingCount > 0)
    ) {
      logger.log('Draining connections', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      })
      await setTimeout(1000)
    }

    if (!finished) {
      logger.warn('pg-component stop timed out, abandoning remaining connections', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        timeoutMs: STOP_TIMEOUT
      })
      // pool.end() is still pending — we're no longer awaiting it, but we still
      // want any eventual failure to surface in logs instead of being silently
      // captured by the `.then(ok, rej)` handler we attached earlier.
      promise.catch((err: any) => {
        logger.error('pool.end() failed after stop timeout', {
          error: err?.message ?? String(err),
          stack: err?.stack ?? ''
        })
      })
      return
    }

    if (endError) {
      throw endError
    }
  }

  function getPool(): Pool {
    return pool
  }

  return {
    query,
    withTransaction,
    withAsyncContextTransaction,
    streamQuery,
    getPool,
    getConnectionStatus,
    ping,
    start,
    stop
  }
}

/**
 * Merges the reconnection settings from, in order of precedence, the options passed to the factory,
 * the `PG_COMPONENT_RECONNECTION_*` environment variables, and the built-in defaults.
 */
async function resolveReconnectionOptions(
  config: IConfigComponent,
  options: ReconnectionOptions = {}
): Promise<ResolvedReconnectionOptions> {
  const [
    enabled,
    maxRetries,
    startMaxRetries,
    initialDelay,
    maxDelay,
    backoffFactor,
    probeTimeout,
    retrySentStatements
  ] = await Promise.all([
      config.getString('PG_COMPONENT_RECONNECTION_ENABLED'),
      config.getNumber('PG_COMPONENT_RECONNECTION_MAX_RETRIES'),
      config.getNumber('PG_COMPONENT_RECONNECTION_START_MAX_RETRIES'),
      config.getNumber('PG_COMPONENT_RECONNECTION_INITIAL_DELAY'),
      config.getNumber('PG_COMPONENT_RECONNECTION_MAX_DELAY'),
      config.getNumber('PG_COMPONENT_RECONNECTION_BACKOFF_FACTOR'),
      config.getNumber('PG_COMPONENT_RECONNECTION_PROBE_TIMEOUT'),
      config.getString('PG_COMPONENT_RECONNECTION_RETRY_SENT_STATEMENTS')
    ])

  return {
    enabled:
      options.enabled ??
      parseBooleanConfig('PG_COMPONENT_RECONNECTION_ENABLED', enabled, DEFAULT_RECONNECTION_OPTIONS.enabled),
    maxRetries: options.maxRetries ?? maxRetries ?? DEFAULT_RECONNECTION_OPTIONS.maxRetries,
    startMaxRetries: options.startMaxRetries ?? startMaxRetries ?? DEFAULT_RECONNECTION_OPTIONS.startMaxRetries,
    initialDelayInMilliseconds:
      options.initialDelayInMilliseconds ?? initialDelay ?? DEFAULT_RECONNECTION_OPTIONS.initialDelayInMilliseconds,
    maxDelayInMilliseconds:
      options.maxDelayInMilliseconds ?? maxDelay ?? DEFAULT_RECONNECTION_OPTIONS.maxDelayInMilliseconds,
    backoffFactor: options.backoffFactor ?? backoffFactor ?? DEFAULT_RECONNECTION_OPTIONS.backoffFactor,
    probeTimeoutInMilliseconds:
      options.probeTimeoutInMilliseconds ?? probeTimeout ?? DEFAULT_RECONNECTION_OPTIONS.probeTimeoutInMilliseconds,
    retrySentStatements:
      options.retrySentStatements ??
      parseBooleanConfig(
        'PG_COMPONENT_RECONNECTION_RETRY_SENT_STATEMENTS',
        retrySentStatements,
        DEFAULT_RECONNECTION_OPTIONS.retrySentStatements
      ),
    onDisconnection: options.onDisconnection,
    onReconnection: options.onReconnection
  }
}
