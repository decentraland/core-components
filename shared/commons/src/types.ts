// Shared types for core components
import type * as stream from 'stream'
import {
  IBaseComponent,
  IMiddlewareAdapterHandler,
  IHttpServerComponent as WkcHttpServerComponent
} from '@well-known-components/interfaces'

export interface ASharedType {
  a: string
}

// HTTP server component types
//
// This mirrors `@well-known-components/interfaces`' `IHttpServerComponent` but binds the
// request/response types to the **native Node `fetch` API** (`Request`/`Response`/`ResponseInit`
// provided by `@types/node`) instead of `node-fetch`. Consumers (e.g. `@dcl/http-server`) can
// therefore implement the component without depending on `node-fetch`. `ParseUrlParams` and
// `IMiddlewareAdapterHandler` are pure type-level helpers re-used from the interfaces package
// (they carry no `node-fetch` coupling).

/**
 * @public
 */
export namespace IHttpServerComponent {
  export type JsonBody = Record<string, any>
  export type ResponseBody = JsonBody | stream.Readable | Uint8Array | Buffer | string
  export type QueryParams = Record<string, any>
  export type UrlParams = Record<string, string | string[]>

  /** The incoming request. This is the global (undici) `Request` shipped with Node, not `node-fetch`. */
  export type IRequest = Request

  /** A handler response. `ResponseInit` is the global (undici) type shipped with Node. */
  export type IResponse = ResponseInit & {
    body?: ResponseBody
  }

  export type DefaultContext<Context = {}> = Context & {
    request: IRequest
    url: URL
    /**
     * Address of the peer that opened the connection, as reported by the transport, normalized so
     * an IPv4 client is always `127.0.0.1` rather than sometimes `::ffff:127.0.0.1`.
     *
     * This is the *socket* address, not a client address derived from `X-Forwarded-For` or any
     * other header: behind a proxy or load balancer it is the proxy's address and is identical for
     * every client. Consumers that need the originating client (rate limiters, audit logs) must
     * read a trusted forwarding header first and fall back to this only when the server is
     * directly exposed.
     *
     * `undefined` when the transport cannot report one — a request built directly rather than
     * received over a socket, or a socket already destroyed.
     */
    remoteAddress?: string
  }

  export type PathAwareContext<Context = {}, Path extends string = string> = Context & {
    params: string extends Path ? any : IHttpServerComponent.ParseUrlParams<Path>
  }

  export type IRequestHandler<Context = {}> = IMiddlewareAdapterHandler<DefaultContext<Context>, IResponse>

  export type ParseUrlParams<State extends string, Memo extends Record<string, any> = {}> =
    WkcHttpServerComponent.ParseUrlParams<State, Memo>

  /**
   * HTTP request methods.
   * @public
   */
  export type HTTPMethod =
    | 'CONNECT'
    | 'DELETE'
    | 'GET'
    | 'HEAD'
    | 'OPTIONS'
    | 'PATCH'
    | 'POST'
    | 'PUT'
    | 'TRACE'

  export interface PathAwareHandler<Context> {
    <Path extends string>(
      path: Path,
      handler: IHttpServerComponent.IRequestHandler<PathAwareContext<Context, Path>>
    ): void
  }

  export type MethodHandlers<Context> = {
    [key in Lowercase<HTTPMethod>]: PathAwareHandler<Context>
  }
}

/**
 * @public
 */
export interface IHttpServerComponent<Context extends object> {
  /**
   * Register a route handler.
   */
  use: (handler: IHttpServerComponent.IRequestHandler<Context>) => void
  /**
   * Sets a context to be passed on to the handlers. The original context should
   * remain untouched after handler execution.
   */
  setContext(ctx: Context): void
}

// Fetch component types

/**
 * Options for an outbound fetch request.
 *
 * Extends the native Node `fetch` `RequestInit` with the retry and timeout
 * controls understood by the fetch component. The component targets the
 * default Node fetch API, so `RequestInit`, `Request` and `Response` are the
 * global (undici) types shipped with Node, not `node-fetch`.
 */
export type RequestOptions = RequestInit & {
  /** Controller used to abort the request (e.g. on timeout). */
  abortController?: AbortController
  /** Milliseconds to wait before aborting the request. */
  timeout?: number
  /** Number of attempts for idempotent requests before giving up. */
  attempts?: number
  /** Milliseconds to wait between retry attempts. */
  retryDelay?: number
}

/**
 * A fetch component backed by the default Node `fetch` API.
 *
 * `Request`, `Response` and `RequestInit` are the global types provided by Node
 * (via `@types/node`), so consumers must run on Node 18+ where `fetch` is part
 * of the runtime.
 */
export type IFetchComponent = {
  fetch(url: string | URL | Request, init?: RequestOptions): Promise<Response>
}

/**
 * Options for {@link ICacheStorageComponent.increment}.
 * @public
 */
export type IncrementOptions = {
  /**
   * How much to add to the counter. Must be a safe integer; may be negative to decrement.
   * @defaultValue 1
   */
  amount?: number
  /**
   * Time-to-live in **seconds**, applied **only when the counter is created** (or when an existing
   * counter has no expiry yet). Incrementing an already-expiring counter never extends its expiry,
   * so a fixed window stays anchored to its first hit instead of sliding forever. Must be greater
   * than zero when provided. Omit it to leave expiry management to the caller; in-memory
   * implementations may still apply their configured default TTL on creation.
   */
  ttlInSeconds?: number
}

/**
 * The outcome of an atomic {@link ICacheStorageComponent.increment}.
 * @public
 */
export type IncrementResult = {
  /** The counter value **after** the increment was applied. */
  value: number
  /**
   * Whole milliseconds remaining before the counter expires, or `undefined` when it has no expiry at
   * all. Read in the same round trip as the increment, so it costs nothing extra.
   *
   * It reflects the storage engine's own expiry clock, except on the path where the counter had no
   * expiry and one was just installed — there it echoes back the requested `ttlInSeconds`.
   */
  ttlRemainingInMilliseconds?: number
}

export interface ICacheStorageComponent extends IBaseComponent {
  /**
   * Retrieves a value from cache by key.
   * @param key - The key to look up.
   * @returns Promise resolving to the cached value or null if not found.
   *
   * @remarks
   * Key case sensitivity differs by implementation: the Redis backend lowercases keys in its string
   * and counter operations (though not in its hash operations, nor in the `keys` pattern), while the
   * in-memory backend never does. Normalize keys yourself when case-stability matters.
   */
  get<T>(key: string): Promise<T | null>
  /**
   * Stores a value in cache by key.
   * @param key - The key to store the value under.
   * @param value - The value to store.
   * @param ttl - Optional time-to-live in seconds.
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  /**
   * Removes a value from cache.
   * @param key - The key to remove.
   */
  remove(key: string): Promise<void>
  /**
   * Checks whether a key is present in the cache. Useful when callers only
   * need to know about presence (e.g. set-based existence checks like a
   * "have we seen this hash before?" cache) and would rather not transfer
   * the value over the wire.
   * @param key - The key to look up.
   * @returns Promise resolving to `true` if the key exists, `false` otherwise.
   */
  exists(key: string): Promise<boolean>
  /**
   * Retrieves all keys from cache.
   * @returns Promise resolving to an array of all keys.
   */
  keys(pattern?: string): Promise<string[]>
  /**
   * Atomically adds `amount` to the integer counter stored at `key`, creating it at `0` first if it
   * does not exist, and returns the resulting value together with the counter's remaining lifetime.
   *
   * The whole read-modify-write happens as a single indivisible operation in the storage engine, so
   * concurrent callers — across processes, and across service instances when backed by Redis — can
   * never lose an update. This is the primitive to use for fixed-window rate limiting, quota
   * accounting and any other "count events without a lock" workload; reaching for
   * {@link ICacheStorageComponent.get} + {@link ICacheStorageComponent.set}, or for
   * {@link ICacheStorageComponent.acquireLock}, is both racy and dramatically slower.
   *
   * `options.ttlInSeconds` is applied **only on creation** (and to a pre-existing counter that has
   * no expiry). Repeated increments therefore leave the expiry where it is, which is what makes a
   * fixed window terminate.
   *
   * @param key - The key holding the counter.
   * @param options - Increment amount and creation-time TTL. See {@link IncrementOptions}.
   * @returns The post-increment value and the counter's remaining TTL in milliseconds
   *          (`undefined` when it has no expiry). See {@link IncrementResult}.
   * @throws {TypeError} When `amount` is not a safe integer or `ttlInSeconds` is not greater than zero.
   * @throws {RangeError} When the resulting value passes `Number.MAX_SAFE_INTEGER`, since it could
   *         then only be reported rounded. Reset the counter or count in smaller units.
   * @throws When the value stored at `key` is not an integer counter. The in-memory backend raises a
   *         `TypeError`; the Redis backend surfaces the server's own error reply, which is **not** a
   *         `TypeError` — do not branch on the error type for this case.
   *
   * @example Fixed-window rate limit with a correct `Retry-After`
   * ```ts
   * const { value, ttlRemainingInMilliseconds } = await cache.increment(`rl:${clientKey}`, {
   *   ttlInSeconds: 60
   * })
   * if (value > 100) {
   *   // `Math.max(1, …)`: the remaining TTL is legitimately `0` in a counter's final millisecond,
   *   // which `??` does not catch, and `Retry-After: 0` invites an immediate retry storm.
   *   const retryAfter = Math.max(1, Math.ceil((ttlRemainingInMilliseconds ?? 60_000) / 1000))
   *   return { status: 429, headers: { 'Retry-After': String(retryAfter) } }
   * }
   * ```
   */
  increment(key: string, options?: IncrementOptions): Promise<IncrementResult>
  /**
   * Stores a value in a hash by key and field.
   * @param key - The key where the hash is stored.
   * @param field - The field to store the value under.
   * @param value - The value to store.
   * @param ttlInSecondsForHash - Optional time-to-live in seconds for the hash.
   */
  setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void>
  /**
   * Retrieves a value from a hash by key and field.
   * @param key - The key where the hash is stored.
   * @param field - The field to look up.
   * @returns Promise resolving to the cached value or null if not found.
   */
  getFromHash<T>(key: string, field: string): Promise<T | null>
  /**
   * Removes a value from a hash by key and field. If the hash is empty, it will be deleted.
   * @param key - The key where the hash is stored.
   * @param field - The field to remove.
   */
  removeFromHash(key: string, field: string): Promise<void>
  /**
   * Retrieves all fields from a hash by key.
   * @param key - The key to look up.
   * @returns Promise resolving to an object with all fields and their values.
   */
  getAllHashFields<T>(key: string): Promise<Record<string, T>>

  /**
   * Acquires a lock for a key. Throws LockNotAcquiredError if lock cannot be acquired.
   * @param key - The key to acquire the lock for.
   * @param options - Lock options including TTL, retry delay, and number of retries.
   * @param options.ttlInMilliseconds - Time-to-live for the lock in milliseconds. Default: 10000 (10 seconds).
   * @param options.retryDelayInMilliseconds - Delay between retries in milliseconds. Default: 200.
   * @param options.retries - Number of retry attempts. Default: 10.
   * @throws {LockNotAcquiredError} When the lock cannot be acquired after all retries.
   */
  acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void>
  /**
   * Releases a lock for a key. Throws LockNotReleasedError if lock cannot be released.
   * @param key - The key to release the lock for.
   * @throws {LockNotReleasedError} When the lock cannot be released (not owned by this instance).
   */
  releaseLock(key: string): Promise<void>
  /**
   * Attempts to acquire a lock for a key without throwing errors.
   * @param key - The key to acquire the lock for.
   * @param options - Lock options including TTL, retry delay, and number of retries.
   * @param options.ttlInMilliseconds - Time-to-live for the lock in milliseconds. Default: 10000 (10 seconds).
   * @param options.retryDelayInMilliseconds - Delay between retries in milliseconds. Default: 200.
   * @param options.retries - Number of retry attempts. Default: 10.
   * @returns Promise resolving to true if lock was acquired, false otherwise.
   */
  tryAcquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<boolean>
  /**
   * Attempts to release a lock for a key without throwing errors.
   * @param key - The key to release the lock for.
   * @returns Promise resolving to true if the lock was released, false otherwise.
   */
  tryReleaseLock(key: string): Promise<boolean>
}

// Queue component types

/**
 * Options for receiving messages from a queue.
 */
export type ReceiveMessagesOptions = {
  visibilityTimeout?: number
  waitTimeSeconds?: number
  abortSignal?: AbortSignal
}

/**
 * Options for sending a message to a queue.
 */
export type SendMessageOptions = {
  /**
   * Controls the shape of the SQS `MessageBody`.
   *
   * When `false` (the default) the body is written as
   * `JSON.stringify({ Message: JSON.stringify(message) })` — the
   * SNS-envelope shape that existing production consumers have been
   * reading for a long time. Keeping this as the default preserves
   * compatibility with those consumers.
   *
   * When `true` the body is written as a single `JSON.stringify(message)`,
   * which is the shape SNS delivers when Raw Message Delivery is
   * enabled on the subscription, and the shape
   * `@dcl/queue-consumer-component` decodes with one `JSON.parse(Body)`.
   * Set this to `true` when the downstream consumer expects the raw
   * payload.
   *
   * @default false
   */
  isRawMessage?: boolean

  /**
   * Seconds to defer delivery of the message. In SQS this maps to
   * `SendMessageCommand.DelaySeconds`; AWS caps it at 900 (15 minutes)
   * per request. When omitted (or `0`), the message is immediately
   * available for receive. For a queue-level default, configure
   * `DelaySeconds` on the queue itself.
   *
   * Callers that need a long-running schedule should use a scheduling
   * component rather than stacking `delaySeconds` on each send.
   */
  delaySeconds?: number
}

/**
 * The status of a queue.
 */
export type QueueStatus = {
  ApproximateNumberOfMessages: string
  ApproximateNumberOfMessagesNotVisible: string
  ApproximateNumberOfMessagesDelayed: string
}

/**
 * The interface for a queue component.
 */
export interface IQueueComponent {
  /**
   * Sends a message to the queue.
   * @param message - The message to send.
   * @param options - Optional send options (e.g. `isRawMessage`).
   */
  sendMessage(message: unknown, options?: SendMessageOptions): Promise<void>
  /**
   * Receives messages from the queue.
   * @param amount - The number of messages to receive.
   * @param options - The options for receiving messages.
   * @returns A promise that resolves to an array of messages.
   */
  receiveMessages(amount?: number, options?: ReceiveMessagesOptions): Promise<any[]>
  /**
   * Deletes a message from the queue.
   * @param receiptHandle - The receipt handle of the message to delete.
   */
  deleteMessage(receiptHandle: string): Promise<void>
  /**
   * Deletes multiple messages from the queue.
   * @param receiptHandles - The receipt handles of the messages to delete.
   */
  deleteMessages(receiptHandles: string[]): Promise<void>
  /**
   * Changes the visibility timeout of a message.
   * @param receiptHandle - The receipt handle of the message to change the visibility timeout of.
   * @param visibilityTimeout - The new visibility timeout in seconds.
   */
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>
  /**
   * Changes the visibility timeout of multiple messages.
   * @param receiptHandles - The receipt handles of the messages to change the visibility timeout of.
   * @param visibilityTimeout - The new visibility timeout in seconds.
   */
  changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void>
  /**
   * Gets the status of the queue.
   * @returns A promise that resolves to the status of the queue.
   */
  getStatus(): Promise<QueueStatus>
}
