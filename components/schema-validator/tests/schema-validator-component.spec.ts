import { IHttpServerComponent } from '@dcl/core-commons'
import { createSchemaValidatorComponent } from '../src'

const testSchema = {
  type: 'object' as const,
  properties: {
    aTestProp: { type: 'string' as const }
  },
  required: ['aTestProp']
}

function createMockContext(
  options: {
    contentType?: string | null
    contentLength?: string | null
    body?: () => unknown
  } = {}
) {
  const { contentType = null, contentLength = null, body } = options

  const headerValues: Record<string, string | null> = {
    'content-type': contentType,
    'content-length': contentLength
  }

  const headers = {
    get: jest.fn((header: string) => {
      const key = header.toLowerCase()
      if (key in headerValues) {
        return headerValues[key]
      }
      throw new Error(`Unexpected header lookup: ${header}`)
    })
  } as unknown as Headers

  const request: { headers: Headers; clone?: jest.Mock } = { headers }

  if (body) {
    request.clone = jest.fn().mockReturnValue({ json: body })
  }

  return {
    params: {},
    request: request as unknown as IHttpServerComponent.IRequest,
    url: {} as URL
  }
}

let middleware: ReturnType<ReturnType<typeof createSchemaValidatorComponent>['withSchemaValidatorMiddleware']>

beforeEach(async () => {
  middleware = createSchemaValidatorComponent().withSchemaValidatorMiddleware(testSchema)
})

describe("when validating a request that doesn't have a JSON Content-Type", () => {
  it('should return an unsupported media type error signaling that it must contain a JSON body', async () => {
    await expect(middleware(createMockContext({ contentType: null }), jest.fn())).resolves.toEqual({
      status: 415,
      body: {
        ok: false,
        message: 'Content-Type must be application/json'
      }
    })
  })
})

describe('when validating a request whose Content-Type includes a charset parameter', () => {
  it('should accept application/json; charset=utf-8 and continue to the next middleware', async () => {
    const next = jest.fn()

    await middleware(
      createMockContext({
        contentType: 'application/json; charset=utf-8',
        body: () => ({ aTestProp: 'someValue' })
      }),
      next
    )

    expect(next).toHaveBeenCalled()
  })
})

describe('when validating a request whose Content-Type uses the +json structured suffix', () => {
  it('should accept application/vnd.api+json and continue to the next middleware', async () => {
    const next = jest.fn()

    await middleware(
      createMockContext({
        contentType: 'application/vnd.api+json',
        body: () => ({ aTestProp: 'someValue' })
      }),
      next
    )

    expect(next).toHaveBeenCalled()
  })
})

describe('when validating a request whose Content-Type starts with application/json but has no separator', () => {
  it('should reject application/jsonfoo as unsupported media type', async () => {
    await expect(
      middleware(createMockContext({ contentType: 'application/jsonfoo' }), jest.fn())
    ).resolves.toEqual({
      status: 415,
      body: {
        ok: false,
        message: 'Content-Type must be application/json'
      }
    })
  })
})

describe('when validating a request whose Content-Type has a bare +json suffix without type or subtype', () => {
  it('should reject /+json as unsupported media type', async () => {
    await expect(middleware(createMockContext({ contentType: '/+json' }), jest.fn())).resolves.toEqual({
      status: 415,
      body: {
        ok: false,
        message: 'Content-Type must be application/json'
      }
    })
  })
})

describe("when validating a request that has a body that can't be parsed", () => {
  it('should return a bad request error containing the parsing error', async () => {
    await expect(
      middleware(
        createMockContext({
          contentType: 'application/json',
          body: () => {
            throw new Error('JSON Parsing Error')
          }
        }),
        jest.fn()
      )
    ).resolves.toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'JSON Parsing Error'
      }
    })
  })
})

describe('when the body read fails with an error carrying an HTTP status (e.g. an upstream size limiter)', () => {
  describe('and the error exposes a status property', () => {
    let result: IHttpServerComponent.IResponse

    beforeEach(async () => {
      const context = createMockContext({
        contentType: 'application/json',
        body: () => {
          const error: any = new Error('Payload Too Large')
          error.status = 413
          throw error
        }
      })
      result = await middleware(context, jest.fn())
    })

    it('should surface that status with the error message instead of masking it as a 400', () => {
      expect(result).toEqual({ status: 413, body: { ok: false, message: 'Payload Too Large' } })
    })
  })

  describe('and the error exposes a statusCode property', () => {
    let result: IHttpServerComponent.IResponse

    beforeEach(async () => {
      const context = createMockContext({
        contentType: 'application/json',
        body: () => {
          const error: any = new Error('Payload Too Large')
          error.statusCode = 413
          throw error
        }
      })
      result = await middleware(context, jest.fn())
    })

    it('should surface that status with the error message instead of masking it as a 400', () => {
      expect(result).toEqual({ status: 413, body: { ok: false, message: 'Payload Too Large' } })
    })
  })
})

describe("when validating a request that has a valid schema that doesn't match the JSON body", () => {
  it('should return a bad request error signaling that the JSON body is invalid', async () => {
    await expect(
      middleware(
        createMockContext({
          contentType: 'application/json',
          body: () => ({ someProp: 'someValue' })
        }),
        jest.fn()
      )
    ).resolves.toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'Invalid JSON body',
        data: [
          {
            instancePath: '',
            keyword: 'required',
            message: "must have required property 'aTestProp'",
            params: { missingProperty: 'aTestProp' },
            schemaPath: '#/required'
          }
        ]
      }
    })
  })
})

describe('when validating a request that has a valid schema that matches the JSON body', () => {
  it('should call next to continue handling the next middleware', async () => {
    const next = jest.fn()

    await middleware(
      createMockContext({
        contentType: 'application/json',
        body: () => ({ aTestProp: 'someValue' })
      }),
      next
    )

    expect(next).toHaveBeenCalled()
  })
})

describe('when the option to check the Content-Type header is set to false', () => {
  let middlewareWithoutContentTypeCheck: ReturnType<
    ReturnType<typeof createSchemaValidatorComponent>['withSchemaValidatorMiddleware']
  >

  beforeEach(() => {
    middlewareWithoutContentTypeCheck = createSchemaValidatorComponent({
      ensureJsonContentType: false
    }).withSchemaValidatorMiddleware(testSchema)
  })

  describe('and the Content-Type header is set to a value other than application/json', () => {
    it('should skip the Content-Type header validation and proceed to validate the JSON body', async () => {
      const next = jest.fn()

      await middlewareWithoutContentTypeCheck(
        createMockContext({
          contentType: 'text/plain',
          body: () => ({ aTestProp: 'someValue' })
        }),
        next
      )

      expect(next).toHaveBeenCalled()
    })
  })

  describe('and the Content-Type header is not set', () => {
    it('should skip the Content-Type header validation and proceed to validate the JSON body', async () => {
      const next = jest.fn()

      await middlewareWithoutContentTypeCheck(
        createMockContext({
          contentType: null,
          body: () => ({ aTestProp: 'someValue' })
        }),
        next
      )

      expect(next).toHaveBeenCalled()
    })
  })
})

describe('when the maxBodySize option is set', () => {
  let limitedMiddleware: ReturnType<
    ReturnType<typeof createSchemaValidatorComponent>['withSchemaValidatorMiddleware']
  >

  beforeEach(() => {
    limitedMiddleware = createSchemaValidatorComponent({ maxBodySize: 1024 }).withSchemaValidatorMiddleware(
      testSchema
    )
  })

  describe('and the request declares a Content-Length over the limit', () => {
    let next: jest.Mock
    let body: jest.Mock
    let result: IHttpServerComponent.IResponse

    beforeEach(async () => {
      next = jest.fn()
      body = jest.fn()
      const context = createMockContext({ contentType: 'application/json', contentLength: '2048', body })
      result = await limitedMiddleware(context, next)
    })

    it('should respond with a payload too large error', () => {
      expect(result).toEqual({ status: 413, body: { ok: false, message: 'Request body is too large' } })
    })

    it('should not parse the body', () => {
      expect(body).not.toHaveBeenCalled()
    })

    it('should not continue to the next middleware', () => {
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('and the request declares a Content-Length within the limit', () => {
    let next: jest.Mock

    beforeEach(async () => {
      next = jest.fn()
      const context = createMockContext({
        contentType: 'application/json',
        contentLength: '32',
        body: () => ({ aTestProp: 'someValue' })
      })
      await limitedMiddleware(context, next)
    })

    it('should parse and validate the body and continue to the next middleware', () => {
      expect(next).toHaveBeenCalled()
    })
  })

  describe('and the request does not declare a Content-Length', () => {
    let next: jest.Mock

    beforeEach(async () => {
      next = jest.fn()
      const context = createMockContext({
        contentType: 'application/json',
        contentLength: null,
        body: () => ({ aTestProp: 'someValue' })
      })
      await limitedMiddleware(context, next)
    })

    it('should parse the body and continue, leaving streaming enforcement to the transport layer', () => {
      expect(next).toHaveBeenCalled()
    })
  })
})

describe('when creating the component with an invalid maxBodySize', () => {
  let maxBodySize: number
  let error: Error | undefined

  beforeEach(() => {
    error = undefined
  })

  describe('and the value is zero', () => {
    beforeEach(() => {
      maxBodySize = 0
      try {
        createSchemaValidatorComponent({ maxBodySize })
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is negative', () => {
    beforeEach(() => {
      maxBodySize = -1
      try {
        createSchemaValidatorComponent({ maxBodySize })
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is fractional', () => {
    beforeEach(() => {
      maxBodySize = 1.5
      try {
        createSchemaValidatorComponent({ maxBodySize })
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })
})

describe('when using addSchema and validateSchema directly', () => {
  let validator: ReturnType<typeof createSchemaValidatorComponent>

  beforeEach(() => {
    validator = createSchemaValidatorComponent()
    validator.addSchema(testSchema, 'test-schema')
  })

  describe('and the data matches the registered schema', () => {
    it('should return a valid result with no errors', () => {
      expect(validator.validateSchema('test-schema', { aTestProp: 'ok' })).toEqual({
        valid: true,
        errors: null
      })
    })
  })

  describe("and the data doesn't match the registered schema", () => {
    it('should return an invalid result containing the ajv errors', () => {
      const result = validator.validateSchema('test-schema', { somethingElse: 'x' })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]).toMatchObject({ keyword: 'required' })
      }
    })
  })

  describe('and the referenced schema key is not registered', () => {
    it('should throw an error signaling the missing schema', () => {
      expect(() => validator.validateSchema('unknown-schema', {})).toThrow(
        'No schema was found with the key unknown-schema'
      )
    })
  })

  describe('and the same key is registered twice with different schemas', () => {
    it('should replace the first schema with the second one', () => {
      validator.addSchema(
        {
          type: 'object' as const,
          properties: {
            differentProp: { type: 'number' as const }
          },
          required: ['differentProp']
        },
        'test-schema'
      )

      const payloadForOriginalSchema = validator.validateSchema('test-schema', { aTestProp: 'ok' })
      expect(payloadForOriginalSchema.valid).toBe(false)

      const payloadForReplacementSchema = validator.validateSchema('test-schema', { differentProp: 42 })
      expect(payloadForReplacementSchema.valid).toBe(true)
    })
  })
})
