import { IFetchComponent } from '@well-known-components/interfaces'

export const createFetchMockedComponent = (
  overrides?: Partial<jest.Mocked<IFetchComponent>>
): jest.Mocked<IFetchComponent> => {
  return {
    fetch: overrides?.fetch ?? jest.fn()
  }
}
