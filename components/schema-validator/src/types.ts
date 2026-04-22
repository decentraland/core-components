import { IHttpServerComponent } from '@well-known-components/interfaces'
import { ErrorObject, Schema } from 'ajv'

export type Validation =
  | { valid: true; errors: null }
  | { valid: false; errors: ErrorObject[] }

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
