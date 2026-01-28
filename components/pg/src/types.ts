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
 */
export type Options = Partial<{ pool: PoolConfig; migration: Omit<RunnerOption, 'databaseUrl' | 'dbClient'> }>

/**
 * @public
 */
export interface IPgComponent extends IDatabase {
  start(): Promise<void>

  query<T extends Record<string, any>>(sql: string): Promise<QueryResult<T>>
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
   */
  withAsyncContextTransaction<T>(callback: () => Promise<T>): Promise<T>

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
