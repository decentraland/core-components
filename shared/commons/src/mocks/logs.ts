import { ILoggerComponent } from '@well-known-components/interfaces'

export const createLoggerMockedComponent = (
  overrides?: Partial<jest.Mocked<ILoggerComponent.ILogger>>
): jest.Mocked<ILoggerComponent> => {
  return {
    getLogger: jest.fn().mockImplementation(
      (_: string): jest.Mocked<ILoggerComponent.ILogger> => ({
        debug: overrides?.debug ?? jest.fn(),
        info: overrides?.info ?? jest.fn(),
        warn: overrides?.warn ?? jest.fn(),
        error: overrides?.error ?? jest.fn(),
        log: overrides?.log ?? jest.fn()
      })
    )
  }
}
