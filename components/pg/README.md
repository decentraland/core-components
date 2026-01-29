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
| `PG_COMPONENT_IDLE_TIMEOUT`           | `number` | Idle connection timeout (ms)             |
| `PG_COMPONENT_QUERY_TIMEOUT`          | `number` | Query timeout (ms)                       |
| `PG_COMPONENT_STREAM_QUERY_TIMEOUT`   | `number` | Stream query timeout (ms)                |
| `PG_COMPONENT_GRACE_PERIODS`          | `number` | Grace periods for shutdown (default: 10) |

## Metrics

When a metrics component is provided, query durations are tracked:

```typescript
// Pass a label to track query duration
const result = await pg.query(SQL`SELECT * FROM users`, 'get_users')
```

Metric: `dcl_db_query_duration_seconds` with labels `query` and `status` (success/error)

## Testing

Tests use [Testcontainers](https://testcontainers.com/) to run against a real PostgreSQL instance:

```bash
# Requires Docker to be running
pnpm test
```

## License

Apache-2.0
