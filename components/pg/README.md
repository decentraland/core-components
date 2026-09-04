# @dcl/pg-component

A PostgreSQL database component that provides connection pooling, transaction management, query streaming, and migration support.

## Installation

```bash
npm install @dcl/pg-component
```

## Usage

```typescript
import { createPgComponent } from '@dcl/pg-component'
import SQL from 'sql-template-strings'

// Create the component with required dependencies
const pg = await createPgComponent({ config, logs, metrics })

// Start the component (runs migrations if configured)
await pg.start()

// Execute queries using sql-template-strings for safe parameterization
const result = await pg.query<{ id: number; name: string }>(SQL`SELECT * FROM users WHERE id = ${userId}`)

// Stop the component (gracefully drains connections)
await pg.stop()
```

## Features

- **Connection pooling**: Efficient connection management using `pg` Pool
- **SQL injection protection**: Use `sql-template-strings` for safe parameterized queries
- **Transaction support**: Two transaction APIs for different use cases
- **Query streaming**: Memory-efficient streaming for large result sets
- **Migration support**: Built-in support for `node-pg-migrate`
- **Automatic reconnection**: Retries operations with backoff and keeps probing the database until it is reachable again
- **Health reporting**: `getConnectionStatus()` and `ping()` for readiness probes
- **Metrics integration**: Optional query duration metrics
- **Graceful shutdown**: Drains connections before closing the pool

## Transactions

### Using `withTransaction`

Provides direct access to the transaction client:

```typescript
await pg.withTransaction(async (client) => {
  await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
  await client.query('INSERT INTO audit (action) VALUES ($1)', ['user_created'])
  // Automatically commits on success, rolls back on error
})
```

### Using `withAsyncContextTransaction`

Uses AsyncLocalStorage so nested `query()` calls automatically use the transaction client:

```typescript
await pg.withAsyncContextTransaction(async () => {
  // All pg.query() calls within this callback use the same transaction
  await pg.query(SQL`INSERT INTO users (name) VALUES ('Alice')`)
  await pg.query(SQL`INSERT INTO audit (action) VALUES ('user_created')`)
  // Automatically commits on success, rolls back on error
})
```

### Important Warnings

#### Do not use transaction control statements with `withAsyncContextTransaction`

When using `withAsyncContextTransaction`, do **not** execute `BEGIN`, `COMMIT`, or `ROLLBACK` via `query()`. The transaction lifecycle is managed automatically:

```typescript
// ❌ WRONG - Don't do this
await pg.withAsyncContextTransaction(async () => {
  await pg.query(SQL`BEGIN`) // Don't do this!
  await pg.query(SQL`INSERT INTO users (name) VALUES ('Alice')`)
  await pg.query(SQL`COMMIT`) // Don't do this!
})

// ✅ CORRECT
await pg.withAsyncContextTransaction(async () => {
  await pg.query(SQL`INSERT INTO users (name) VALUES ('Alice')`)
  // BEGIN/COMMIT/ROLLBACK are handled automatically
})
```

#### Do not run concurrent queries inside `withAsyncContextTransaction`

All `pg.query()` calls inside the callback share the single `Client` held by the async context. Running them in parallel (e.g. `Promise.all`) will issue concurrent commands on the same connection, which `pg` does not support and will fail or corrupt state:

```typescript
// ❌ WRONG - concurrent queries on the same transaction client
await pg.withAsyncContextTransaction(async () => {
  await Promise.all([
    pg.query(SQL`INSERT INTO users (name) VALUES ('Alice')`),
    pg.query(SQL`INSERT INTO users (name) VALUES ('Bob')`)
  ])
})

// ✅ CORRECT - await queries sequentially
await pg.withAsyncContextTransaction(async () => {
  await pg.query(SQL`INSERT INTO users (name) VALUES ('Alice')`)
  await pg.query(SQL`INSERT INTO users (name) VALUES ('Bob')`)
})
```

#### Nesting transactions creates independent transactions

Calling `withTransaction` or `withAsyncContextTransaction` inside another transaction method will create **independent transactions**, not nested transactions. Each call acquires a new connection from the pool:

```typescript
// ⚠️ WARNING: This creates TWO independent transactions
await pg.withAsyncContextTransaction(async () => {
  await pg.query(SQL`INSERT INTO table1 (name) VALUES ('outer')`)

  // This is a SEPARATE transaction with its own connection!
  await pg.withTransaction(async (client) => {
    await client.query(`INSERT INTO table2 (name) VALUES ('inner')`)
  })
})
```

If the inner transaction fails and rolls back, the outer transaction is **not** affected and will still commit. This is because PostgreSQL does not support true nested transactions, and each transaction method acquires its own connection.

## Reconnection

Databases go away: a failover, a restart, a network blip, or simply a service booting before its
database does. The component handles all of those without the process having to restart.

Three things happen when the connection drops:

1. **The broken connection is evicted.** A client that failed with a connection error is released
   back with an error, so `pg` destroys it instead of handing the same dead socket to the next
   caller.
2. **The operation is retried** with exponential backoff and jitter, as long as the retry is safe
   (see below).
3. **A background loop keeps probing** the database with the same backoff until it answers, so the
   pool is warm again before the next request arrives — the component does not wait for a user
   request to discover the database is back. Each probe is bounded by
   `PG_COMPONENT_RECONNECTION_PROBE_TIMEOUT`, so an unreachable host cannot park the loop (or
   `ping()`) on a connection attempt that never returns.

The pool object itself is never replaced, so a reference obtained from `getPool()` stays valid
across an outage.

Two pool settings underpin all of this and are defaulted by the component: `connectionTimeoutMillis`
(10s) and TCP `keepAlive`. Reconnection only reacts to failures it can see — a refused connection, a
reset, a closed socket. A host that silently drops packets, as a load balancer mid-failover or a
half-open socket does, produces none of those: without a connection timeout an attempt hangs for the
operating system's SYN timeout, and without keepalive an established connection never learns its
peer is gone. Both can still be overridden through `options.pool`.

One consequence of the connection timeout worth knowing: `pg` also applies it to the wait for a free
client when the pool is full, so a saturated pool now fails callers after 10s instead of queueing
them indefinitely. That failure ("timeout exceeded when trying to connect") is deliberately *not*
treated as a disconnection — the database is fine, the pool is busy — so it is neither retried nor
counted as an outage.

```typescript
const pg = await createPgComponent(
  { config, logs, metrics },
  {
    reconnection: {
      maxRetries: 5,
      initialDelayInMilliseconds: 300,
      maxDelayInMilliseconds: 5000,
      onDisconnection: (error) => logger.error('Database unreachable', { error: error.message }),
      onReconnection: (downtimeInMilliseconds) => logger.info('Database back', { downtimeInMilliseconds })
    }
  }
)
```

### What gets retried

Retrying a statement that may already have been applied would turn a write into an at-least-once
operation, so the component only retries when it can tell that is safe:

| Failure                                                            | Retried by default |
| ------------------------------------------------------------------ | ------------------ |
| The connection could not be acquired (`ECONNREFUSED`, timeouts, ...) | Yes                |
| `pg` refused to send the statement because the client was dead      | Yes                |
| The connection dropped while the statement was in flight            | No                 |
| The statement failed for any non-connection reason                  | No                 |

The second row is the common case behind a warm pool: when the database restarts, the pool still
holds sockets that are already dead, and `pg` rejects the statement before writing anything to the
wire. That error proves the statement never reached the server, which makes the retry safe.

A statement that is not retried still leaves the component healthy: the broken connection is
destroyed rather than returned to the pool, the background loop brings the pool back, and the
following query runs on a fresh connection. Only the statement that was in flight fails.

Set `retrySentStatements: true` (or `PG_COMPONENT_RECONNECTION_RETRY_SENT_STATEMENTS=true`) to also
retry statements that may have reached the server. Only do this if every statement the service
issues is idempotent: a connection can drop between a write being applied and its acknowledgement
coming back, so the retry may apply it twice.

Three cases behave differently by design:

- **Transactions** are retried only while the transaction has not started yet — that is, when the
  connection could not be acquired or `BEGIN` failed. Once the callback has run, a retry would
  repeat whatever else it did, so the error is surfaced instead. `retrySentStatements` does not
  change this: it speaks for single statements, not for arbitrary callbacks.
- **Queries inside `withAsyncContextTransaction`** are never retried: they must run on the
  transaction's own client, and retrying them on a fresh connection would silently execute them
  outside the transaction. The transaction fails as a whole and rolls back.
- **`streamQuery`** retries the connection, not the iteration. Rows already yielded cannot be
  un-yielded, so a stream that breaks mid-iteration surfaces the error to the caller — promptly,
  rather than hanging on a cursor teardown the dead connection can never acknowledge.
- **Migrations** are retried only while connecting. Once the runner has started they are never
  replayed: a migration is caller-provided code, and a non-transactional one (`CREATE INDEX
  CONCURRENTLY` and friends) can be left half applied. `start()`'s larger attempt budget still
  applies to reaching the database in the first place.

### Health checks

```typescript
// Cached state, cheap enough for a readiness probe on every request
const { connected, since, reconnectionAttempts, disconnections } = pg.getConnectionStatus()

// Actively opens a connection and runs `SELECT 1`; returns false instead of throwing
const reachable = await pg.ping()
```

`getConnectionStatus()` reports `connected: false` until the first successful interaction, so a
readiness probe built on it will not report the service as ready before the database answers.

The status also carries `lastError`, the driver's raw message, which can name hosts, ports, users or
databases (`connect ECONNREFUSED 10.0.1.5:5432`). Log it, but keep it out of the body of a public
health endpoint.

Two details worth knowing when wiring the hooks: a database that is still booting when the service
starts counts as an outage, so a slow start reports one `onDisconnection` and then one
`onReconnection`; and after `stop()`, `ping()` answers `false` without touching the closed pool and
without reporting an outage, so a readiness endpoint polled through a deploy stays quiet.

## Query Streaming

For large result sets, use `streamQuery` to avoid loading all rows into memory:

```typescript
for await (const row of pg.streamQuery<User>(SQL`SELECT * FROM large_table`)) {
  await processRow(row)
}
```

## Migrations

Configure migrations when creating the component:

```typescript
const pg = await createPgComponent(
  { config, logs },
  {
    migration: {
      migrationsTable: 'pgmigrations',
      dir: path.join(__dirname, 'migrations'),
      direction: 'up',
      count: Infinity
    }
  }
)
```

## Configuration

Environment variables read by the component:

| Variable                              | Type     | Description                              |
| ------------------------------------- | -------- | ---------------------------------------- |
| `PG_COMPONENT_PSQL_CONNECTION_STRING` | `string` | PostgreSQL connection string             |
| `PG_COMPONENT_PSQL_HOST`              | `string` | Database host                            |
| `PG_COMPONENT_PSQL_PORT`              | `number` | Database port                            |
| `PG_COMPONENT_PSQL_DATABASE`          | `string` | Database name                            |
| `PG_COMPONENT_PSQL_USER`              | `string` | Database user                            |
| `PG_COMPONENT_PSQL_PASSWORD`          | `string` | Database password                        |
| `PG_COMPONENT_IDLE_TIMEOUT`           | `number` | Idle connection timeout (ms)                                                         |
| `PG_COMPONENT_QUERY_TIMEOUT`          | `number` | Query timeout (ms)                                                                   |
| `PG_COMPONENT_STREAM_QUERY_TIMEOUT`   | `number` | Stream query timeout (ms); falls back to `PG_COMPONENT_QUERY_TIMEOUT` when unset     |
| `PG_COMPONENT_CONNECTION_TIMEOUT`     | `number` | How long `pool.connect()` waits for a connection before failing (ms; default: 10000). Also bounds how long a caller waits for a free client when the pool is full |
| `PG_COMPONENT_GRACE_PERIODS`          | `number` | Grace periods for shutdown (default: 10)                                             |
| `PG_COMPONENT_STOP_TIMEOUT`           | `number` | Upper bound (ms) for `stop()` to drain the pool before abandoning it (default: 30000) |

Reconnection settings, all overridable through the `reconnection` option passed to the factory,
which takes precedence over the environment:

| Variable                                            | Type      | Description                                                                                  |
| --------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `PG_COMPONENT_RECONNECTION_ENABLED`                 | `boolean` | Whether disconnections are retried at all (default: `true`)                                    |
| `PG_COMPONENT_RECONNECTION_MAX_RETRIES`             | `number`  | Retries per operation (default: 3)                                                             |
| `PG_COMPONENT_RECONNECTION_START_MAX_RETRIES`       | `number`  | Retries for the initial connection in `start()` (default: 30)                                  |
| `PG_COMPONENT_RECONNECTION_INITIAL_DELAY`           | `number`  | Delay before the first retry, in ms (default: 300)                                             |
| `PG_COMPONENT_RECONNECTION_MAX_DELAY`               | `number`  | Upper bound for the backoff delay, in ms (default: 1000)                                       |
| `PG_COMPONENT_RECONNECTION_BACKOFF_FACTOR`          | `number`  | Multiplier applied to the delay after every failed attempt (default: 2)                        |
| `PG_COMPONENT_RECONNECTION_PROBE_TIMEOUT`           | `number`  | How long a connection probe may take before counting as a failure, in ms (default: 5000)       |
| `PG_COMPONENT_RECONNECTION_RETRY_SENT_STATEMENTS`   | `boolean` | Also retry statements that may already have reached the server (default: `false`)              |

## Metrics

When a metrics component is provided, query durations are tracked:

```typescript
// Pass a label to track query duration
const result = await pg.query(SQL`SELECT * FROM users`, 'get_users')
```

Metrics:

| Metric                               | Type      | Labels             | Description                                                                 |
| ------------------------------------ | --------- | ------------------ | --------------------------------------------------------------------------- |
| `dcl_db_query_duration_seconds`      | histogram | `query`, `status`  | Query duration, `status` being `success` or `error`                           |
| `dcl_db_connection_status`           | gauge     | —                  | `1` while the database is reachable, `0` while it is not                      |
| `dcl_db_reconnection_attempts_total` | counter   | `source`, `status` | Recovery attempts, by `operation`/`probe` and `success`/`failure`             |

Services that build their metrics declarations by spreading `metricDeclarations` get the new metrics
automatically. Ones that declare metrics by hand will not: the component logs a warning once and
keeps serving queries rather than failing on an undeclared metric.

## Testing

Tests use [Testcontainers](https://testcontainers.com/) to run against a real PostgreSQL instance:

```bash
# Requires Docker to be running
pnpm test
```

## License

Apache-2.0
