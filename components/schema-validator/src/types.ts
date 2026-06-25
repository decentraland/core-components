import { IHttpServerComponent } from '@dcl/core-commons'
import { ErrorObject, Schema } from 'ajv'

export type Validation =
  | { valid: true; errors: null }
  | { valid: false; errors: ErrorObject[] }

export type SchemaValidatorOptions = {
  /**
   * When `true` (the default), the middleware responds with `415` unless the request carries an
   * `application/json` (or `+json` structured-suffix) Content-Type.
   */
  ensureJsonContentType?: boolean
  /**
   * Maximum size, in bytes, of the request body the middleware will parse. When set, a request that
   * declares a larger `Content-Length` is rejected with `413 Payload Too Large` before its body is
   * read. Must be a positive integer; unset means no limit.
   *
   * ⚠️ **This is NOT a streaming guard.** It only inspects the declared `Content-Length`; the body
   * itself is still fully buffered by `request.clone().json()` when parsed. A request that omits or
   * under-declares its length (e.g. chunked transfer-encoding) bypasses this check entirely, so it
   * does not, on its own, bound memory usage. To actually cap the bytes read off the socket, set the
   * `@dcl/http-server` component's own `maxBodySize`, which enforces the limit at the transport layer
   * while streaming. Use this option as a convenience to reject oversized declared bodies before
   * parsing — not as a standalone memory-safety mechanism.
   */
  maxBodySize?: number
}

export type ISchemaValidatorComponent<T extends object> = {
  /**
   * Registers a schema under the given key so it can be referenced later by `validateSchema`.
   * If a schema is already registered under `key`, it is replaced.
   * Schemas registered here accumulate in memory; register them once (e.g. at startup) rather
   * than per request.
   */
  addSchema: (schema: Schema, key: string) => void
  /**
   * Validates `data` against a schema previously registered with `addSchema`. Throws if no
   * schema is registered under `schemaKey`.
   */
  validateSchema: (schemaKey: string, data: unknown) => Validation
  withSchemaValidatorMiddleware: (
    schema: Schema
  ) => IHttpServerComponent.IRequestHandler<IHttpServerComponent.PathAwareContext<T, string>>
}
