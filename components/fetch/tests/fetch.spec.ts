import { IFetchComponent } from '@dcl/core-commons'
import { createFetchComponent } from '../src/fetcher'

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
        .mockResolvedValue(new Response('test error', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    })

    it('should exhaust the retries and resolve the latest response instead of throwing', async () => {
      const response = await sut.fetch('https://example.com', { attempts: 3, retryDelay: 10 })

      expect(response.status).toBe(503)
      expect(await response.text()).toBe('test error')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the request exceeds the configured timeout', () => {
    let timer: NodeJS.Timeout | undefined

    beforeEach(() => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            timer = setTimeout(
              () => resolve(new Response('success', { status: 201, headers: { 'Content-Type': 'text/plain' } })),
              3500
            )
          })
      )
    })

    afterEach(() => {
      if (timer) clearTimeout(timer)
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
    let timer: NodeJS.Timeout | undefined

    beforeEach(() => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(new Response('success', { status: 201 })), 3000)
          })
      )
    })

    afterEach(() => {
      if (timer) clearTimeout(timer)
    })

    it('should throw an aborted error', async () => {
      const controller = new AbortController()
      const fetchPromise = sut.fetch('https://example.com', { abortController: controller })

      controller.abort()

      await expect(fetchPromise).rejects.toThrow('Request aborted (timed out)')
    })
  })
})
