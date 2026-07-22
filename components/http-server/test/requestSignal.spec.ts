import { createConfigComponent } from '@well-known-components/env-config-provider'
import type { Server } from 'http'
import { PassThrough, Readable } from 'stream'
import WebSocket from 'ws'
import { createServerComponent, getUnderlyingServer, Router } from '../src'
import { FullHttpServerComponent } from '../src/server'
import { upgradeWebSocketResponse } from '../src/ws'
import { describeE2E } from './test-e2e-harness'
import { TestComponents } from './test-helpers'

function abortDetails(reason: unknown): unknown {
  return typeof reason === 'object' && reason !== null && 'name' in reason && 'message' in reason
    ? { message: (reason as Error).message, name: (reason as Error).name }
    : reason
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1500)
        timer.unref()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type RunningUpgradeServer = {
  server: FullHttpServerComponent<{}>
  url: string
}

async function startUpgradeServer(loggerError: jest.Mock, handleUpgrade: jest.Mock): Promise<RunningUpgradeServer> {
  const logs = {
    getLogger: () => ({
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: loggerError
    })
  } as any
  const config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })
  const server = await createServerComponent<{}>({ logs, config, ws: { handleUpgrade } }, {})
  await (server.start as () => Promise<void>)()
  const underlying = await getUnderlyingServer<Server>(server)
  const address = underlying.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { server, url: `ws://127.0.0.1:${port}` }
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
      await withTimeout(handlerStarted, 'Handler did not start')
      clientController.abort()
      ;[clientError, reason] = await withTimeout(
        Promise.all([clientRequest, serverAbortReason]),
        'Handler request signal did not abort'
      )
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

      response = await withTimeout(
        components.fetch.fetch('/', { signal: clientController.signal }),
        'Streaming response did not start'
      )
      clientController.abort()
      reason = await withTimeout(serverAbortReason, 'Streaming request signal did not abort')
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

  describe('when a disconnected HTTP handler returns a streamed response after cleanup', () => {
    let clientController: AbortController
    let clientRequest: Promise<unknown>
    let handlerStarted: Promise<void>
    let responseBody: Readable
    let responseBodyClosed: Promise<void>
    let responseBodyPipe: jest.SpyInstance
    let resolveHandlerStarted: () => void
    let streamError: jest.Mock

    beforeEach(async () => {
      clientController = new AbortController()
      streamError = jest.fn()
      responseBody = new Readable({
        read() {},
        destroy(_error, callback) {
          callback(new Error('cleanup failed'))
        }
      })
      responseBodyClosed = new Promise<void>((resolve) => responseBody.once('close', resolve))
      responseBody.on('error', streamError)
      responseBodyPipe = jest.spyOn(responseBody, 'pipe')
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      components.server.resetMiddlewares()
      components.server.use(async (context) => {
        resolveHandlerStarted()
        await new Promise<void>((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return { body: responseBody }
      })

      clientRequest = components.fetch.fetch('/', { signal: clientController.signal }).catch((error) => error)
      await withTimeout(handlerStarted, 'Handler did not start')
      clientController.abort()
      await withTimeout(clientRequest, 'Disconnected client request did not settle')
      await withTimeout(responseBodyClosed, 'Discarded response stream did not close')
    })

    afterEach(() => {
      clientController.abort()
      responseBody.destroy()
      jest.resetAllMocks()
    })

    it('should discard the response stream without starting it', () => {
      expect({
        destroyed: responseBody.destroyed,
        errorCalls: streamError.mock.calls.length,
        pipeCalls: responseBodyPipe.mock.calls.length
      }).toEqual({
        destroyed: true,
        errorCalls: 0,
        pipeCalls: 0
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
})

describe('when the client disconnects while WebSocket upgrade middleware is running', () => {
  describe('and middleware throws the request signal reason', () => {
    let clientSocket: WebSocket
    let clientSocketError: Promise<never>
    let handlerStarted: Promise<void>
    let loggerError: jest.Mock
    let reason: unknown
    let resolveHandlerStarted: () => void
    let running: RunningUpgradeServer
    let serverAbortReason!: Promise<unknown>
    let webSocketUpgrade: jest.Mock

    beforeEach(async () => {
      loggerError = jest.fn()
      webSocketUpgrade = jest.fn()
      running = await startUpgradeServer(loggerError, webSocketUpgrade)
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      running.server.resetMiddlewares()
      const router = new Router()
      router.get('/ws', async (context) => {
        serverAbortReason = new Promise((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(context.request.signal.reason), { once: true })
        })
        resolveHandlerStarted()
        await serverAbortReason
        throw context.request.signal.reason
      })
      running.server.use(router.middleware())
      running.server.use(router.allowedMethods())

      clientSocket = new WebSocket(`${running.url}/ws`)
      clientSocketError = new Promise((_, reject) => clientSocket.once('error', reject))
      await withTimeout(Promise.race([handlerStarted, clientSocketError]), 'Upgrade middleware did not start')
      clientSocket.terminate()
      reason = await withTimeout(serverAbortReason, 'Upgrade request signal did not abort')
      await new Promise<void>((resolve) => setImmediate(resolve))
    })

    afterEach(async () => {
      clientSocket.terminate()
      await (running.server.stop as () => Promise<void>)()
      jest.resetAllMocks()
    })

    it('should abort the upgrade request signal', () => {
      expect(abortDetails(reason)).toEqual({ message: 'Client disconnected.', name: 'AbortError' })
    })

    it('should not log the expected disconnect as an application error', () => {
      expect(loggerError).not.toHaveBeenCalled()
    })
  })

  describe('and middleware returns an upgrade response after cleanup', () => {
    let clientSocket: WebSocket
    let clientSocketError: Promise<never>
    let handlerStarted: Promise<void>
    let loggerError: jest.Mock
    let middlewareFinished: Promise<void>
    let resolveHandlerStarted: () => void
    let resolveMiddlewareFinished: () => void
    let running: RunningUpgradeServer
    let webSocketConnect: jest.Mock
    let webSocketUpgrade: jest.Mock

    beforeEach(async () => {
      loggerError = jest.fn()
      webSocketConnect = jest.fn()
      webSocketUpgrade = jest.fn()
      running = await startUpgradeServer(loggerError, webSocketUpgrade)
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      middlewareFinished = new Promise<void>((resolve) => {
        resolveMiddlewareFinished = resolve
      })
      running.server.resetMiddlewares()
      const router = new Router()
      router.get('/ws', async (context) => {
        resolveHandlerStarted()
        await new Promise<void>((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        resolveMiddlewareFinished()
        return upgradeWebSocketResponse(webSocketConnect)
      })
      running.server.use(router.middleware())
      running.server.use(router.allowedMethods())

      clientSocket = new WebSocket(`${running.url}/ws`)
      clientSocketError = new Promise((_, reject) => clientSocket.once('error', reject))
      await withTimeout(Promise.race([handlerStarted, clientSocketError]), 'Upgrade middleware did not start')
      clientSocket.terminate()
      await withTimeout(middlewareFinished, 'Upgrade middleware did not finish cleanup')
      await new Promise<void>((resolve) => setImmediate(resolve))
    })

    afterEach(async () => {
      clientSocket.terminate()
      await (running.server.stop as () => Promise<void>)()
      jest.resetAllMocks()
    })

    it('should not pass the abandoned connection to the WebSocket server', () => {
      expect({ connectCalls: webSocketConnect.mock.calls.length, upgradeCalls: webSocketUpgrade.mock.calls.length }).toEqual({
        connectCalls: 0,
        upgradeCalls: 0
      })
    })
  })
})
