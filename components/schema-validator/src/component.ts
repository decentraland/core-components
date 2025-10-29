import { randomUUID } from 'crypto'
import Ajv, { Schema } from 'ajv'
import addFormats from 'ajv-formats'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { ISchemaValidatorComponent, Validation } from './types'

export function createSchemaValidatorComponent<T extends Object>(options?: {
  checkContentType?: boolean
}): ISchemaValidatorComponent<T> {
  const { checkContentType = true } = options ?? {}

  const ajv = new Ajv({ removeAdditional: true })
  addFormats(ajv)

  function addSchema(schema: Schema, key: string): void {
    ajv.addSchema(schema, key)
  }

  function validateSchema(schemaKey: string, data: unknown): Validation {
    const validate = ajv.getSchema<unknown>(schemaKey)

    if (!validate) {
      throw new Error(`No schema was found with the key ${schemaKey}`)
    }

    const valid = validate(data) as boolean

    return {
      valid,
      errors: validate.errors ?? null
    }
  }

  function withSchemaValidatorMiddleware(
    schema: Schema
  ): IHttpServerComponent.IRequestHandler<IHttpServerComponent.PathAwareContext<T, string>> {
    const schemaId = randomUUID()
    addSchema(schema, schemaId)

    return async (context, next): Promise<IHttpServerComponent.IResponse> => {
      if (checkContentType && context.request.headers.get('Content-Type') !== 'application/json') {
        return {
          status: 400,
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
    withSchemaValidatorMiddleware
  }
}
