import { randomUUID } from 'crypto'
import Ajv, { Schema } from 'ajv'
import addFormats from 'ajv-formats'
import { IHttpServerComponent } from '@dcl/core-commons'
import { ISchemaValidatorComponent, SchemaValidatorOptions, Validation } from './types'

// RFC 6839 structured-suffix match: non-empty type and subtype separated by `/`,
// ending in `+json`. Prevents matching a bare `+json` or `application/+json`.
const JSON_STRUCTURED_SUFFIX_RE = /^[^/\s]+\/[^/\s]+\+json$/

export function createSchemaValidatorComponent<T extends object>(
  options?: SchemaValidatorOptions
): ISchemaValidatorComponent<T> {
  const { ensureJsonContentType = true, maxBodySize } = options ?? {}

  // Catch misconfiguration early: a non-positive or fractional limit would reject every body.
  if (maxBodySize !== undefined && (!Number.isInteger(maxBodySize) || maxBodySize < 1)) {
    throw new Error(`Invalid maxBodySize: expected a positive integer number of bytes, got ${maxBodySize}`)
  }

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

      if (maxBodySize !== undefined) {
        const contentLengthHeader = context.request.headers.get('Content-Length')
        const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN
        if (Number.isFinite(declaredSize) && declaredSize > maxBodySize) {
          return {
            status: 413,
            body: {
              ok: false,
              message: 'Request body is too large'
            }
          }
        }
      }

      let data: unknown

      try {
        data = await context.request.clone().json()
      } catch (error) {
        return {
          status: 400,
          body: {
            ok: false,
            message: (error as { message: string }).message
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
