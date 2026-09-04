import { IDatabase, IMetricsComponent as IBaseMetricsComponent } from '@well-known-components/interfaces'
import { Pool, PoolClient, PoolConfig } from 'pg'
import { NoticeMessage } from 'pg-protocol/dist/messages'
import { RunnerOption } from 'node-pg-migrate'
import { SQLStatement } from 'sql-template-strings'
import QueryStream from 'pg-query-stream'
import { metricDeclarations } from './metrics'

/**
 * @internal
 */
export type QueryStreamWithCallback = QueryStream & { callback: Function }

/**
 * @public
 *
 * Query result with notices.
 */
export type QueryResult<T extends Record<string, any>> = IDatabase.IQueryResult<T> & {
  notices: NoticeMessage[]
}

/**
 * @public
 *
 * Tunes how the component recovers from a database disconnection. Every field falls back to its
 * `PG_COMPONENT_*` environment variable and then to the built-in default.
 */
export type ReconnectionOptions = {
  /** Whether disconnections are retried at all. Defaults to `true`. */
  enabled?: boolean
  /**
   * Retries per operation once the connection drops. Defaults to `3`, which with the default delays
   * bounds a request-path query to a few seconds before it fails; the caller is usually an HTTP
   * request whose own timeout is closer than that.
   */
  maxRetries?: number
  /** Retries for the initial connection in `start()`, which usually outlasts a database boot. Defaults to `30`. */
  startMaxRetries?: number
  /** Delay before the first retry, in milliseconds. Defaults to `300`. */
  initialDelayInMilliseconds?: number
  /** Upper bound for the backoff delay, in milliseconds. Defaults to `1000`. */
  maxDelayInMilliseconds?: number
  /** Multiplier applied to the delay after every failed attempt. Defaults to `2`. */
  backoffFactor?: number
  /**
   * How long a connection probe may take before it is treated as a failure, in milliseconds.
   * Defaults to `5000`. It bounds `ping()` and the background reconnection loop even when the pool
   * has no `connectionTimeoutMillis`, where `pg` would otherwise wait on an unreachable host for as
   * long as the operating system allows.
   */
  probeTimeoutInMilliseconds?: number
  /** Called once per outage, when the component first observes that the database is unreachable. */
  onDisconnection?: (error: Error) => void
  /** Called once per recovery, with how long the database was unreachable. */
  onReconnection?: (downtimeInMilliseconds: number) => void
}

/**
 * @public
 *
 * Snapshot of what the component last observed about its connection to the database.
 */
export type ConnectionStatus = {
  /** Whether the last interaction with the database succeeded. `false` until the first one does. */
  connected: boolean
  /** Epoch milliseconds at which the component entered the current state. */
  since: number
  /**
   * Message of the last connection error observed, if any.
   *
   * @warning This is the driver's raw message and can name hosts, ports, users or databases. Log it,
   * but do not return it verbatim from a public health endpoint.
   */
  lastError?: string
  /**
   * Attempts the background reconnection loop has made within the current outage, reset once the
   * database answers again. Retries of an individual operation are not counted here — they are
   * reported through `dcl_db_reconnection_attempts_total{source="operation"}`.
   */
  reconnectionAttempts: number
  /**
   * How many times the component has observed the database become unreachable. A database that is
   * merely still booting when the service starts counts as one: it was unreachable, and then it was
   * not.
   */
  disconnections: number
}

/**
 * @public
 *
 * Per-statement options for `query()`.
 */
export type QueryOptions = {
  /** Label under which the query's duration is reported to the metrics component. */
  durationQueryNameLabel?: string
  /**
   * Declares that running the statement twice has the same effect as running it once, which lets the
   * component replay it after a connection dropped while it was in flight. Off by default because a
   * connection can drop between a write being applied and its acknowledgement arriving, so a replay
   * of a non-idempotent write applies it twice. Reads, upserts and idempotent writes are safe to mark.
   */
  idempotent?: boolean
}

/**
 * @public
 */
export type Options = Partial<{
  pool: PoolConfig
  migration: Omit<RunnerOption, 'databaseUrl' | 'dbClient'>
  reconnection: ReconnectionOptions
}>

/**
 * @public
 */
export interface IPgComponent extends IDatabase {
  start(): Promise<void>

  /**
   * Runs a statement. The second argument is either the metrics label the duration is reported under
   * or a {@link QueryOptions} object, which can also mark the statement as idempotent.
   */
  query<T extends Record<string, any>>(sql: string, options?: string | QueryOptions): Promise<QueryResult<T>>
  query<T extends Record<string, any>>(sql: SQLStatement, options?: string | QueryOptions): Promise<QueryResult<T>>
  streamQuery<T = any>(sql: SQLStatement, config?: { batchSize?: number }): AsyncGenerator<T>
  /**
   * Executes a callback within a transaction using a client.
   * The client is acquired from the pool and released after the callback is executed.
   * If an error occurs, the transaction is rolled back and the client is released.
   *
   * @warning Nesting transaction methods (calling `withTransaction` or `withAsyncContextTransaction`
   * inside this callback) will create independent transactions, not nested transactions.
   * Each call acquires a new connection from the pool.
   *
   * @warning A connection failure is only retried before the transaction starts, so the callback is
   * never re-run; a callback cannot be declared idempotent the way a single statement can.
   */
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>
  /**
   * Executes a callback within a transaction using async context.
   * The client is acquired from the pool and released after the callback is executed.
   * If an error occurs, the transaction is rolled back and the client is released.
   * All calls to query() within the callback will automatically use the transaction's client.
   *
   * @warning Do not execute transaction control statements (BEGIN, COMMIT, ROLLBACK) via `query()`
   * within this callback, as the transaction lifecycle is managed automatically.
   *
   * @warning Nesting transaction methods (calling `withTransaction` or `withAsyncContextTransaction`
   * inside this callback) will create independent transactions, not nested transactions.
   * Each call acquires a new connection from the pool.
   *
   * @warning Queries executed concurrently inside the callback (e.g. via `Promise.all`) share a
   * single pg `Client` and are not supported. Await queries sequentially within the transaction.
   *
   * @warning Queries inside the callback are never retried on a connection failure: a fresh
   * connection would run them outside the transaction. The transaction fails as a whole instead.
   */
  withAsyncContextTransaction<T>(callback: () => Promise<T>): Promise<T>

  /**
   * Returns what the component last observed about its connection to the database. Cheap enough for
   * a readiness probe: it reports cached state instead of touching the database.
   */
  getConnectionStatus(): ConnectionStatus

  /**
   * Opens a connection and runs a trivial statement to check the database is reachable right now,
   * updating the reported status with the outcome. Returns `false` instead of throwing.
   */
  ping(): Promise<boolean>

  /**
   * @internal
   */
  getPool(): Pool

  stop(): Promise<void>
}

/**
 * @public
 */
export namespace IPgComponent {
  /**
   * @public
   */
  export type Composable = {
    pg: IPgComponent
  }
}

/**
 * @public
 */
export type IMetricsComponent = IBaseMetricsComponent<keyof typeof metricDeclarations>
