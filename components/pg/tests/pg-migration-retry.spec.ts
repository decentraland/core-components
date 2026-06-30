import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import runner from 'node-pg-migrate'
import { createPgComponent } from '../src/component'

// Unit tests for the migration retry loop. node-pg-migrate's runner and the pg Pool are mocked so
// the retry behavior can be exercised without a database.
jest.mock('node-pg-migrate')
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({ release: jest.fn() }),
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
})
