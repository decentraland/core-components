import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createPgComponent } from '../src/component'
import { IPgComponent } from '../src/types'
import SQL from 'sql-template-strings'

describe('PgComponent', () => {
  let container: StartedPostgreSqlContainer
  let connectionString: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start()
    connectionString = container.getConnectionUri()
  }, 120000)

  afterAll(async () => {
    await container.stop()
  })

  function createMockConfig(overrides: Record<string, string | number | undefined> = {}): IConfigComponent {
    const values: Record<string, string | number | undefined> = {
      PG_COMPONENT_PSQL_CONNECTION_STRING: connectionString,
      ...overrides
    }

    return {
      getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as string | undefined)),
      getNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as number | undefined)),
      requireString: jest.fn().mockImplementation((key: string) => {
        const value = values[key]
        if (value === undefined) throw new Error(`Missing required config: ${key}`)
        return Promise.resolve(value as string)
      }),
      requireNumber: jest.fn().mockImplementation((key: string) => {
        const value = values[key]
        if (value === undefined) throw new Error(`Missing required config: ${key}`)
        return Promise.resolve(value as number)
      })
    }
  }

  function createMockLogs(): ILoggerComponent {
    return {
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
      })
    }
  }

  describe('when creating the component', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
    })

    afterEach(async () => {
      await pg.stop()
    })

    it('should create the component successfully', () => {
      expect(pg).toBeDefined()
      expect(pg.query).toBeDefined()
      expect(pg.withTransaction).toBeDefined()
      expect(pg.withAsyncContextTransaction).toBeDefined()
      expect(pg.streamQuery).toBeDefined()
      expect(pg.getPool).toBeDefined()
    })
  })

  describe('when starting the component', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
    })

    afterEach(async () => {
      await pg.stop()
    })

    it('should connect to the database successfully', async () => {
      await expect(pg.start()).resolves.not.toThrow()
    })
  })

  describe('when executing queries', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()

      // Create a test table
      await pg.query(SQL`
        CREATE TABLE IF NOT EXISTS test_table (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          value INTEGER
        )
      `)
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS test_table`)
      await pg.stop()
    })

    describe('and inserting data', () => {
      it('should insert and return the row', async () => {
        const result = await pg.query<{ id: number; name: string; value: number }>(SQL`
          INSERT INTO test_table (name, value) VALUES ('test', 42) RETURNING *
        `)

        expect(result.rowCount).toBe(1)
        expect(result.rows[0].name).toBe('test')
        expect(result.rows[0].value).toBe(42)
      })
    })

    describe('and selecting data', () => {
      beforeEach(async () => {
        await pg.query(SQL`INSERT INTO test_table (name, value) VALUES ('item1', 10)`)
        await pg.query(SQL`INSERT INTO test_table (name, value) VALUES ('item2', 20)`)
      })

      it('should return all rows', async () => {
        const result = await pg.query<{ id: number; name: string; value: number }>(SQL`
          SELECT * FROM test_table ORDER BY value
        `)

        expect(result.rowCount).toBe(2)
        expect(result.rows[0].name).toBe('item1')
        expect(result.rows[1].name).toBe('item2')
      })
    })

    describe('and updating data', () => {
      beforeEach(async () => {
        await pg.query(SQL`INSERT INTO test_table (name, value) VALUES ('update_me', 100)`)
      })

      it('should update the row', async () => {
        const result = await pg.query<{ id: number; name: string; value: number }>(SQL`
          UPDATE test_table SET value = 200 WHERE name = 'update_me' RETURNING *
        `)

        expect(result.rowCount).toBe(1)
        expect(result.rows[0].value).toBe(200)
      })
    })

    describe('and deleting data', () => {
      beforeEach(async () => {
        await pg.query(SQL`INSERT INTO test_table (name, value) VALUES ('delete_me', 999)`)
      })

      it('should delete the row', async () => {
        const deleteResult = await pg.query(SQL`DELETE FROM test_table WHERE name = 'delete_me'`)
        expect(deleteResult.rowCount).toBe(1)

        const selectResult = await pg.query(SQL`SELECT * FROM test_table WHERE name = 'delete_me'`)
        expect(selectResult.rowCount).toBe(0)
      })
    })
  })

  describe('when using withTransaction', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()

      await pg.query(SQL`
        CREATE TABLE IF NOT EXISTS transaction_test (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL
        )
      `)
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS transaction_test`)
      await pg.stop()
    })

    describe('and the transaction succeeds', () => {
      it('should commit all changes', async () => {
        await pg.withTransaction(async (client) => {
          await client.query(`INSERT INTO transaction_test (name) VALUES ('tx_item_1')`)
          await client.query(`INSERT INTO transaction_test (name) VALUES ('tx_item_2')`)
        })

        const result = await pg.query<{ name: string }>(SQL`SELECT * FROM transaction_test ORDER BY name`)
        expect(result.rowCount).toBe(2)
        expect(result.rows[0].name).toBe('tx_item_1')
        expect(result.rows[1].name).toBe('tx_item_2')
      })
    })

    describe('and the transaction fails', () => {
      it('should rollback all changes', async () => {
        await expect(
          pg.withTransaction(async (client) => {
            await client.query(`INSERT INTO transaction_test (name) VALUES ('rollback_item')`)
            throw new Error('Simulated failure')
          })
        ).rejects.toThrow('Simulated failure')

        const result = await pg.query(SQL`SELECT * FROM transaction_test WHERE name = 'rollback_item'`)
        expect(result.rowCount).toBe(0)
      })
    })

    describe('and the callback returns a value', () => {
      it('should return the value from the callback', async () => {
        const result = await pg.withTransaction(async (client) => {
          const res = await client.query(`INSERT INTO transaction_test (name) VALUES ('return_test') RETURNING id`)
          return res.rows[0].id as number
        })

        expect(typeof result).toBe('number')
        expect(result).toBeGreaterThan(0)
      })
    })
  })

  describe('when using withAsyncContextTransaction', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()

      await pg.query(SQL`
        CREATE TABLE IF NOT EXISTS async_tx_test (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL
        )
      `)
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS async_tx_test`)
      await pg.stop()
    })

    describe('and the transaction succeeds', () => {
      it('should commit all changes made via query()', async () => {
        await pg.withAsyncContextTransaction(async () => {
          await pg.query(SQL`INSERT INTO async_tx_test (name) VALUES ('async_item_1')`)
          await pg.query(SQL`INSERT INTO async_tx_test (name) VALUES ('async_item_2')`)
        })

        const result = await pg.query<{ name: string }>(SQL`SELECT * FROM async_tx_test ORDER BY name`)
        expect(result.rowCount).toBe(2)
        expect(result.rows[0].name).toBe('async_item_1')
        expect(result.rows[1].name).toBe('async_item_2')
      })
    })

    describe('and the transaction fails', () => {
      it('should rollback all changes made via query()', async () => {
        await expect(
          pg.withAsyncContextTransaction(async () => {
            await pg.query(SQL`INSERT INTO async_tx_test (name) VALUES ('async_rollback_item')`)
            throw new Error('Simulated async failure')
          })
        ).rejects.toThrow('Simulated async failure')

        const result = await pg.query(SQL`SELECT * FROM async_tx_test WHERE name = 'async_rollback_item'`)
        expect(result.rowCount).toBe(0)
      })
    })

    describe('and nested queries are executed', () => {
      it('should use the same transaction client for all queries', async () => {
        await pg.withAsyncContextTransaction(async () => {
          // Insert in transaction
          await pg.query(SQL`INSERT INTO async_tx_test (name) VALUES ('nested_1')`)

          // Query within same transaction should see uncommitted data
          const withinTx = await pg.query<{ name: string }>(SQL`SELECT * FROM async_tx_test WHERE name = 'nested_1'`)
          expect(withinTx.rowCount).toBe(1)

          // Insert another
          await pg.query(SQL`INSERT INTO async_tx_test (name) VALUES ('nested_2')`)
        })

        // After commit, both should be visible
        const result = await pg.query(SQL`SELECT * FROM async_tx_test ORDER BY name`)
        expect(result.rowCount).toBe(2)
      })
    })
  })

  describe('when using streamQuery', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig({
        PG_COMPONENT_PSQL_CONNECTION_STRING: connectionString,
        PG_COMPONENT_STREAM_QUERY_TIMEOUT: 30000
      })
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()

      await pg.query(SQL`
        CREATE TABLE IF NOT EXISTS stream_test (
          id SERIAL PRIMARY KEY,
          value INTEGER NOT NULL
        )
      `)

      // Insert test data
      for (let i = 1; i <= 100; i++) {
        await pg.query(SQL`INSERT INTO stream_test (value) VALUES (${i})`)
      }
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS stream_test`)
      await pg.stop()
    })

    describe('and streaming rows', () => {
      it('should yield all rows', async () => {
        const rows: { id: number; value: number }[] = []

        for await (const row of pg.streamQuery<{ id: number; value: number }>(
          SQL`SELECT * FROM stream_test ORDER BY value`
        )) {
          rows.push(row)
        }

        expect(rows.length).toBe(100)
        expect(rows[0].value).toBe(1)
        expect(rows[99].value).toBe(100)
      })
    })

    describe('and breaking early from the stream', () => {
      it('should stop yielding after break', async () => {
        const rows: { id: number; value: number }[] = []

        for await (const row of pg.streamQuery<{ id: number; value: number }>(
          SQL`SELECT * FROM stream_test ORDER BY value`
        )) {
          rows.push(row)
          if (rows.length >= 10) break
        }

        expect(rows.length).toBe(10)
      })
    })
  })

  describe('when stopping the component', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()
    })

    it('should close the pool gracefully', async () => {
      await expect(pg.stop()).resolves.not.toThrow()
    })

    describe('and stop is called multiple times', () => {
      it('should handle multiple stop calls without error', async () => {
        await pg.stop()
        // Second call should return early without error
        await expect(pg.stop()).resolves.not.toThrow()
      })
    })
  })

  describe('when getPool is called', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
    })

    afterEach(async () => {
      await pg.stop()
    })

    it('should return the underlying pool', () => {
      const pool = pg.getPool()
      expect(pool).toBeDefined()
      expect(typeof pool.connect).toBe('function')
      expect(typeof pool.end).toBe('function')
    })
  })

  describe('when nesting transaction methods', () => {
    let pg: IPgComponent
    let config: IConfigComponent
    let logs: ILoggerComponent

    beforeEach(async () => {
      config = createMockConfig()
      logs = createMockLogs()
      pg = await createPgComponent({ config, logs })
      await pg.start()

      await pg.query(SQL`
        CREATE TABLE IF NOT EXISTS nested_tx_test (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL
        )
      `)
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS nested_tx_test`)
      await pg.stop()
    })

    describe('and withTransaction is called inside withAsyncContextTransaction', () => {
      it('should create independent transactions (inner rollback does not affect outer)', async () => {
        await pg.withAsyncContextTransaction(async () => {
          // Insert in outer transaction
          await pg.query(SQL`INSERT INTO nested_tx_test (name) VALUES ('outer')`)

          // Inner transaction - this creates a SEPARATE transaction
          try {
            await pg.withTransaction(async (client) => {
              await client.query(`INSERT INTO nested_tx_test (name) VALUES ('inner')`)
              throw new Error('Inner rollback')
            })
          } catch {
            // Expected - inner transaction rolled back
          }

          // Outer transaction continues and commits
        })

        // Outer commit succeeded, inner rolled back
        const result = await pg.query<{ name: string }>(SQL`SELECT * FROM nested_tx_test`)
        expect(result.rowCount).toBe(1)
        expect(result.rows[0].name).toBe('outer')
      })
    })

    describe('and withAsyncContextTransaction is called inside withAsyncContextTransaction', () => {
      it('should create independent transactions (inner rollback does not affect outer)', async () => {
        await pg.withAsyncContextTransaction(async () => {
          // Insert in outer transaction
          await pg.query(SQL`INSERT INTO nested_tx_test (name) VALUES ('outer_async')`)

          // Inner async context transaction - this creates a SEPARATE transaction
          try {
            await pg.withAsyncContextTransaction(async () => {
              await pg.query(SQL`INSERT INTO nested_tx_test (name) VALUES ('inner_async')`)
              throw new Error('Inner async rollback')
            })
          } catch {
            // Expected - inner transaction rolled back
          }

          // Outer transaction continues and commits
        })

        // Outer commit succeeded, inner rolled back
        const result = await pg.query<{ name: string }>(SQL`SELECT * FROM nested_tx_test`)
        expect(result.rowCount).toBe(1)
        expect(result.rows[0].name).toBe('outer_async')
      })
    })

    describe('and withTransaction is called inside withTransaction', () => {
      it('should create independent transactions', async () => {
        await pg.withTransaction(async (outerClient) => {
          await outerClient.query(`INSERT INTO nested_tx_test (name) VALUES ('outer_tx')`)

          // Inner transaction - SEPARATE transaction
          try {
            await pg.withTransaction(async (innerClient) => {
              await innerClient.query(`INSERT INTO nested_tx_test (name) VALUES ('inner_tx')`)
              throw new Error('Inner tx rollback')
            })
          } catch {
            // Expected
          }
        })

        const result = await pg.query<{ name: string }>(SQL`SELECT * FROM nested_tx_test`)
        expect(result.rowCount).toBe(1)
        expect(result.rows[0].name).toBe('outer_tx')
      })
    })
  })
})
