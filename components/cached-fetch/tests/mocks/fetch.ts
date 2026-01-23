import { IFetchComponent } from '@well-known-components/interfaces'
import { Response as UndiciResponse } from 'undici'

export type MockFetch = jest.MockedFunction<IFetchComponent['fetch']>

export type MockFetchComponent = {
  fetch: jest.Mock
}

export function createMockFetchComponent(): MockFetchComponent {
  return {
    fetch: jest.fn()
  }
}

export type ResponseFactory = (url: string) => {
  body: string | Uint8Array
  status: number
  headers?: Record<string, string>
}

/**
 * Creates a mock fetch component using undici Response
 */
export function createUndiciFetchComponent(responseFactory?: ResponseFactory): MockFetchComponent {
  return {
    fetch: jest.fn(async (url: string) => {
      const { body, status, headers } = responseFactory?.(url) ?? { body: '', status: 200 }
      return new UndiciResponse(body, { status, headers })
    })
  }
}

/**
 * Creates a mock fetch component using native fetch Response
 */
export function createNativeFetchComponent(responseFactory?: ResponseFactory): MockFetchComponent {
  return {
    fetch: jest.fn(async (url: string) => {
      const { body, status, headers } = responseFactory?.(url) ?? { body: '', status: 200 }
      return new globalThis.Response(body, { status, headers })
    })
  }
}
