import { PassThrough } from 'stream'
import WebSocket from 'ws'
import { Router } from '../src'
import { describeE2E } from './test-e2e-harness'
import { TestComponents } from './test-helpers'

function abortDetails(reason: unknown): unknown {
  return typeof reason === 'object' && reason !== null && 'name' in reason && 'message' in reason
    ? { message: (reason as Error).message, name: (reason as Error).name }
    : reason
}

function rejectAfter(message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 1500).unref())
}

describeE2E('request disconnect signal', ({ components }: { components: TestComponents }) => {
  describe('when the client disconnects while a handler is running', () => {
    let clientController: AbortController
    let clientError: unknown
    let clientRequest: Promise<Response | unknown>
    let handlerStarted: Promise<void>
    let reason: unknown
    let resolveHandlerStarted: () => void
    let serverAbortReason!: Promise<unknown>

    beforeEach(async () => {
      clientController = new AbortController()
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      components.server.resetMiddlewares()
      components.server.use(async (context) => {
        resolveHandlerStarted()
        serverAbortReason = new Promise((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(context.request.signal.reason), { once: true })
        })
        await serverAbortReason
        throw context.request.signal.reason
      })

      clientRequest = components.fetch.fetch('/', { signal: clientController.signal }).catch((error) => error)
      await handlerStarted
      clientController.abort()
      ;[clientError, reason] = await Promise.all([clientRequest, serverAbortReason])
    })

    afterEach(() => {
      clientController.abort()
      jest.resetAllMocks()
    })

    it('should abort the handler request signal', () => {
      expect({
        clientRequestAborted:
          typeof clientError === 'object' && clientError !== null && 'name' in clientError
            ? (clientError as Error).name
            : clientError,
        serverReason: abortDetails(reason)
      }).toEqual({
        clientRequestAborted: 'AbortError',
        serverReason: { message: 'Client disconnected.', name: 'AbortError' }
      })
    })
  })

  describe('when the client disconnects while a response is streaming', () => {
    let clientController: AbortController
    let reason: unknown
    let response: Response
    let responseBody: PassThrough
    let serverAbortReason!: Promise<unknown>

    beforeEach(async () => {
      clientController = new AbortController()
      responseBody = new PassThrough()
      components.server.resetMiddlewares()
      components.server.use(async (context) => {
        serverAbortReason = new Promise((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(context.request.signal.reason), { once: true })
        })
        responseBody.write('stream started')
        return { body: responseBody }
      })

      response = await components.fetch.fetch('/', { signal: clientController.signal })
      clientController.abort()
      reason = await serverAbortReason
    })

    afterEach(() => {
      clientController.abort()
      responseBody.destroy()
      jest.resetAllMocks()
    })

    it('should keep the request signal connected until the response stream closes', () => {
      expect({ responseStatus: response.status, serverReason: abortDetails(reason) }).toEqual({
        responseStatus: 200,
        serverReason: { message: 'Client disconnected.', name: 'AbortError' }
      })
    })
  })

  describe('when the response completes normally', () => {
    let requestSignal: AbortSignal
    let response: Response

    beforeEach(async () => {
      requestSignal = new AbortController().signal
      components.server.resetMiddlewares()
      components.server.use(async (context) => {
        requestSignal = context.request.signal
        return { status: 204 }
      })

      response = await components.fetch.fetch('/')
      await response.arrayBuffer()
      await new Promise<void>((resolve) => setImmediate(resolve))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should leave the request signal un-aborted', () => {
      expect(requestSignal.aborted).toEqual(false)
    })
  })

  describe('when the client disconnects while WebSocket upgrade middleware is running', () => {
    let clientSocket: WebSocket
    let clientSocketError: Promise<never>
    let handlerStarted: Promise<void>
    let httpServerErrors: string[]
    let reason: unknown
    let resolveHandlerStarted: () => void
    let serverAbortReason!: Promise<unknown>
    let stderrWrite: jest.SpyInstance

    beforeEach(async () => {
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
      components.server.resetMiddlewares()
      const router = new Router()
      router.get('/ws', async (context) => {
        serverAbortReason = new Promise((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(context.request.signal.reason), { once: true })
        })
        resolveHandlerStarted()
        await serverAbortReason
        throw context.request.signal.reason
      })
      components.server.use(router.middleware())
      components.server.use(router.allowedMethods())

      clientSocket = components.ws.createWebSocket('/ws')
      clientSocketError = new Promise((_, reject) => clientSocket.once('error', reject))
      await Promise.race([handlerStarted, clientSocketError, rejectAfter('Upgrade middleware did not start')])
      clientSocket.terminate()
      reason = await Promise.race([serverAbortReason, rejectAfter('Upgrade request signal did not abort')])
      await new Promise<void>((resolve) => setImmediate(resolve))
      httpServerErrors = stderrWrite.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('[ERROR] (http-server)'))
    })

    afterEach(() => {
      clientSocket.terminate()
      stderrWrite.mockRestore()
      jest.resetAllMocks()
    })

    it('should abort the upgrade request signal', () => {
      expect(abortDetails(reason)).toEqual({ message: 'Client disconnected.', name: 'AbortError' })
    })

    it('should not log the expected disconnect as an application error', () => {
      expect(httpServerErrors).toEqual([])
    })
  })
})
