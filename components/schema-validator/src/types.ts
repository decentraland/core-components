import { IHttpServerComponent } from '@well-known-components/interfaces'
import { ErrorObject, Schema } from 'ajv'

export type Validation = {
  valid: boolean
  errors: null | ErrorObject[]
}

export type ISchemaValidatorComponent<T extends Object> = {
  withSchemaValidatorMiddleware: (
    schema: Schema
  ) => IHttpServerComponent.IRequestHandler<IHttpServerComponent.PathAwareContext<T, string>>
}
