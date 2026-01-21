import { IFetchComponent } from '@well-known-components/interfaces'
import { Response } from 'node-fetch'
import { createCachedFetchComponent } from '../src/component'
import { createFetchComponent } from '@well-known-components/fetch-component'

jest.mock('@well-known-components/fetch-component', () => ({
  createFetchComponent: jest.fn()
}))

describe('when using the cached fetch component', () => {
  let mockBaseFetch: jest.MockedFunction<IFetchComponent['fetch']>

  beforeEach(() => {
    mockBaseFetch = jest.fn()
    ;(createFetchComponent as jest.MockedFunction<typeof createFetchComponent>).mockReturnValue({
      fetch: mockBaseFetch
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and creating the component', () => {
    describe('and no custom fetch component is provided', () => {
      beforeEach(async () => {
        await createCachedFetchComponent()
      })

      it('should create a default fetch component', () => {
        expect(createFetchComponent).toHaveBeenCalledTimes(1)
      })
    })

    describe('and a custom fetch component is provided', () => {
      let customMockFetch: jest.MockedFunction<IFetchComponent['fetch']>
      let component: IFetchComponent

      beforeEach(async () => {
        customMockFetch = jest.fn()
        customMockFetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
        component = await createCachedFetchComponent({
          fetchComponent: { fetch: customMockFetch }
        })
      })

      it('should not create a default fetch component', () => {
        expect(createFetchComponent).not.toHaveBeenCalled()
      })

      it('should use the custom fetch component for requests', async () => {
        await component.fetch('https://example.com/api')
        expect(customMockFetch).toHaveBeenCalledWith('https://example.com/api', undefined)
      })
    })
  })

  describe('and fetching a URL', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent()
    })

    describe('and it is the first request', () => {
      let responseBody: { data: string }

      beforeEach(() => {
        responseBody = { data: 'test data' }
        mockBaseFetch.mockResolvedValue(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      })

      it('should call the underlying fetch function with the URL', async () => {
        await component.fetch('https://example.com/api')
        expect(mockBaseFetch).toHaveBeenCalledWith('https://example.com/api', undefined)
      })

      it('should return a response that can be parsed as JSON', async () => {
        const result = await component.fetch('https://example.com/api')
        expect(await result.json()).toEqual(responseBody)
      })
    })

    describe('and the same URL is requested multiple times', () => {
      const responseBody = { data: 'test data' }

      beforeEach(() => {
        mockBaseFetch.mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 })
        )
      })

      it('should call the underlying fetch function only once', async () => {
        await component.fetch('https://example.com/api')
        await component.fetch('https://example.com/api')
        await component.fetch('https://example.com/api')
        expect(mockBaseFetch).toHaveBeenCalledTimes(1)
      })

      it('should return the same data for all requests', async () => {
        const result1 = await component.fetch('https://example.com/api')
        const result2 = await component.fetch('https://example.com/api')
        expect(await result1.json()).toEqual(responseBody)
        expect(await result2.json()).toEqual(responseBody)
      })
    })

    describe('and different URLs are requested', () => {
      beforeEach(() => {
        mockBaseFetch.mockImplementation(async (url) => {
          const urlStr = typeof url === 'string' ? url : url.toString()
          return new Response(JSON.stringify({ url: urlStr }), { status: 200 })
        })
      })

      it('should call the underlying fetch function for each unique URL', async () => {
        await component.fetch('https://example.com/api/1')
        await component.fetch('https://example.com/api/2')
        await component.fetch('https://example.com/api/3')
        expect(mockBaseFetch).toHaveBeenCalledTimes(3)
      })

      it('should return different data for different URLs', async () => {
        const result1 = await component.fetch('https://example.com/api/1')
        const result2 = await component.fetch('https://example.com/api/2')
        expect((await result1.json()).url).toBe('https://example.com/api/1')
        expect((await result2.json()).url).toBe('https://example.com/api/2')
      })
    })

    describe('and using URL objects', () => {
      beforeEach(() => {
        mockBaseFetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
      })

      it('should pass the URL object to the underlying fetch', async () => {
        const url = new URL('https://example.com/api/endpoint')
        await component.fetch(url)
        expect(mockBaseFetch).toHaveBeenCalledWith(url, undefined)
      })

      it('should cache requests based on URL string representation', async () => {
        await component.fetch(new URL('https://example.com/api/endpoint'))
        await component.fetch(new URL('https://example.com/api/endpoint'))
        expect(mockBaseFetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and the fetch fails', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent()
    })

    describe('and there is a network error', () => {
      beforeEach(() => {
        mockBaseFetch.mockRejectedValue(new Error('Network error'))
      })

      it('should propagate the error to the caller', async () => {
        await expect(component.fetch('https://example.com/api')).rejects.toThrow('Network error')
      })
    })

    describe('and the response is not ok', () => {
      describe('and the status is 404', () => {
        beforeEach(() => {
          mockBaseFetch.mockResolvedValue(
            new Response('Not Found', { status: 404, statusText: 'Not Found' })
          )
        })

        it('should return a response with ok set to false', async () => {
          const result = await component.fetch('https://example.com/api')
          expect(result.ok).toBe(false)
        })

        it('should return a response with the 404 status code', async () => {
          const result = await component.fetch('https://example.com/api')
          expect(result.status).toBe(404)
        })

        it('should not cache the error response', async () => {
          await component.fetch('https://example.com/api')
          await component.fetch('https://example.com/api')
          expect(mockBaseFetch).toHaveBeenCalledTimes(2)
        })
      })

      describe('and the status is 500', () => {
        beforeEach(() => {
          mockBaseFetch.mockResolvedValue(
            new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
          )
        })

        it('should return a response with ok set to false', async () => {
          const result = await component.fetch('https://example.com/api')
          expect(result.ok).toBe(false)
        })

        it('should return a response with the 500 status code', async () => {
          const result = await component.fetch('https://example.com/api')
          expect(result.status).toBe(500)
        })
      })

      describe('and cacheableErrorStatusCodes is configured', () => {
        let componentWithCacheableStatusCodes: IFetchComponent

        beforeEach(async () => {
          componentWithCacheableStatusCodes = await createCachedFetchComponent(
            {},
            { cacheableErrorStatusCodes: [404, 410] }
          )
        })

        describe('and the status is in cacheableErrorStatusCodes', () => {
          beforeEach(() => {
            mockBaseFetch.mockImplementation(async () =>
              new Response('Not Found', { status: 404, statusText: 'Not Found' })
            )
          })

          it('should return a response with ok set to false', async () => {
            const result = await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(result.ok).toBe(false)
          })

          it('should cache the error response', async () => {
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(mockBaseFetch).toHaveBeenCalledTimes(1)
          })

          it('should return the cached error response with correct status', async () => {
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            const cachedResult = await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(cachedResult.status).toBe(404)
          })
        })

        describe('and the status is not in cacheableErrorStatusCodes', () => {
          beforeEach(() => {
            mockBaseFetch.mockImplementation(async () =>
              new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
            )
          })

          it('should not cache the error response', async () => {
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(mockBaseFetch).toHaveBeenCalledTimes(2)
          })
        })
      })
    })
  })

  describe('and using different HTTP methods', () => {
    beforeEach(() => {
      mockBaseFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
    })

    describe('and using the default configuration', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent()
      })

      describe('and making GET requests', () => {
        it('should cache GET requests with explicit method', async () => {
          await component.fetch('https://example.com/api', { method: 'GET' })
          await component.fetch('https://example.com/api', { method: 'GET' })
          expect(mockBaseFetch).toHaveBeenCalledTimes(1)
        })

        it('should cache requests without explicit method as GET', async () => {
          await component.fetch('https://example.com/api')
          await component.fetch('https://example.com/api')
          expect(mockBaseFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and making POST requests', () => {
        it('should not cache POST requests', async () => {
          await component.fetch('https://example.com/api', { method: 'POST' })
          await component.fetch('https://example.com/api', { method: 'POST' })
          expect(mockBaseFetch).toHaveBeenCalledTimes(2)
        })
      })
    })

    describe('and custom cacheable methods are configured', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent({}, { cacheableMethods: ['GET', 'POST'] })
      })

      it('should cache POST requests', async () => {
        await component.fetch('https://example.com/api', { method: 'POST' })
        await component.fetch('https://example.com/api', { method: 'POST' })
        expect(mockBaseFetch).toHaveBeenCalledTimes(1)
      })

      it('should still cache GET requests', async () => {
        await component.fetch('https://example.com/api', { method: 'GET' })
        await component.fetch('https://example.com/api', { method: 'GET' })
        expect(mockBaseFetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and using a custom TTL', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent({}, { ttl: 50 })
      mockBaseFetch.mockImplementation(async () =>
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      )
    })

    it('should cache responses within TTL', async () => {
      await component.fetch('https://example.com/api')
      await component.fetch('https://example.com/api')
      expect(mockBaseFetch).toHaveBeenCalledTimes(1)
    })

    it('should refetch after TTL expires', async () => {
      await component.fetch('https://example.com/api')
      await new Promise((resolve) => setTimeout(resolve, 100))
      await component.fetch('https://example.com/api')
      expect(mockBaseFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('and handling response headers', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent()
      mockBaseFetch.mockImplementation(async () =>
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value'
          }
        })
      )
    })

    it('should preserve response headers on first request', async () => {
      const result = await component.fetch('https://example.com/api')
      expect(result.headers.get('Content-Type')).toBe('application/json')
      expect(result.headers.get('X-Custom-Header')).toBe('custom-value')
    })

    it('should preserve response headers on cached requests', async () => {
      await component.fetch('https://example.com/api')
      const cachedResult = await component.fetch('https://example.com/api')
      expect(cachedResult.headers.get('Content-Type')).toBe('application/json')
      expect(cachedResult.headers.get('X-Custom-Header')).toBe('custom-value')
    })
  })
})
