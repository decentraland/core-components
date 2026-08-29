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
  /** Retries per operation once the connection drops. Defaults to `5`. */
  maxRetries?: number
  /** Retries for the initial connection in `start()`, which usually outlasts a database boot. Defaults to `10`. */
  startMaxRetries?: number
  /** Delay before the first retry, in milliseconds. Defaults to `300`. */
  initialDelayInMilliseconds?: number
  /** Upper bound for the backoff delay, in milliseconds. Defaults to `5000`. */
  maxDelayInMilliseconds?: number
  /** Multiplier applied to the delay after every failed attempt. Defaults to `2`. */
  backoffFactor?: number
  /**
   * Whether to also retry statements that may already have reached the server. Defaults to `false`,
   * because a connection can drop between a write being applied and its acknowledgement arriving, so
   * enabling this turns every write into at-least-once delivery. Leave it off unless every statement
   * the service issues is idempotent.
   */
  retrySentStatements?: boolean
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
  /** Message of the last connection error observed, if any. */
  lastError?: string
  /** Failed reconnection attempts within the current outage. Reset once the database answers again. */
  reconnectionAttempts: number
  /** How many times the component has lost the connection since it was created. */
  disconnections: number
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

  query<T extends Record<string, any>>(sql: string, durationQueryNameLabel?: string): Promise<QueryResult<T>>
  query<T extends Record<string, any>>(sql: SQLStatement, durationQueryNameLabel?: string): Promise<QueryResult<T>>
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
   * not re-run. With `retrySentStatements` enabled it can be, and must then be idempotent.
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
