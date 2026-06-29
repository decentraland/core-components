import { IHttpServerComponent } from '@dcl/core-commons'

const wsSymbol = Symbol('WebSocketResponse')

/**
 * Callback invoked with the upgraded WebSocket. The socket type is generic (defaulting to
 * `any`) so the published types don't depend on `@types/ws` — which would otherwise force
 * every consumer to install it or enable `skipLibCheck`. Consumers that use this (unstable)
 * API can parameterize it with their own socket type, e.g.
 * `WebSocketCallback<import('ws').WebSocket>`.
 */
export type WebSocketCallback<W = any> = (ws: W) => Promise<void> | void

/**
 * @alpha
 * @deprecated Not stable
 */
export function upgradeWebSocketResponse(cb: WebSocketCallback): IHttpServerComponent.IResponse {
  return withWebSocketCallback(
    {
      status: 101
    },
    cb
  )
}

/**
 * @internal
 * @deprecated Not stable
 */
export function withWebSocketCallback<T extends object>(obj: T, cb: WebSocketCallback | null): T {
  ;(obj as any)[wsSymbol] = cb
  return obj
}

/**
 * @internal
 * @deprecated Not stable
 */
export function getWebSocketCallback<T extends object>(obj: T): WebSocketCallback | null {
  return (obj as any)[wsSymbol] || null
}
