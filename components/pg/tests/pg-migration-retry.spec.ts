import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import runner from 'node-pg-migrate'
import { createPgComponent } from '../src/component'

// Unit tests for the migration retry loop. node-pg-migrate's runner and the pg Pool are mocked so
// the retry behavior can be exercised without a database.
jest.mock('node-pg-migrate')
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    // The checked-out client needs `on`/`off`: the component holds an 'error' listener for the
    // duration of every checkout, since `pg-pool` drops its own while the client is in use.
    connect: jest.fn().mockResolvedValue({ release: jest.fn(), on: jest.fn(), off: jest.fn(), query: jest.fn() }),
    on: jest.fn(),
    end: jest.fn(),
    query: jest.fn()
  })),
  Client: jest.fn()
}))

const mockedRunner = runner as jest.MockedFunction<typeof runner>

describe('PgComponent migration retries', () => {
  let config: IConfigComponent
  let logs: ILoggerComponent

  const migration = { dir: '/tmp/migrations', migrationsTable: 'pgmigrations', direction: 'up' as const }

  function createMockConfig(overrides: Record<string, string | number | undefined> = {}): IConfigComponent {
    const values: Record<string, string | number | undefined> = {
      PG_COMPONENT_PSQL_CONNECTION_STRING: 'postgres://user:pass@localhost/db',
      // No delay between retries so the tests run instantly.
      PG_COMPONENT_MIGRATION_RETRY_DELAY: 0,
      ...overrides
    }

    return {
      getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as string | undefined)),
      getNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as number | undefined)),
      requireString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as string)),
      requireNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] as number))
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

  beforeEach(() => {
    jest.clearAllMocks()
    config = createMockConfig()
    logs = createMockLogs()
  })

  describe('when the lock is released after a few attempts', () => {
    it('should retry and resolve', async () => {
      mockedRunner
        .mockRejectedValueOnce(new Error('Another migration is already running'))
        .mockRejectedValueOnce(new Error('Another migration is already running'))
        .mockResolvedValueOnce(undefined as never)

      const pg = await createPgComponent({ config, logs }, { migration })

      await expect(pg.start()).resolves.not.toThrow()
      expect(mockedRunner).toHaveBeenCalledTimes(3)
    })
  })

  describe('when the migration fails with an error other than a concurrent migration', () => {
    it('should rethrow immediately without retrying', async () => {
      mockedRunner.mockRejectedValue(new Error('relation "credits" does not exist'))

      const pg = await createPgComponent({ config, logs }, { migration })

      await expect(pg.start()).rejects.toThrow('relation "credits" does not exist')
      expect(mockedRunner).toHaveBeenCalledTimes(1)
    })
  })

  describe('and another migration keeps holding the lock past the configured attempts', () => {
    it('should give up and rethrow the original error', async () => {
      mockedRunner.mockRejectedValue(new Error('Another migration is already running'))
      config = createMockConfig({ PG_COMPONENT_MIGRATION_RETRY_ATTEMPTS: 3 })

      const pg = await createPgComponent({ config, logs }, { migration })

      await expect(pg.start()).rejects.toThrow('Another migration is already running')
      expect(mockedRunner).toHaveBeenCalledTimes(3)
    })
  })

  describe('when the connection drops once the migrations have begun', () => {
    let startError: Error | undefined

    beforeEach(async () => {
      // The harshest case for a replay: the error is one that proves the last statement never left
      // the client, which would earn an ordinary query a retry. A migration is caller-provided code —
      // and a non-transactional one can be half applied — so it must not be re-run.
      config = createMockConfig({
        PG_COMPONENT_RECONNECTION_START_MAX_RETRIES: 3,
        PG_COMPONENT_RECONNECTION_INITIAL_DELAY: 1,
        PG_COMPONENT_RECONNECTION_MAX_DELAY: 1
      })
      mockedRunner.mockRejectedValue(new Error('Client has encountered a connection error and is not queryable'))

      const pg = await createPgComponent({ config, logs }, { migration })

      startError = undefined
      try {
        await pg.start()
      } catch (error) {
        startError = error as Error
      }
    })

    it('should fail to start with the connection error', () => {
      expect(startError?.message).toMatch(/not queryable/)
    })

    it('should have run the migrations exactly once', () => {
      expect(mockedRunner).toHaveBeenCalledTimes(1)
    })
  })
})
