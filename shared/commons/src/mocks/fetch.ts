import { IFetchComponent } from '../types'

export const createFetchMockedComponent = (overrides?: Partial<IFetchComponent>): IFetchComponent => {
  return {
    fetch: overrides?.fetch ?? jest.fn()
  }
}
