import { randomUUID } from 'crypto'
import Ajv, { Schema } from 'ajv'
import addFormats from 'ajv-formats'
import { IHttpServerComponent } from '@dcl/core-commons'
import { ISchemaValidatorComponent, Validation } from './types'

// RFC 6839 structured-suffix match: non-empty type and subtype separated by `/`,
// ending in `+json`. Prevents matching a bare `+json` or `application/+json`.
const JSON_STRUCTURED_SUFFIX_RE = /^[^/\s]+\/[^/\s]+\+json$/

// Duck-types an HTTP status off a thrown error (mirrors `@well-known-components`/http-errors
// conventions) without taking a dependency on the http layer, so a body read that fails with a
// known status — e.g. a `413` from an upstream body-size limiter — can be honored.
function httpErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
    if (typeof status === 'number') return status
    if (typeof statusCode === 'number') return statusCode
  }
  return undefined
}

export function createSchemaValidatorComponent<T extends object>(options?: {
  ensureJsonContentType?: boolean
}): ISchemaValidatorComponent<T> {
  const { ensureJsonContentType = true } = options ?? {}

  const ajv = new Ajv()
  addFormats(ajv)

  function addSchema(schema: Schema, key: string): void {
    if (ajv.getSchema(key)) {
      ajv.removeSchema(key)
    }
    ajv.addSchema(schema, key)
  }

  function validateSchema(schemaKey: string, data: unknown): Validation {
    const validate = ajv.getSchema<unknown>(schemaKey)

    if (!validate) {
      throw new Error(`No schema was found with the key ${schemaKey}`)
    }

    const valid = validate(data) as boolean

    if (valid) {
      return { valid: true, errors: null }
    }
    return { valid: false, errors: validate.errors ?? [] }
  }

  function isJsonContentType(contentType: string | null): boolean {
    if (!contentType) {
      return false
    }
    const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
    return mediaType === 'application/json' || JSON_STRUCTURED_SUFFIX_RE.test(mediaType)
  }

  function withSchemaValidatorMiddleware(
    schema: Schema
  ): IHttpServerComponent.IRequestHandler<IHttpServerComponent.PathAwareContext<T, string>> {
    const schemaId = randomUUID()
    addSchema(schema, schemaId)

    return async (context, next): Promise<IHttpServerComponent.IResponse> => {
      if (ensureJsonContentType && !isJsonContentType(context.request.headers.get('Content-Type'))) {
        return {
          status: 415,
          body: {
            ok: false,
            message: 'Content-Type must be application/json'
          }
        }
      }

      let data: unknown

      try {
        data = await context.request.clone().json()
      } catch (error) {
        // An upstream body-size limiter (e.g. `@dcl/http-server`'s `maxBodySize` or
        // `createBodySizeLimitMiddleware`) surfaces an oversized body as an error carrying a numeric
        // HTTP `status` (`413`) on the body read. Honor that status instead of masking it as a
        // generic `400` parse error; anything without a status is a real parse failure.
        const status = httpErrorStatus(error)
        return {
          status: status ?? 400,
          body: {
            ok: false,
            message: (error as { message?: string }).message ?? 'Invalid JSON body'
          }
        }
      }

      const validation = validateSchema(schemaId, data)

      if (!validation.valid) {
        return {
          status: 400,
          body: {
            ok: false,
            message: 'Invalid JSON body',
            data: validation.errors
          }
        }
      }

      return next()
    }
  }

  return {
    addSchema,
    validateSchema,
    withSchemaValidatorMiddleware
  }
}
