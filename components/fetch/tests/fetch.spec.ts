import { IFetchComponent } from '@dcl/core-commons'
import { createFetchComponent } from '../src/fetcher'

// A fetch mock mirroring undici: the returned promise rejects with an AbortError
// as soon as the request's signal aborts (and otherwise never settles). Used to
// exercise the timeout/abort paths, which rely on the fetch rejecting on abort.
const rejectOnAbort = (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      reject(abortError)
    })
  })

describe('when fetching with the fetch component', () => {
  let sut: IFetchComponent
  let fetchMock: jest.Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = jest.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    sut = createFetchComponent()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    jest.clearAllMocks()
  })

  describe('and the request succeeds', () => {
    const expectedResponseBody = { mock: 'successful' }

    beforeEach(() => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(expectedResponseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('should perform a single request and resolve the parsed body', async () => {
      const response = await (await sut.fetch('https://example.com')).json()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(response).toEqual(expectedResponseBody)
    })
  })

  describe('and the first attempt fails with a retryable status', () => {
    const expectedResponseBody = { mock: 'successful' }

    beforeEach(() => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(expectedResponseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
    })

    it('should retry and resolve the successful response from the second attempt', async () => {
      const response = await (await sut.fetch('https://example.com', { attempts: 3, retryDelay: 100 })).json()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(response).toEqual(expectedResponseBody)
    })
  })

  describe('and every attempt fails with a retryable status', () => {
    beforeEach(() => {
      fetchMock
        .mockResolvedValueOnce(new Response('test error', { status: 502, headers: { 'Content-Type': 'text/plain' } }))
        .mockResolvedValueOnce(new Response('test error', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
        .mockResolvedValueOnce(new Response('test error', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    })

    it('should exhaust the retries and resolve the latest response instead of throwing', async () => {
      const response = await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })

      expect(response.status).toBe(503)
      expect(await response.text()).toBe('test error')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the first attempt fails with a network error', () => {
    const expectedResponseBody = { mock: 'successful' }

    beforeEach(() => {
      fetchMock.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(
        new Response(JSON.stringify(expectedResponseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('should retry and resolve the successful response from the second attempt', async () => {
      const response = await (await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })).json()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(response).toEqual(expectedResponseBody)
    })
  })

  describe('and every attempt fails with a network error', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue(new Error('network error'))
    })

    it('should exhaust the retries and re-throw the last network error', async () => {
      await expect(sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })).rejects.toThrow('network error')

      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and an attempt fails with a retryable status before succeeding', () => {
    const expectedResponseBody = { mock: 'successful' }
    let cancelMock: jest.Mock

    beforeEach(() => {
      cancelMock = jest.fn().mockResolvedValue(undefined)
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          body: { cancel: cancelMock }
        })
        .mockResolvedValueOnce(
          new Response(JSON.stringify(expectedResponseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
    })

    it('should cancel the discarded response body before retrying so the connection is released', async () => {
      await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })

      expect(cancelMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and a network error is followed by a retryable status', () => {
    const expectedResponseBody = { mock: 'successful' }

    beforeEach(() => {
      fetchMock
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(new Response('test error', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(expectedResponseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
    })

    it('should keep retrying across both failure types and resolve the successful response', async () => {
      const response = await (await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })).json()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(response).toEqual(expectedResponseBody)
    })
  })

  describe('and a non-idempotent method fails with a network error', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue(new Error('network error'))
    })

    it('should not retry a POST request and re-throw the network error', async () => {
      await expect(
        sut.fetch('https://example.com', { method: 'POST', attempts: 3, retryDelay: 10 })
      ).rejects.toThrow('network error')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the request exceeds the configured timeout', () => {
    beforeEach(() => {
      // The timeout timer aborts the request's signal; undici (and this mock)
      // reject the in-flight fetch when that happens.
      fetchMock.mockImplementation(rejectOnAbort)
    })

    it('should throw a timeout error', async () => {
      await expect(sut.fetch('https://example.com', { timeout: 500 })).rejects.toThrow('Request aborted (timed out)')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the request completes before the configured timeout', () => {
    const expectedResponseBody = { mock: 'successful' }

    beforeEach(() => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify(expectedResponseBody), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                  })
                ),
              50
            )
          })
      )
    })

    it('should resolve the parsed body', async () => {
      const response = await (await sut.fetch('https://example.com', { timeout: 3000 })).json()

      expect(response).toEqual(expectedResponseBody)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and default headers are configured', () => {
    const defaultHeaders = { 'X-Custom': 'Test' }

    beforeEach(() => {
      sut = createFetchComponent({ defaultHeaders })
      fetchMock.mockResolvedValue(new Response('test', { status: 200 }))
    })

    it('should send the default headers', async () => {
      await sut.fetch('https://example.com')

      expect(fetchMock.mock.calls[0][1].headers).toEqual(defaultHeaders)
    })

    describe('and the same header is passed on the call', () => {
      const overwrittenHeader = { 'X-Custom': 'Override' }

      it('should override the default header with the call header', async () => {
        await sut.fetch('https://example.com', { headers: overwrittenHeader })

        expect(fetchMock.mock.calls[0][1].headers).toEqual(overwrittenHeader)
      })
    })
  })

  describe('and default fetcher options are configured', () => {
    const defaultBodyOption = JSON.stringify({ test: 'test' })

    beforeEach(() => {
      sut = createFetchComponent({ defaultFetcherOptions: { body: defaultBodyOption } })
      fetchMock.mockResolvedValue(new Response('test', { status: 200 }))
    })

    it('should send the default fetcher options', async () => {
      await sut.fetch('https://example.com')

      expect(fetchMock.mock.calls[0][1].body).toEqual(defaultBodyOption)
    })

    describe('and the same option is passed on the call', () => {
      const overwrittenBody = JSON.stringify({ overwritten: 'overwritten' })

      it('should override the default option with the call option', async () => {
        await sut.fetch('https://example.com', { body: overwrittenBody })

        expect(fetchMock.mock.calls[0][1].body).toEqual(overwrittenBody)
      })
    })
  })

  describe('and the request uses a non-idempotent method', () => {
    beforeEach(() => {
      fetchMock
        .mockResolvedValueOnce(new Response('test error', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ mock: 'successful' }), { status: 200 }))
    })

    it('should not retry a POST request', async () => {
      const response = await sut.fetch('https://example.com', { method: 'POST', attempts: 3, retryDelay: 10 })

      expect(response.status).toBe(503)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the request fails with a non-retryable status', () => {
    const nonRetryableStatuses = [400, 401, 403, 404]

    nonRetryableStatuses.forEach((status) => {
      describe(`and the status is ${status}`, () => {
        beforeEach(() => {
          fetchMock
            .mockResolvedValueOnce(new Response('test error', { status, headers: { 'Content-Type': 'text/plain' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ mock: 'successful' }), { status: 200 }))
        })

        it(`should not retry and resolve the ${status} response`, async () => {
          const response = await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })

          expect(response.status).toBe(status)
          expect(fetchMock).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('and the request is aborted through the provided controller', () => {
    beforeEach(() => {
      fetchMock.mockImplementation(rejectOnAbort)
    })

    it('should throw an aborted error', async () => {
      const controller = new AbortController()
      const fetchPromise = sut.fetch('https://example.com', { abortController: controller })

      controller.abort()

      await expect(fetchPromise).rejects.toThrow('Request aborted (timed out)')
    })
  })

  describe('and the fetch rejects while a timeout is configured', () => {
    let controller: AbortController

    beforeEach(() => {
      controller = new AbortController()
      fetchMock.mockRejectedValueOnce(new Error('network error'))
    })

    it('should clear the timeout so the provided controller is not aborted after the failure', async () => {
      await expect(
        sut.fetch('https://example.com', { timeout: 50, abortController: controller })
      ).rejects.toThrow('network error')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(controller.signal.aborted).toBe(false)
    })
  })
})
