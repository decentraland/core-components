import { IFetchComponent } from '@well-known-components/interfaces'
import { Response as NodeFetchResponse } from 'node-fetch'
import { createCachedFetchComponent } from '../src/component'
import {
  createUndiciFetchComponent,
  createNativeFetchComponent,
  MockFetchComponent
} from './mocks/fetch'

/**
 * These tests verify that the cached fetch component works correctly with
 * different fetch implementations (undici, native fetch).
 *
 * The component should be agnostic to the underlying fetch implementation,
 * though cached responses will always be node-fetch Response objects.
 */

describe('when testing fetch implementation agnosticism', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and using undici as the fetch implementation', () => {
    let mockFetchComponent: MockFetchComponent
    let component: IFetchComponent

    beforeEach(async () => {
      mockFetchComponent = createUndiciFetchComponent((url) => ({
        body: JSON.stringify({ url, source: 'undici' }),
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
      component = await createCachedFetchComponent(mockFetchComponent as unknown as IFetchComponent)
    })

    it('should cache responses from undici fetch', async () => {
      await component.fetch('https://example.com/api')
      await component.fetch('https://example.com/api')

      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
    })

    it('should return parseable JSON from cached undici response', async () => {
      const response = await component.fetch('https://example.com/api')
      const data = await response.json()

      expect(data.source).toBe('undici')
    })

    it('should return node-fetch Response type for cached responses', async () => {
      await component.fetch('https://example.com/api')
      const cachedResponse = await component.fetch('https://example.com/api')

      expect(cachedResponse).toBeInstanceOf(NodeFetchResponse)
    })

    it('should preserve status and headers from undici response', async () => {
      const response = await component.fetch('https://example.com/api')

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('and using native fetch as the fetch implementation', () => {
    let mockFetchComponent: MockFetchComponent
    let component: IFetchComponent

    beforeEach(async () => {
      mockFetchComponent = createNativeFetchComponent((url) => ({
        body: JSON.stringify({ url, source: 'native' }),
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
      component = await createCachedFetchComponent(mockFetchComponent as unknown as IFetchComponent)
    })

    it('should cache responses from native fetch', async () => {
      await component.fetch('https://example.com/api')
      await component.fetch('https://example.com/api')

      expect(mockFetchComponent.fetch).toHaveBeenCalledTimes(1)
    })

    it('should return parseable JSON from cached native response', async () => {
      const response = await component.fetch('https://example.com/api')
      const data = await response.json()

      expect(data.source).toBe('native')
    })

    it('should return node-fetch Response type for cached responses', async () => {
      await component.fetch('https://example.com/api')
      const cachedResponse = await component.fetch('https://example.com/api')

      expect(cachedResponse).toBeInstanceOf(NodeFetchResponse)
    })

    it('should preserve status and headers from native response', async () => {
      const response = await component.fetch('https://example.com/api')

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('and handling different Response behaviors', () => {
    describe('and the response has error status', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        const mockFetchComponent = createUndiciFetchComponent(() => ({
          body: 'Not Found',
          status: 404
        }))
        component = await createCachedFetchComponent(mockFetchComponent as unknown as IFetchComponent, {
          cacheableErrorStatusCodes: [404]
        })
      })

      it('should cache error responses and preserve status', async () => {
        const response1 = await component.fetch('https://example.com/missing')
        const response2 = await component.fetch('https://example.com/missing')

        expect(response1.status).toBe(404)
        expect(response2.status).toBe(404)
      })

      it('should mark cached error responses as not ok', async () => {
        const response = await component.fetch('https://example.com/missing')

        expect(response.ok).toBe(false)
      })
    })

    describe('and the response has custom headers', () => {
      let component: IFetchComponent

      beforeEach(async () => {
        const mockFetchComponent = createNativeFetchComponent(() => ({
          body: 'OK',
          status: 200,
          headers: {
            'X-Custom-Header': 'custom-value',
            'X-Another-Header': 'another-value'
          }
        }))
        component = await createCachedFetchComponent(mockFetchComponent as unknown as IFetchComponent)
      })

      it('should preserve X-Custom-Header from native response', async () => {
        await component.fetch('https://example.com/api')
        const cachedResponse = await component.fetch('https://example.com/api')

        expect(cachedResponse.headers.get('X-Custom-Header')).toBe('custom-value')
      })

      it('should preserve X-Another-Header from native response', async () => {
        await component.fetch('https://example.com/api')
        const cachedResponse = await component.fetch('https://example.com/api')

        expect(cachedResponse.headers.get('X-Another-Header')).toBe('another-value')
      })
    })

    describe('and using binary response body', () => {
      let component: IFetchComponent
      let binaryData: Uint8Array

      beforeEach(async () => {
        binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello" in bytes
        const mockFetchComponent = createNativeFetchComponent(() => ({
          body: binaryData,
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        }))
        component = await createCachedFetchComponent(mockFetchComponent as unknown as IFetchComponent)
      })

      it('should preserve binary data through cache', async () => {
        await component.fetch('https://example.com/binary')
        const cachedResponse = await component.fetch('https://example.com/binary')

        const buffer = await cachedResponse.arrayBuffer()
        const cachedData = new Uint8Array(buffer)

        expect(cachedData).toEqual(binaryData)
      })
    })
  })
})
