import { ITracerComponent, IFetchComponent } from '@well-known-components/interfaces'
import { createTracedFetcherComponent } from '../src/component'
import { createFetchComponent } from '@well-known-components/fetch-component'

// Mock the fetch component module
jest.mock('@well-known-components/fetch-component', () => ({
  createFetchComponent: jest.fn()
}))

let tracerComponent: jest.Mocked<ITracerComponent>
let mockBaseFetch: jest.MockedFunction<IFetchComponent['fetch']>
let component: IFetchComponent

beforeEach(async () => {
  // Create mocked tracer component
  tracerComponent = {
    isInsideOfTraceSpan: jest.fn(),
    getTraceChildString: jest.fn(),
    getTraceStateString: jest.fn()
  } as unknown as jest.Mocked<ITracerComponent>

  // Create mocked base fetch
  mockBaseFetch = jest.fn()
  const mockCreateFetchComponent = createFetchComponent as jest.MockedFunction<typeof createFetchComponent>
  mockCreateFetchComponent.mockReturnValue({
    fetch: mockBaseFetch
  })

  // Create the traced fetch component
  component = await createTracedFetcherComponent({ tracer: tracerComponent })
})

describe('when fetching without being inside a trace span', () => {
  beforeEach(() => {
    tracerComponent.isInsideOfTraceSpan.mockReturnValue(false)
  })

  describe('and making a request without headers', () => {
    beforeEach(async () => {
      mockBaseFetch.mockResolvedValue({} as any)
      await component.fetch('https://example.com')
    })

    it('should call the base fetch without trace headers', () => {
      expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', { headers: {} })
    })

    it('should not call getTraceChildString', () => {
      expect(tracerComponent.getTraceChildString).not.toHaveBeenCalled()
    })

    it('should not call getTraceStateString', () => {
      expect(tracerComponent.getTraceStateString).not.toHaveBeenCalled()
    })
  })

  describe('and making a request with existing headers as object', () => {
    beforeEach(async () => {
      mockBaseFetch.mockResolvedValue({} as any)
      await component.fetch('https://example.com', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        }
      })
    })

    it('should preserve existing headers without adding trace headers', () => {
      expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        }
      })
    })
  })

  describe('and making a request with existing headers as Headers object', () => {
    beforeEach(async () => {
      const headers = {
        forEach: (callback: (value: string, key: string) => void) => {
          callback('application/json', 'Content-Type')
          callback('custom-value', 'X-Custom-Header')
        }
      }

      mockBaseFetch.mockResolvedValue({} as any)
      await component.fetch('https://example.com', { headers: headers as any })
    })

    it('should convert Headers object to plain object without adding trace headers', () => {
      expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value'
        }
      })
    })
  })

  describe('and making a request with existing headers as iterable array', () => {
    beforeEach(async () => {
      // Note: Arrays have a forEach method, so they match isHeadersLike and are treated as Headers-like objects
      // The forEach for arrays passes (element, index) not (value, key), so we get index as key
      const headersArray: Array<[string, string]> = [
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer token123']
      ]

      mockBaseFetch.mockResolvedValue({} as any)
      await component.fetch('https://example.com', {
        headers: headersArray as any
      })
    })

    it('should handle array headers via forEach (treating array indices as keys)', () => {
      // Arrays match isHeadersLike because they have forEach, but array.forEach passes (element, index)
      // So we get the array index as the key and the whole tuple as the value
      expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
        headers: {
          '0': ['Content-Type', 'application/json'],
          '1': ['Authorization', 'Bearer token123']
        }
      })
    })
  })
})

describe('when fetching inside a trace span', () => {
  const traceParent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
  const traceState = 'congo=t61rcWkgMzE'

  beforeEach(() => {
    tracerComponent.isInsideOfTraceSpan.mockReturnValue(true)
    tracerComponent.getTraceChildString.mockReturnValue(traceParent)
  })

  describe('and trace state is available', () => {
    beforeEach(() => {
      tracerComponent.getTraceStateString.mockReturnValue(traceState)
    })

    describe('and making a request without existing headers', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com')
      })

      it('should add traceparent and tracestate headers', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            traceparent: traceParent,
            tracestate: traceState
          }
        })
      })

      it('should call getTraceChildString', () => {
        expect(tracerComponent.getTraceChildString).toHaveBeenCalledTimes(1)
      })

      it('should call getTraceStateString', () => {
        expect(tracerComponent.getTraceStateString).toHaveBeenCalledTimes(1)
      })
    })

    describe('and making a request with existing headers as object', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token123'
          }
        })
      })

      it('should merge trace headers with existing headers', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token123',
            traceparent: traceParent,
            tracestate: traceState
          }
        })
      })
    })

    describe('and making a request with existing headers as Headers object', () => {
      beforeEach(async () => {
        const headers = {
          forEach: (callback: (value: string, key: string) => void) => {
            callback('application/json', 'Content-Type')
            callback('custom-value', 'X-Custom-Header')
          }
        }

        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com', { headers: headers as any })
      })

      it('should merge trace headers with converted Headers object', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
            traceparent: traceParent,
            tracestate: traceState
          }
        })
      })
    })

    describe('and making a request with existing headers as iterable array', () => {
      beforeEach(async () => {
        // Note: Arrays have a forEach method, so they match isHeadersLike and are treated as Headers-like objects
        // The forEach for arrays passes (element, index) not (value, key), so we get index as key
        const headersArray: Array<[string, string]> = [
          ['Content-Type', 'application/json'],
          ['Authorization', 'Bearer token123']
        ]

        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com', {
          headers: headersArray as any
        })
      })

      it('should handle array headers via forEach and add trace headers', () => {
        // Arrays match isHeadersLike because they have forEach, but array.forEach passes (element, index)
        // So we get the array index as the key and the whole tuple as the value
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            '0': ['Content-Type', 'application/json'],
            '1': ['Authorization', 'Bearer token123'],
            traceparent: traceParent,
            tracestate: traceState
          }
        })
      })
    })

    describe('and making a request with additional fetch options', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ data: 'test' }),
          headers: {
            'Content-Type': 'application/json'
          }
        })
      })

      it('should preserve all fetch options and add trace headers', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ data: 'test' }),
          headers: {
            'Content-Type': 'application/json',
            traceparent: traceParent,
            tracestate: traceState
          }
        })
      })
    })
  })

  describe('and trace state is not available', () => {
    beforeEach(() => {
      tracerComponent.getTraceStateString.mockReturnValue(undefined)
    })

    describe('and making a request without existing headers', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com')
      })

      it('should add only traceparent header without tracestate', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            traceparent: traceParent
          }
        })
      })

      it('should call getTraceChildString', () => {
        expect(tracerComponent.getTraceChildString).toHaveBeenCalledTimes(1)
      })

      it('should call getTraceStateString', () => {
        expect(tracerComponent.getTraceStateString).toHaveBeenCalledTimes(1)
      })
    })

    describe('and making a request with existing headers', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com', {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      })

      it('should merge only traceparent with existing headers', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            'Content-Type': 'application/json',
            traceparent: traceParent
          }
        })
      })
    })
  })

  describe('and trace state is an empty string', () => {
    beforeEach(() => {
      tracerComponent.getTraceStateString.mockReturnValue('')
    })

    describe('and making a request', () => {
      beforeEach(async () => {
        mockBaseFetch.mockResolvedValue({} as any)
        await component.fetch('https://example.com')
      })

      it('should add only traceparent header when tracestate is empty', () => {
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com', {
          headers: {
            traceparent: traceParent
          }
        })
      })
    })
  })
})

describe('when handling response from base fetch', () => {
  const mockResponse = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    json: async () => ({ data: 'test' }),
    text: async () => 'test'
  }

  beforeEach(() => {
    tracerComponent.isInsideOfTraceSpan.mockReturnValue(false)
  })

  describe('and the fetch succeeds', () => {
    beforeEach(() => {
      mockBaseFetch.mockResolvedValue(mockResponse as any)
    })

    it('should return the response from base fetch', async () => {
      const result = await component.fetch('https://example.com')
      expect(result).toBe(mockResponse)
    })
  })

  describe('and the fetch fails', () => {
    const error = new Error('Network error')

    beforeEach(() => {
      mockBaseFetch.mockRejectedValue(error)
    })

    it('should propagate the error', async () => {
      await expect(component.fetch('https://example.com')).rejects.toThrow('Network error')
    })
  })
})

describe('when making requests with different URL types', () => {
  beforeEach(() => {
    tracerComponent.isInsideOfTraceSpan.mockReturnValue(false)
    mockBaseFetch.mockResolvedValue({} as any)
  })

  describe('and using URL object', () => {
    it('should work with URL objects', async () => {
      const url = new URL('https://example.com/path?query=value')
      await component.fetch(url)

      expect(mockBaseFetch).toHaveBeenCalledWith(url, { headers: {} })
    })
  })

  describe('and using string URL', () => {
    it('should work with string URLs', async () => {
      await component.fetch('https://example.com/api/endpoint')

      expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com/api/endpoint', { headers: {} })
    })
  })
})

describe('when providing a custom fetch component', () => {
  let customFetchComponent: IFetchComponent
  let customMockFetch: jest.MockedFunction<IFetchComponent['fetch']>
  let customComponent: IFetchComponent

  beforeEach(async () => {
    // Create a custom fetch component mock
    customMockFetch = jest.fn()
    customFetchComponent = {
      fetch: customMockFetch
    }

    // Reset tracer mocks
    tracerComponent.isInsideOfTraceSpan.mockReturnValue(false)

    // Create traced fetch component with custom fetch component
    customComponent = await createTracedFetcherComponent({
      tracer: tracerComponent,
      fetchComponent: customFetchComponent
    })
  })

  describe('and making a request', () => {
    beforeEach(async () => {
      const mockResponse = { ok: true, status: 200 }
      customMockFetch.mockResolvedValue(mockResponse as any)
      await customComponent.fetch('https://example.com', {
        method: 'GET',
        headers: { 'X-Custom': 'header' }
      })
    })

    it('should use the provided fetch component instead of creating a new one', () => {
      expect(customMockFetch).toHaveBeenCalledTimes(1)
      expect(customMockFetch).toHaveBeenCalledWith('https://example.com', {
        method: 'GET',
        headers: { 'X-Custom': 'header' }
      })
    })

    it('should not call the default createFetchComponent', () => {
      // The mock from beforeEach at the top should not be called since we're bypassing it
      expect(mockBaseFetch).not.toHaveBeenCalled()
    })
  })

  describe('and making a request inside a trace span', () => {
    const traceParent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const traceState = 'congo=t61rcWkgMzE'

    beforeEach(async () => {
      tracerComponent.isInsideOfTraceSpan.mockReturnValue(true)
      tracerComponent.getTraceChildString.mockReturnValue(traceParent)
      tracerComponent.getTraceStateString.mockReturnValue(traceState)

      const mockResponse = { ok: true, status: 200 }
      customMockFetch.mockResolvedValue(mockResponse as any)
      await customComponent.fetch('https://example.com', {
        headers: { Authorization: 'Bearer token' }
      })
    })

    it('should use the custom fetch component with trace headers added', () => {
      expect(customMockFetch).toHaveBeenCalledWith('https://example.com', {
        headers: {
          Authorization: 'Bearer token',
          traceparent: traceParent,
          tracestate: traceState
        }
      })
    })

    it('should not call the default createFetchComponent', () => {
      expect(mockBaseFetch).not.toHaveBeenCalled()
    })
  })
})
