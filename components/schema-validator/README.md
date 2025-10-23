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

const { withSchemaValidatorMiddleware } = createSchemaValidatorComponent(schema)

router.post('/v1/test', withSchemaValidatorMiddleware(schema))
```
