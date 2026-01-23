import { IFetchComponent } from '@well-known-components/interfaces'
import { Response } from 'node-fetch'
import { createCachedFetchComponent } from '../src/component'
import { createMockFetchComponent, MockFetchComponent } from './mocks/fetch'

describe('when using the cached fetch component', () => {
  let mockFetchComponent: MockFetchComponent

  beforeEach(() => {
    mockFetchComponent = createMockFetchComponent()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and creating the component', () => {
    describe('and no custom fetch component is provided', () => {
      it('should create the component without errors', async () => {
        await expect(createCachedFetchComponent()).resolves.toBeDefined()
      })
    })

    describe('and a custom fetch component is provided', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
        component = await createCachedFetchComponent(mockFetchComponent)
      })

      it('should use the custom fetch component for requests', async () => {
        await component.fetch('https://example.com/api')
        expect(mockFetchComponent.fetch).toHaveBeenCalledWith('https://example.com/api', undefined)
      })
    })
  })

  describe('and fetching a URL', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent(mockFetchComponent)
    })

    describe('and it is the first request', () => {
      let responseBody: { data: string }

      beforeEach(() => {
        responseBody = { data: 'test data' }
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      })

      it('should call the underlying fetch function with the URL', async () => {
        await component.fetch('https://example.com/api')
        expect(mockFetchComponent.fetch).toHaveBeenCalledWith('https://example.com/api', undefined)
      })

      it('should return a response that can be parsed as JSON', async () => {
        const result = await component.fetch('https://example.com/api')
        expect(await result.json()).toEqual(responseBody)
      })
    })

    describe('and the same URL is requested multiple times', () => {
      let responseBody: { data: string }

      beforeEach(() => {
        responseBody = { data: 'test data' }
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 })
        )
      })

      it('should call the underlying fetch function only once', async () => {
        await component.fetch('https://example.com/api')
        await component.fetch('https://example.com/api')
        await component.fetch('https://example.com/api')
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
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
        mockFetchComponent.fetch.mockImplementation(async (url) => {
          const urlStr = typeof url === 'string' ? url : url.toString()
          return new Response(JSON.stringify({ url: urlStr }), { status: 200 })
        })
      })

      it('should call the underlying fetch function for each unique URL', async () => {
        await component.fetch('https://example.com/api/1')
        await component.fetch('https://example.com/api/2')
        await component.fetch('https://example.com/api/3')
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(3)
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
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
      })

      it('should pass the URL object to the underlying fetch', async () => {
        const url = new URL('https://example.com/api/endpoint')
        await component.fetch(url)
        expect(mockFetchComponent.fetch).toHaveBeenCalledWith(url, undefined)
      })

      it('should cache requests based on URL string representation', async () => {
        await component.fetch(new URL('https://example.com/api/endpoint'))
        await component.fetch(new URL('https://example.com/api/endpoint'))
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and the fetch fails', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent(mockFetchComponent)
    })

    describe('and there is a network error', () => {
      beforeEach(() => {
        mockFetchComponent.fetch.mockRejectedValue(new Error('Network error'))
      })

      it('should propagate the error to the caller', async () => {
        await expect(component.fetch('https://example.com/api')).rejects.toThrow('Network error')
      })
    })

    describe('and the response is not ok', () => {
      describe('and the status is 404', () => {
        beforeEach(() => {
          mockFetchComponent.fetch.mockResolvedValue(
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
          expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
        })
      })

      describe('and the status is 500', () => {
        beforeEach(() => {
          mockFetchComponent.fetch.mockResolvedValue(
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
            mockFetchComponent,
            { cacheableErrorStatusCodes: [404, 410] }
          )
        })

        describe('and the status is in cacheableErrorStatusCodes', () => {
          beforeEach(() => {
            mockFetchComponent.fetch.mockImplementation(async () =>
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
            expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
          })

          it('should return the cached error response with correct status', async () => {
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            const cachedResult = await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(cachedResult.status).toBe(404)
          })
        })

        describe('and the status is not in cacheableErrorStatusCodes', () => {
          beforeEach(() => {
            mockFetchComponent.fetch.mockImplementation(async () =>
              new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
            )
          })

          it('should not cache the error response', async () => {
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            await componentWithCacheableStatusCodes.fetch('https://example.com/api')
            expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
          })
        })
      })
    })
  })

  describe('and using different HTTP methods', () => {
    beforeEach(() => {
      mockFetchComponent.fetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
    })

    describe('and using the default configuration', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent(mockFetchComponent)
      })

      describe('and making GET requests', () => {
        it('should cache GET requests with explicit method', async () => {
          await component.fetch('https://example.com/api', { method: 'GET' })
          await component.fetch('https://example.com/api', { method: 'GET' })
          expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
        })

        it('should cache requests without explicit method as GET', async () => {
          await component.fetch('https://example.com/api')
          await component.fetch('https://example.com/api')
          expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and making POST requests', () => {
        it('should not cache POST requests', async () => {
          await component.fetch('https://example.com/api', { method: 'POST' })
          await component.fetch('https://example.com/api', { method: 'POST' })
          expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
        })
      })
    })

    describe('and custom cacheable methods are configured', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent(mockFetchComponent, { cacheableMethods: ['GET', 'POST'] })
      })

      it('should cache POST requests', async () => {
        await component.fetch('https://example.com/api', { method: 'POST' })
        await component.fetch('https://example.com/api', { method: 'POST' })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })

      it('should still cache GET requests', async () => {
        await component.fetch('https://example.com/api', { method: 'GET' })
        await component.fetch('https://example.com/api', { method: 'GET' })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and using a custom TTL', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent(mockFetchComponent, { ttl: 50 })
      mockFetchComponent.fetch.mockImplementation(async () =>
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      )
    })

    it('should cache responses within TTL', async () => {
      await component.fetch('https://example.com/api')
      await component.fetch('https://example.com/api')
      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
    })

    it('should refetch after TTL expires', async () => {
      await component.fetch('https://example.com/api')
      await new Promise((resolve) => setTimeout(resolve, 100))
      await component.fetch('https://example.com/api')
      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('and handling response headers', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent(mockFetchComponent)
      mockFetchComponent.fetch.mockImplementation(async () =>
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

  describe('and using cacheKeyHeaders', () => {
    describe('and Authorization header is included in cache key', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent(mockFetchComponent, {
          cacheKeyHeaders: ['Authorization']
        })
        mockFetchComponent.fetch.mockImplementation(async (_url, init) => {
          const headers = init?.headers as Record<string, string> | undefined
          const auth = headers?.Authorization ?? 'none'
          return new Response(JSON.stringify({ user: auth }), { status: 200 })
        })
      })

      it('should cache separately for different Authorization headers', async () => {
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user2' }
        })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
      })

      it('should return cached response for same Authorization header', async () => {
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })

      it('should return correct data for each user', async () => {
        const result1 = await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        const result2 = await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user2' }
        })
        expect((await result1.json()).user).toBe('Bearer user1')
        expect((await result2.json()).user).toBe('Bearer user2')
      })
    })

    describe('and no cacheKeyHeaders is configured', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent(mockFetchComponent)
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
      })

      it('should share cache for different headers', async () => {
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user2' }
        })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })
    })

    describe('and header names have different casing', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        component = await createCachedFetchComponent(mockFetchComponent, {
          cacheKeyHeaders: ['authorization']
        })
        mockFetchComponent.fetch.mockResolvedValue(
          new Response(JSON.stringify({ data: 'test' }), { status: 200 })
        )
      })

      it('should match headers regardless of case', async () => {
        await component.fetch('https://example.com/api', {
          headers: { Authorization: 'Bearer user1' }
        })
        await component.fetch('https://example.com/api', {
          headers: { AUTHORIZATION: 'Bearer user1' }
        })
        expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and caching requests with body', () => {
    let component: IFetchComponent

    beforeEach(async () => {
      component = await createCachedFetchComponent(mockFetchComponent, {
        cacheableMethods: ['POST']
      })
      mockFetchComponent.fetch.mockImplementation(async (_url, init) => {
        const body = init?.body ?? 'no body'
        return new Response(JSON.stringify({ received: body }), { status: 200 })
      })
    })

    it('should cache separately for different request bodies', async () => {
      await component.fetch('https://example.com/api', {
        method: 'POST',
        body: JSON.stringify({ id: 1 })
      })
      await component.fetch('https://example.com/api', {
        method: 'POST',
        body: JSON.stringify({ id: 2 })
      })
      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(2)
    })

    it('should return cached response for same request body', async () => {
      await component.fetch('https://example.com/api', {
        method: 'POST',
        body: JSON.stringify({ id: 1 })
      })
      await component.fetch('https://example.com/api', {
        method: 'POST',
        body: JSON.stringify({ id: 1 })
      })
      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
