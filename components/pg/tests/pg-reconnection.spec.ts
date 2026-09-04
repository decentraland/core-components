import net from 'net'
import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import SQL from 'sql-template-strings'
import { createPgComponent } from '../src/component'
import { Client, PoolClient } from 'pg'
import { IMetricsComponent, IPgComponent, Options } from '../src/types'
import { isNotSentError } from '../src/reconnection'
import { DatabaseUnavailableError } from '../src/errors'

/**
 * A TCP proxy in front of the database container. Closing and reopening it reproduces a real outage
 * — refused connections and sockets dropped mid-flight — without restarting PostgreSQL, which keeps
 * the suite deterministic and fast.
 */
type TcpProxy = {
  port: number
  /** Stops accepting connections and drops the live ones, as a database going away would. */
  stopAccepting(): Promise<void>
  /** Accepts connections again. */
  startAccepting(): Promise<void>
  /** Drops the live connections while still accepting new ones, as a failover would. */
  dropLiveConnections(): void
  close(): Promise<void>
}

async function createTcpProxy(targetHost: string, targetPort: number): Promise<TcpProxy> {
  const sockets = new Set<net.Socket>()

  const server = net.createServer((incoming) => {
    const outgoing = net.createConnection({ host: targetHost, port: targetPort })
    sockets.add(incoming)
    sockets.add(outgoing)

    // Both ends are torn down on purpose during the tests, so their errors are expected noise.
    incoming.on('error', () => undefined)
    outgoing.on('error', () => undefined)
    incoming.on('close', () => {
      sockets.delete(incoming)
      outgoing.destroy()
    })
    outgoing.on('close', () => {
      sockets.delete(outgoing)
      incoming.destroy()
    })

    incoming.pipe(outgoing)
    outgoing.pipe(incoming)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The TCP proxy did not bind to a port')
  }
  const port = address.port

  function dropLiveConnections(): void {
    for (const socket of sockets) {
      socket.destroy()
    }
    sockets.clear()
  }

  return {
    port,
    dropLiveConnections,
    stopAccepting: async () => {
      // The sockets have to go first: `server.close()` only calls back once every live connection is
      // gone, so closing before destroying them waits for pg's idle timeout to do it for us.
      dropLiveConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // Let `pg` observe that its sockets are gone before the test issues anything, the way a real
      // outage does — the database goes away well before the next request arrives, rather than in
      // the same turn of the event loop. `dropLiveConnections()` covers the same-turn case.
      await sleep(50)
    },
    startAccepting: async () => {
      await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    },
    close: async () => {
      dropLiveConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => global.setTimeout(resolve, milliseconds))
}

describe('PgComponent reconnection', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withUsername('test')
      .withPassword('test')
      .withDatabase('test')
      .start()
  }, 120000)

  afterAll(async () => {
    await container.stop()
  })

  function createMockConfig(proxyPort: number, overrides: Record<string, string | number | undefined> = {}) {
    const values: Record<string, string | number | undefined> = {
      PG_COMPONENT_PSQL_CONNECTION_STRING: `postgres://test:test@127.0.0.1:${proxyPort}/test`,
      PG_COMPONENT_CONNECTION_TIMEOUT: 2000,
      PG_COMPONENT_STOP_TIMEOUT: 2000,
      PG_COMPONENT_GRACE_PERIODS: 0,
      ...overrides
    }

    const config: IConfigComponent = {
      getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as string | undefined)),
      getNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as number | undefined)),
      requireString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as string)),
      requireNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as number))
    }

    return config
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

  const FAST_RECONNECTION: Options['reconnection'] = {
    maxRetries: 20,
    startMaxRetries: 20,
    initialDelayInMilliseconds: 25,
    maxDelayInMilliseconds: 100,
    backoffFactor: 2
  }

  describe('when the database is unreachable while the component starts', () => {
    let proxy: TcpProxy
    let pg: IPgComponent

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      await proxy.stopAccepting()
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    describe('and it becomes reachable before the attempts run out', () => {
      beforeEach(async () => {
        pg = await createPgComponent(
          { config: createMockConfig(proxy.port), logs: createMockLogs() },
          { reconnection: FAST_RECONNECTION }
        )

        const startPromise = pg.start()
        await sleep(150)
        await proxy.startAccepting()
        await startPromise
      })

      it('should report the connection as established', () => {
        expect(pg.getConnectionStatus().connected).toBe(true)
      })

      it('should serve queries', async () => {
        const result = await pg.query<{ value: number }>(SQL`SELECT 1 AS value`)
        expect(result.rows[0].value).toBe(1)
      })
    })

    describe('and it stays unreachable', () => {
      let startError: Error | undefined

      beforeEach(async () => {
        pg = await createPgComponent(
          { config: createMockConfig(proxy.port), logs: createMockLogs() },
          { reconnection: { ...FAST_RECONNECTION, startMaxRetries: 2 } }
        )

        startError = undefined
        try {
          await pg.start()
        } catch (error) {
          startError = error as Error
        }
      })

      it('should fail as unavailable after exhausting the attempts, with the connection error as the cause', () => {
        expect(startError).toBeInstanceOf(DatabaseUnavailableError)
        expect(String((startError as DatabaseUnavailableError)?.cause)).toMatch(/ECONNREFUSED/)
      })

      it('should report the connection as lost', () => {
        expect(pg.getConnectionStatus().connected).toBe(false)
      })
    })
  })

  describe('when the connection drops while the component is running', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let onDisconnection: jest.Mock<void, [Error]>
    let onReconnection: jest.Mock<void, [number]>

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: { ...FAST_RECONNECTION, onDisconnection, onReconnection } }
      )
      await pg.start()
      await pg.query(SQL`SELECT 1`)
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    describe('and the live connections are dropped between queries', () => {
      let result: { rows: { value: number }[] }

      beforeEach(async () => {
        proxy.dropLiveConnections()
        await sleep(50)
        result = await pg.query<{ value: number }>(SQL`SELECT 1 AS value`)
      })

      it('should serve the query on a new connection', () => {
        expect(result.rows[0].value).toBe(1)
      })
    })

    describe('and the connection is dropped while a statement is in flight', () => {
      let queryError: Error | undefined
      let nextResult: { rows: { value: number }[] }

      beforeEach(async () => {
        const inFlightQuery = pg.query(SQL`SELECT pg_sleep(1)`)
        await sleep(100)
        proxy.dropLiveConnections()

        queryError = undefined
        try {
          await inFlightQuery
        } catch (error) {
          queryError = error as Error
        }

        nextResult = await pg.query<{ value: number }>(SQL`SELECT 1 AS value`)
      })

      it('should surface the failure rather than replay a statement that may already have been applied', () => {
        expect(queryError?.message).toMatch(/Connection terminated/)
      })

      it('should keep the process alive instead of raising an unhandled client error', () => {
        expect(queryError).toBeDefined()
      })

      it('should serve the following query on a new connection', () => {
        expect(nextResult.rows[0].value).toBe(1)
      })
    })

    describe('and the database is unreachable when the query is issued', () => {
      let result: { rows: { value: number }[] }

      beforeEach(async () => {
        await proxy.stopAccepting()

        const queryPromise = pg.query<{ value: number }>(SQL`SELECT 1 AS value`)
        await sleep(150)
        await proxy.startAccepting()
        result = await queryPromise
      })

      it('should retry until the database is back and return the rows', () => {
        expect(result.rows[0].value).toBe(1)
      })

      it('should report the connection as established again', () => {
        expect(pg.getConnectionStatus().connected).toBe(true)
      })

      it('should notify the disconnection listener', () => {
        expect(onDisconnection).toHaveBeenCalledWith(expect.any(Error))
      })

      it('should notify the reconnection listener with the downtime', () => {
        expect(onReconnection).toHaveBeenCalledWith(expect.any(Number))
      })
    })

    describe('and the database is unreachable when a transaction is issued', () => {
      let result: number

      beforeEach(async () => {
        await proxy.stopAccepting()

        const transactionPromise = pg.withTransaction(async (client) => {
          const inserted = await client.query<{ value: number }>('SELECT 42 AS value')
          return inserted.rows[0].value
        })
        await sleep(150)
        await proxy.startAccepting()
        result = await transactionPromise
      })

      it('should retry the transaction until the database is back and commit it', () => {
        expect(result).toBe(42)
      })
    })

    describe('and the database is unreachable when a streamed query is issued', () => {
      let rows: { value: number }[]

      beforeEach(async () => {
        await proxy.stopAccepting()

        const streamPromise = (async () => {
          const collected: { value: number }[] = []
          for await (const row of pg.streamQuery<{ value: number }>(
            SQL`SELECT * FROM generate_series(1, 3) AS value`
          )) {
            collected.push(row)
          }
          return collected
        })()
        await sleep(150)
        await proxy.startAccepting()
        rows = await streamPromise
      })

      it('should retry the connection until the database is back and stream every row', () => {
        expect(rows).toHaveLength(3)
      })
    })

    describe('and the database stays unreachable', () => {
      let queryError: Error | undefined

      beforeEach(async () => {
        await proxy.stopAccepting()

        queryError = undefined
        try {
          await pg.query(SQL`SELECT 1`)
        } catch (error) {
          queryError = error as Error
        }
      })

      afterEach(async () => {
        await proxy.startAccepting()
      })

      it('should reject as unavailable after exhausting the retries, with the connection error as the cause', () => {
        expect(queryError).toBeInstanceOf(DatabaseUnavailableError)
        expect(String((queryError as DatabaseUnavailableError)?.cause)).toMatch(/ECONNREFUSED/)
      })

      it('should report the connection as lost', () => {
        expect(pg.getConnectionStatus().connected).toBe(false)
      })

      it('should count the outage', () => {
        expect(pg.getConnectionStatus().disconnections).toBe(1)
      })
    })

    describe('and the component is stopped while the database is still unreachable', () => {
      let stopError: Error | undefined

      beforeEach(async () => {
        await proxy.stopAccepting()
        await pg.query(SQL`SELECT 1`).catch(() => undefined)

        stopError = undefined
        try {
          await pg.stop()
        } catch (error) {
          stopError = error as Error
        }
        await proxy.startAccepting()
      })

      afterEach(async () => {
        // `stop()` already ran; the shared afterEach only needs the proxy torn down.
        await proxy.stopAccepting()
      })

      it('should shut down without waiting for the database to come back', () => {
        expect(stopError).toBeUndefined()
      })
    })
  })

  describe('when the connection drops inside a transaction', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let transactionError: Error | undefined
    let rowsAfterwards: number

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: FAST_RECONNECTION }
      )
      await pg.start()
      await pg.query(SQL`CREATE TABLE IF NOT EXISTS dropped_tx_test (name VARCHAR(255) NOT NULL)`)

      const transactionPromise = pg.withAsyncContextTransaction(async () => {
        await pg.query(SQL`INSERT INTO dropped_tx_test (name) VALUES ('doomed')`)
        await pg.query(SQL`SELECT pg_sleep(1)`)
      })
      await sleep(100)
      proxy.dropLiveConnections()

      transactionError = undefined
      try {
        await transactionPromise
      } catch (error) {
        transactionError = error as Error
      }

      await sleep(100)
      const remaining = await pg.query<{ name: string }>(SQL`SELECT * FROM dropped_tx_test`)
      rowsAfterwards = remaining.rowCount
    })

    afterEach(async () => {
      await pg.query(SQL`DROP TABLE IF EXISTS dropped_tx_test`)
      await pg.stop()
      await proxy.close()
    })

    it('should fail the transaction instead of retrying a query onto a connection outside it', () => {
      expect(transactionError?.message).toMatch(/Connection terminated/)
    })

    it('should leave nothing behind, since the server rolls the transaction back', () => {
      expect(rowsAfterwards).toBe(0)
    })
  })

  describe('when the connection drops while a query is being streamed', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let streamError: Error | undefined
    let rows: { value: number }[]

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: FAST_RECONNECTION }
      )
      await pg.start()

      rows = []
      streamError = undefined
      try {
        for await (const row of pg.streamQuery<{ value: number }>(
          SQL`SELECT * FROM generate_series(1, 200000) AS value`
        )) {
          rows.push(row)
          if (rows.length === 1) {
            proxy.dropLiveConnections()
          }
        }
      } catch (error) {
        streamError = error as Error
      }
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    it('should surface the failure instead of restarting a stream whose rows were already yielded', () => {
      expect(streamError).toBeDefined()
    })

    it('should report the connection as lost', () => {
      expect(pg.getConnectionStatus().connected).toBe(false)
    })
  })

  describe('when a metrics component is provided', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let metrics: IMetricsComponent
    let endTimer: jest.Mock<void, [Record<string, string | number>?]>

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      endTimer = jest.fn()
      metrics = {
        startTimer: jest.fn().mockReturnValue({ end: endTimer }),
        observe: jest.fn(),
        increment: jest.fn(),
        decrement: jest.fn(),
        reset: jest.fn(),
        resetAll: jest.fn(),
        getValue: jest.fn()
      }
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs(), metrics },
        { reconnection: FAST_RECONNECTION }
      )
      await pg.start()
      await pg.query(SQL`SELECT 1`, 'select_one')
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    it('should time the query under its label', () => {
      expect(metrics.startTimer).toHaveBeenCalledWith('dcl_db_query_duration_seconds', { query: 'select_one' })
    })

    it('should close the timer with a success status', () => {
      expect(endTimer).toHaveBeenCalledWith({ status: 'success' })
    })

    it('should report the database as reachable', () => {
      expect(metrics.observe).toHaveBeenCalledWith('dcl_db_connection_status', {}, 1)
    })

    describe('and the labelled query fails', () => {
      beforeEach(async () => {
        await pg.query(SQL`SELECT * FROM a_table_that_does_not_exist`, 'select_missing').catch(() => undefined)
      })

      it('should close the timer with an error status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 'error' })
      })
    })
  })

  describe('when a statement is declared idempotent', () => {
    let proxy: TcpProxy
    let pg: IPgComponent

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: FAST_RECONNECTION }
      )
      await pg.start()
      await pg.query(SQL`SELECT 1`)
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    describe('and the connection is dropped while a statement is in flight', () => {
      let result: { rows: { pg_sleep: string }[] }

      beforeEach(async () => {
        const inFlightQuery = pg.query<{ pg_sleep: string }>(SQL`SELECT pg_sleep(0.2)`, { idempotent: true })
        await sleep(50)
        proxy.dropLiveConnections()
        result = await inFlightQuery
      })

      it('should replay the statement on a new connection and return its rows', () => {
        expect(result.rows).toHaveLength(1)
      })
    })

    describe('and the connection is dropped after a transaction has begun', () => {
      let callback: jest.Mock<Promise<void>, [PoolClient]>
      let transactionError: Error | undefined

      beforeEach(async () => {
        callback = jest.fn().mockImplementation(async (client: PoolClient) => {
          await client.query('SELECT pg_sleep(1)')
        })

        const transactionPromise = pg.withTransaction(callback)
        await sleep(100)
        proxy.dropLiveConnections()

        transactionError = undefined
        try {
          await transactionPromise
        } catch (error) {
          transactionError = error as Error
        }
      })

      it('should fail the transaction rather than replay it', () => {
        expect(transactionError?.message).toMatch(/Connection terminated/)
      })

      it('should not run the callback a second time, since a callback cannot be declared idempotent', () => {
        expect(callback).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('when the pool timeout is disabled and the database accepts connections but never answers', () => {
    let silentServer: net.Server
    let silentPort: number
    let pg: IPgComponent
    let reachable: boolean
    let attemptsAfterAWhile: number

    beforeEach(async () => {
      // A host that completes the TCP handshake and then says nothing — the shape of a blackholed
      // database behind a load balancer. `pg` would wait on it for as long as its timeout allows, and a
      // timeout of `0` means forever.
      const sockets = new Set<net.Socket>()
      silentServer = net.createServer((socket) => {
        sockets.add(socket)
        socket.on('error', () => undefined)
        socket.on('close', () => sockets.delete(socket))
      })
      await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve))
      const address = silentServer.address()
      if (address === null || typeof address === 'string') {
        throw new Error('The silent server did not bind to a port')
      }
      silentPort = address.port

      pg = await createPgComponent(
        { config: createMockConfig(silentPort), logs: createMockLogs() },
        {
          pool: { connectionTimeoutMillis: 0 },
          reconnection: {
            ...FAST_RECONNECTION,
            initialDelayInMilliseconds: 10,
            maxDelayInMilliseconds: 20,
            probeTimeoutInMilliseconds: 100
          }
        }
      )

      reachable = await pg.ping()
      // Long enough for several probe cycles; a wedged loop would still be waiting on the first.
      await sleep(600)
      attemptsAfterAWhile = pg.getConnectionStatus().reconnectionAttempts

      silentServer.close()
      for (const socket of sockets) {
        socket.destroy()
      }
    })

    afterEach(async () => {
      await pg.stop()
    })

    it('should report the database as unreachable within the probe deadline', () => {
      expect(reachable).toBe(false)
    })

    it('should keep probing instead of being wedged behind the first attempt that never returned', () => {
      expect(attemptsAfterAWhile).toBeGreaterThanOrEqual(2)
    })
  })

  describe('when checking the database health while every pooled client is checked out', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let heldClient: PoolClient
    let onDisconnection: jest.Mock<void, [Error]>
    let reachable: boolean

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      onDisconnection = jest.fn()
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { pool: { max: 1 }, reconnection: { ...FAST_RECONNECTION, onDisconnection } }
      )
      await pg.start()

      // The pool's only client is busy for the whole probe: a probe that borrowed from the pool would
      // wait for it, hit its deadline, and report Postgres as down while it is perfectly healthy.
      heldClient = await pg.getPool().connect()
      reachable = await pg.ping()
    })

    afterEach(async () => {
      heldClient.release()
      await pg.stop()
      await proxy.close()
    })

    it('should still reach the database on a connection of its own', () => {
      expect(reachable).toBe(true)
    })

    it('should not mistake the busy pool for an outage', () => {
      expect(onDisconnection).not.toHaveBeenCalled()
    })
  })

  describe('when checking the database health', () => {
    let proxy: TcpProxy
    let pg: IPgComponent

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: FAST_RECONNECTION }
      )
      await pg.start()
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    describe('and the database is reachable', () => {
      let reachable: boolean

      beforeEach(async () => {
        reachable = await pg.ping()
      })

      it('should report the database as reachable', () => {
        expect(reachable).toBe(true)
      })
    })

    describe('and the database is unreachable', () => {
      let reachable: boolean

      beforeEach(async () => {
        await proxy.stopAccepting()
        reachable = await pg.ping()
      })

      afterEach(async () => {
        await proxy.startAccepting()
      })

      it('should report the database as unreachable instead of throwing', () => {
        expect(reachable).toBe(false)
      })
    })
  })

  describe('when reconnection is disabled through the environment', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let queryError: Error | undefined

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      pg = await createPgComponent({
        config: createMockConfig(proxy.port, { PG_COMPONENT_RECONNECTION_ENABLED: 'false' }),
        logs: createMockLogs()
      })
      await pg.start()
      await proxy.stopAccepting()

      queryError = undefined
      try {
        await pg.query(SQL`SELECT 1`)
      } catch (error) {
        queryError = error as Error
      }
      await proxy.startAccepting()
    })

    afterEach(async () => {
      await pg.stop()
      await proxy.close()
    })

    it('should reject the query on the first connection failure', () => {
      expect(queryError?.message).toMatch(/ECONNREFUSED/)
    })

    it('should still report the connection as lost', () => {
      expect(pg.getConnectionStatus().connected).toBe(false)
    })
  })

  describe('when a statement raises an error whose text mimics a driver disconnection', () => {
    let proxy: TcpProxy
    let pg: IPgComponent
    let onDisconnection: jest.Mock<void, [Error]>
    let queryError: Error | undefined
    let executions: string

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      onDisconnection = jest.fn()
      pg = await createPgComponent(
        { config: createMockConfig(proxy.port), logs: createMockLogs() },
        { reconnection: { ...FAST_RECONNECTION, onDisconnection } }
      )
      await pg.start()
      // A sequence survives the statement's rollback, so it counts how many times the statement ran.
      await pg.query(SQL`CREATE SEQUENCE replay_probe`)

      queryError = undefined
      try {
        await pg.query(SQL`
          DO $$ BEGIN
            PERFORM nextval('replay_probe');
            RAISE EXCEPTION 'Client has encountered a connection error and is not queryable';
          END $$
        `)
      } catch (error) {
        queryError = error as Error
      }

      const counter = await pg.query<{ last_value: string }>(SQL`SELECT last_value::text FROM replay_probe`)
      executions = counter.rows[0].last_value
    })

    afterEach(async () => {
      await pg.query(SQL`DROP SEQUENCE IF EXISTS replay_probe`)
      await pg.stop()
      await proxy.close()
    })

    it('should surface the raised error as an ordinary query failure', () => {
      expect(queryError?.message).toMatch(/not queryable/)
    })

    it('should have run the statement exactly once, not replayed it as a stale-client retry', () => {
      expect(executions).toBe('1')
    })

    it('should not report an outage the database never had', () => {
      expect(onDisconnection).not.toHaveBeenCalled()
      expect(pg.getConnectionStatus().disconnections).toBe(0)
    })
  })

  // Canaries: `isNotSentError` decides whether a failed statement is safe to retry by matching the
  // wording of errors `pg` raises internally. These pin that wording against the installed driver, so
  // an upgrade that rephrases it fails a test instead of silently disabling the safe-retry path.
  describe('when pg refuses a statement on a client that was closed', () => {
    let client: Client
    let queryError: Error | undefined

    beforeEach(async () => {
      client = new Client({ connectionString: container.getConnectionUri() })
      await client.connect()
      await client.end()

      queryError = undefined
      try {
        await client.query('SELECT 1')
      } catch (error) {
        queryError = error as Error
      }
    })

    it('should word the refusal the way the not-sent classifier expects', () => {
      expect(queryError?.message).toMatch(/not queryable/)
    })

    it('should be recognised as an error that proves the statement never left the client', () => {
      expect(isNotSentError(queryError)).toBe(true)
    })
  })

  describe('when pg refuses a statement on a client whose socket died', () => {
    let proxy: TcpProxy
    let client: Client
    let queryError: Error | undefined

    beforeEach(async () => {
      proxy = await createTcpProxy(container.getHost(), container.getPort())
      client = new Client({ connectionString: `postgres://test:test@127.0.0.1:${proxy.port}/test` })
      // The dying socket is reported on the client's 'error' event as well as through the query.
      client.on('error', () => undefined)
      await client.connect()

      proxy.dropLiveConnections()
      await sleep(50)

      queryError = undefined
      try {
        await client.query('SELECT 1')
      } catch (error) {
        queryError = error as Error
      }
    })

    afterEach(async () => {
      await client.end()
      await proxy.close()
    })

    it('should word the refusal the way the not-sent classifier expects', () => {
      expect(queryError?.message).toMatch(/not queryable/)
    })

    it('should be recognised as an error that proves the statement never left the client', () => {
      expect(isNotSentError(queryError)).toBe(true)
    })
  })

  describe('when the reconnection options are invalid', () => {
    let creationError: Error | undefined

    beforeEach(async () => {
      creationError = undefined
      try {
        await createPgComponent(
          { config: createMockConfig(0), logs: createMockLogs() },
          { reconnection: { maxRetries: -1 } }
        )
      } catch (error) {
        creationError = error as Error
      }
    })

    it('should fail to create the component naming the invalid field', () => {
      expect(creationError?.message).toMatch(/"maxRetries"/)
    })
  })

  describe('when the backoff delay is configured as zero', () => {
    let creationError: Error | undefined

    beforeEach(async () => {
      creationError = undefined
      try {
        await createPgComponent(
          { config: createMockConfig(0), logs: createMockLogs() },
          { reconnection: { initialDelayInMilliseconds: 0 } }
        )
      } catch (error) {
        creationError = error as Error
      }
    })

    it('should refuse it, since it would turn the reconnection loop into a hammer', () => {
      expect(creationError?.message).toMatch(/"initialDelayInMilliseconds"/)
    })
  })

  describe('when the reconnection flag in the environment is not a boolean', () => {
    let creationError: Error | undefined

    beforeEach(async () => {
      creationError = undefined
      try {
        await createPgComponent({
          config: createMockConfig(0, { PG_COMPONENT_RECONNECTION_ENABLED: 'maybe' }),
          logs: createMockLogs()
        })
      } catch (error) {
        creationError = error as Error
      }
    })

    it('should fail to create the component naming the variable', () => {
      expect(creationError?.message).toMatch(/PG_COMPONENT_RECONNECTION_ENABLED/)
    })
  })
})
