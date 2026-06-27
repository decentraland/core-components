import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type * as http from 'http'
import type * as https from 'https'
import type { Socket } from 'net'
import { CorsOptions } from './cors'

/**
 * @alpha
 * @deprecated Not the final release
 */
export interface WebSocketServer {
  handleUpgrade(
    request: http.IncomingMessage,
    socket: Socket,
    upgradeHead: Buffer,
    callback: (client: any, request: http.IncomingMessage) => void
  ): void
}

/**
 * @public
 */
export type ServerComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  ws?: WebSocketServer
}

/**
 * @public
 */
export type IHttpServerOptions = {
  cors?: CorsOptions
  /**
   * Milliseconds an idle keep-alive socket is kept open waiting for the next request before the
   * server closes it. Maps to Node's `server.keepAliveTimeout`.
   * @defaultValue 70000
   */
  keepAliveTimeout?: number
  /**
   * Milliseconds the server waits to receive the complete request headers before aborting the
   * connection. Maps to Node's `server.headersTimeout` and should stay above `keepAliveTimeout`.
   * @defaultValue 75000
   */
  headersTimeout?: number
  /**
   * Maximum allowed size, in bytes, of an incoming request body. Requests whose `Content-Length`
   * exceeds it are rejected with `413 Payload Too Large` before the body is read; bodies that
   * exceed it while streaming (e.g. chunked transfer-encoding or an under-declared `Content-Length`)
   * have their stream torn down with the same `413`. The limit is inclusive — a body of exactly
   * `maxBodySize` bytes is allowed, only larger ones are rejected. Must be a positive integer when
   * provided; unset means no limit is enforced.
   */
  maxBodySize?: number
  /**
   * Milliseconds the server waits to receive the entire request (headers and body) from the client
   * before aborting it. Maps to Node's `server.requestTimeout`. `0` disables the timeout.
   */
  requestTimeout?: number
  /**
   * Maximum number of request headers allowed. Requests with more headers are rejected. Maps to
   * Node's `server.maxHeadersCount`. `0` means unlimited.
   */
  maxHeadersCount?: number
  /**
   * Maximum number of requests a single keep-alive socket may serve before the server closes it.
   * Maps to Node's `server.maxRequestsPerSocket`. Unset (or `0`) means unlimited.
   */
  maxRequestsPerSocket?: number
} & ({ https: https.ServerOptions } | { http: http.ServerOptions })
