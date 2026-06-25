# Schema Validator Component (`@dcl/schema-validator-component`)

A component that exposes a middleware to be used to validate JSON schemas in HTTP bodies.

## Features

- Validation of AJV schemas.

## Usage

```typescript
import { createSchemaValidatorComponent } from '@dcl/schema-validator-component'

const schema = {
  type: 'object',
  properties: {
    aTestProp: {
      type: 'string'
    }
  },
  required: ['aTestProp']
}

const { withSchemaValidatorMiddleware } = createSchemaValidatorComponent()

router.post('/v1/test', withSchemaValidatorMiddleware(schema))
```

The component also exposes `addSchema` and `validateSchema` for validating payloads outside the middleware:

```typescript
const validator = createSchemaValidatorComponent()

validator.addSchema(schema, 'my-schema')
const { valid, errors } = validator.validateSchema('my-schema', payload)
```

## Options

| Option                  | Type      | Default | Description                                                                                  |
| ----------------------- | --------- | ------- | -------------------------------------------------------------------------------------------- |
| `ensureJsonContentType` | `boolean` | `true`  | When `true`, the middleware rejects requests whose `Content-Type` is not `application/json`. |

## Notes

- Each call to `withSchemaValidatorMiddleware` registers the schema under a random key in the shared Ajv instance. Register middlewares once at startup rather than per request, otherwise registered schemas will accumulate in memory.
- A request whose `Content-Type` is not `application/json` is rejected with HTTP `415 Unsupported Media Type` (values like `application/json; charset=utf-8` are accepted).
- The middleware reads the entire request body into memory via `request.clone().json()`. To bound body size, put a body-size limit in front of it — the `@dcl/http-server` `maxBodySize` option or its `createBodySizeLimitMiddleware`, which cap the body at the transport layer while streaming.
- When the body read fails with an error that already carries an HTTP `status`/`statusCode` (for example a `413` raised by an upstream `@dcl/http-server` body-size limiter on a chunked body), the middleware surfaces that status rather than masking it as a generic `400`. Errors without a status (genuine JSON parse failures) still return `400`.
- `addSchema` replaces any schema already registered under the given key, so repeated calls (e.g. from a hot-reload path) are safe.
