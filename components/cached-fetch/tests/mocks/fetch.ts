import { IFetchComponent } from '@well-known-components/interfaces'

export type MockFetch = jest.MockedFunction<IFetchComponent['fetch']>

export type MockFetchComponent = {
  fetch: MockFetch
}

export function createMockFetchComponent(): MockFetchComponent {
  return {
    fetch: jest.fn()
  }
}
