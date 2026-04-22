import { AsyncLocalStorage } from 'async_hooks'
import { IBaseComponent, IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { Client, Pool, PoolClient, PoolConfig } from 'pg'
import { NoticeMessage } from 'pg-protocol/dist/messages'
import QueryStream from 'pg-query-stream'
import runner, { RunnerOption } from 'node-pg-migrate'
import { SQLStatement } from 'sql-template-strings'
import { setTimeout } from 'timers/promises'
import { Options, IPgComponent, IMetricsComponent, QueryStreamWithCallback, QueryResult } from './types'

export * from './types'
export * from './metrics'

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
    connectionTimeoutMillis
  }

  const STREAM_QUERY_TIMEOUT = await config.getNumber('PG_COMPONENT_STREAM_QUERY_TIMEOUT')
  const GRACE_PERIODS = (await config.getNumber('PG_COMPONENT_GRACE_PERIODS')) ?? 10
  const STOP_TIMEOUT = (await config.getNumber('PG_COMPONENT_STOP_TIMEOUT')) ?? 30_000

  const finalOptions: PoolConfig = { ...defaultOptions, ...options.pool }

  // Config
  const pool: Pool = new Pool(finalOptions)

  // Idle-client errors are emitted on the pool and would otherwise become
  // unhandled Node errors. Surface them through the logger so the process stays up.
  const onPoolError = (error: Error) => {
    logger.error('Idle pg client error', {
      error: error?.message ?? String(error),
      stack: error?.stack ?? ''
    })
  }
  pool.on('error', onPoolError)

  // Async context for transaction client
  const transactionContext = new AsyncLocalStorage<PoolClient>()

  let didStart = false

  // Methods
  async function start() {
    if (didStart) {
      logger.warn('Start called more than once, ignoring')
      return
    }
    didStart = true

    try {
      const db = await pool.connect()

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
          await runner(opt)
        }
      } catch (err: any) {
        logger.error('Migration failed', {
          error: err?.message ?? String(err),
          stack: err?.stack ?? ''
        })
        throw err
      } finally {
        db.release()
      }
    } catch (error: any) {
      logger.error('Error starting pg-component', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? ''
      })
      throw error
    }
  }

  async function executeInTransaction<T>(runCallback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    let rollbackError: Error | undefined

    try {
      await client.query('BEGIN')
      const result = await runCallback(client)
      await client.query('COMMIT')

      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (err: any) {
        rollbackError = err
        logger.error('Error rolling back transaction', { error: err?.message ?? String(err) })
      }
      throw error
    } finally {
      client.release(rollbackError)
    }
  }

  async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return executeInTransaction(callback)
  }

  async function withAsyncContextTransaction<T>(callback: () => Promise<T>): Promise<T> {
    return executeInTransaction((client) => transactionContext.run(client, callback))
  }

  async function doQuery<T extends Record<string, any>>(sql: string | SQLStatement): Promise<QueryResult<T>> {
    const notices: NoticeMessage[] = []

    // Get the transaction's context client or connect a new one
    const transactionClient = transactionContext.getStore()
    const client = transactionClient ?? (await pool.connect())

    function listenNotice(notice: NoticeMessage) {
      notices.push(notice)
    }

    try {
      client.on('notice', listenNotice)

      const result = await client.query<T>(sql)
      return { ...result, rowCount: result.rowCount ?? 0, notices }
    } finally {
      client.off('notice', listenNotice)
      // Only release if we created a new connection (not from transaction context)
      if (!transactionClient) {
        client.release()
      }
    }
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
    const client = new Client({
      ...finalOptions,
      // Only override when a stream-specific timeout is configured, otherwise fall back
      // to `finalOptions.query_timeout` (an explicit `undefined` here would clobber it).
      ...(STREAM_QUERY_TIMEOUT !== undefined ? { query_timeout: STREAM_QUERY_TIMEOUT } : {})
    })

    // Socket errors on the dedicated stream client would otherwise bubble up as
    // unhandled 'error' events on the EventEmitter. Surface them through the logger.
    const onClientError = (error: Error) => {
      logger.error('Stream pg client error', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? ''
      })
    }
    client.on('error', onClientError)

    try {
      await client.connect()
    } catch (err) {
      client.off('error', onClientError)
      throw err
    }

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

      for await (const row of stream) {
        yield row
      }

      stream.callback(undefined, undefined)
    } catch (err) {
      stream.callback(err, undefined)
      throw err
    } finally {
      stream.destroy()
      client.off('error', onClientError)
      await client.end()
    }
  }

  let didStop = false

  async function stop() {
    if (didStop) {
      logger.error('Stop called more than once')
      return
    }
    didStop = true

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
    start,
    stop
  }
}
