import {
  START_COMPONENT,
  STOP_COMPONENT,
  type IBaseComponent,
  type IStatusCheckCapableComponent
} from '@well-known-components/interfaces'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { _setUnderlyingServer } from './injectors'
import { getServer, success, getRequestFromNodeMessage, exceedsContentLength, assertValidMaxBodySize } from './logic'
import type { ServerComponents, IHttpServerOptions } from './types'
import { createServerHandler } from './server-handler'
import * as http from 'http'
import { createServerTerminator } from './terminator'
import { Socket } from 'net'
import { getWebSocketCallback } from './ws'
import destroy from 'destroy'
import { createCorsMiddleware, getActualResponseCorsHeaders } from './cors'

/**
 * @public
 */
export type FullHttpServerComponent<Context extends object> = IHttpServerComponent<Context> &
  IBaseComponent &
  IStatusCheckCapableComponent & {
    /**
     * WARNING! this is a very destructive function, it resets all the .use middlewares
     * you must reconfigure your handlers entirely after calling this function
     */
    resetMiddlewares(): void
  }

/**
 * Builds a throwaway web `Request` carrying only the incoming `Origin` header, so the CORS helpers
 * (which read `request.headers.get('origin')`) can run on the early body-size rejection path
 * without adapting the request body.
 */
function corsRequestFromNodeMessage(req: http.IncomingMessage): Request {
  const headers = new Headers()
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    headers.set('origin', origin)
  }
  return new Request('http://cors.invalid/', { headers })
}

/**
 * Creates a http-server component
 * @public
 */
export async function createServerComponent<Context extends object>(
  components: ServerComponents,
  options: Partial<IHttpServerOptions>
): Promise<FullHttpServerComponent<Context>> {
  const { config, logs, ws } = components
  const logger = logs.getLogger('http-server')

  // config
  const port = await config.requireNumber('HTTP_SERVER_PORT')
  const host = await config.requireString('HTTP_SERVER_HOST')
  const maxBodySize = options.maxBodySize

  // Catch misconfiguration early: a negative, fractional, NaN or zero limit would silently reject
  // every request body rather than do something useful. Omit the option for "no limit".
  assertValidMaxBodySize(maxBodySize)

  let handlerFn: http.RequestListener = handler

  const server = getServer(options, handlerFn)

  let listen: Promise<typeof server> | undefined

  const terminator = createServerTerminator(server, { logger }, {})

  async function start(): Promise<void> {
    if (listen) {
      logger.error('start() called more than once')
      await listen
      return
    }

    listen = new Promise((resolve, reject) => {
      const errorHandler = (err: Error) => {
        logger.error(err)
        reject(err)
      }

      server.once('listening', () => {
        logger.info(`Listening ${host}:${port}`)
        resolve(server)
        server!.off('error', errorHandler)
      })

      server.once('error', errorHandler).listen(port, host, () => {})
    })

    await listen
  }

  async function stop() {
    logger.info(`Closing server`)
    await terminator.terminate()
    logger.info(`Server closed`)
  }

  let configuredContext: Context = Object.create({})

  const serverHandler = createServerHandler<Context>()

  const ret: FullHttpServerComponent<Context> = {
    // IBaseComponent
    start,
    stop,
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    // IStatusCheckCapableComponent
    async startupProbe() {
      return true
    },
    async readynessProbe() {
      return server.listening
    },
    // IHttpServerComponent
    use: serverHandler.use,
    setContext(context) {
      configuredContext = context
    },

    // extra
    resetMiddlewares: serverHandler.resetMiddlewares
  }

  async function asyncHandle(req: http.IncomingMessage, res: http.ServerResponse) {
    // Reject oversized bodies up-front, before reading them, when the client declares its size.
    // Bodies that omit or under-declare `Content-Length` are still capped while streaming by the
    // limiter in `getRequestFromNodeMessage`.
    if (maxBodySize !== undefined && exceedsContentLength(req.headers['content-length'], maxBodySize)) {
      // This path responds before the middleware chain, so it never reaches the metrics middleware.
      // Log it so the rejection is at least observable (e.g. for log-based alerting).
      logger.warn('Rejected request: body exceeds maxBodySize', {
        method: req.method ?? '',
        contentLength: req.headers['content-length'] ?? '',
        maxBodySize
      })
      res.statusCode = 413
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      // Close the connection: the declared body is never read, so the socket can't be reused.
      // With `Connection: close` Node tears the socket down after the response instead of waiting
      // for the (never-arriving) body.
      res.setHeader('connection', 'close')
      // This path responds before the middleware chain runs, so the CORS middleware never sees it.
      // Add the actual-response CORS headers here so a cross-origin client can read the 413.
      if (options.cors) {
        getActualResponseCorsHeaders(options.cors, corsRequestFromNodeMessage(req)).forEach((value, key) => {
          res.setHeader(key, value)
        })
      }
      res.end('Payload Too Large')
      return
    }

    const request = getRequestFromNodeMessage(req, host, maxBodySize)
    const response = await serverHandler.processRequest(configuredContext, request)

    success(response, res)
  }

  async function handleUpgrade(req: http.IncomingMessage, socket: Socket, head: Buffer) {
    if (!ws) {
      throw new Error('No WebSocketServer present')
    }

    const request = getRequestFromNodeMessage(req, host)
    const response = await serverHandler.processRequest(configuredContext, request)

    const websocketConnect = getWebSocketCallback(response)

    if (websocketConnect) {
      ws.handleUpgrade(req, socket, head, async (wsSocket) => {
        try {
          await websocketConnect(wsSocket)
        } catch (err: any) {
          logger.error(err)
          destroy(socket)
        }
      })
    } else {
      if (response.status) {
        const statusCode = isNaN(response.status) ? 404 : response.status
        const statusText = http.STATUS_CODES[statusCode] || 'Not Found'
        socket.end(`HTTP/${req.httpVersion} ${statusCode} ${statusText}\r\n\r\n`)
      } else {
        socket.end()
      }
    }
  }

  if (ws) {
    server.on('upgrade', (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
      return handleUpgrade(req, socket, head).catch((err) => {
        logger.error(err)
        destroy(socket)
      })
    })
  }

  function handler(request: http.IncomingMessage, response: http.ServerResponse) {
    asyncHandle(request, response).catch((error) => {
      logger.error(error)

      if (error.code == 'ERR_INVALID_URL') {
        response.statusCode = 404
        response.end()
      } else {
        response.statusCode = 500
        response.end()
      }
    })
  }

  _setUnderlyingServer(ret, async () => {
    if (!server) throw new Error('The server is stopped')
    return (await listen) || server!
  })

  if (options.cors) {
    ret.use(createCorsMiddleware(options.cors))
  }

  return ret
}
