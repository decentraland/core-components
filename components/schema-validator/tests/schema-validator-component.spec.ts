import { IHttpServerComponent } from '@well-known-components/interfaces'
import { createSchemaValidatorComponent } from '../src'

let middleware: ReturnType<ReturnType<typeof createSchemaValidatorComponent>['withSchemaValidatorMiddleware']>

beforeEach(async () => {
  middleware = createSchemaValidatorComponent().withSchemaValidatorMiddleware({
    type: 'object',
    properties: {
      aTestProp: {
        type: 'string'
      }
    },
    required: ['aTestProp']
  })
})

describe("when validating a request that doesn't have a JSON Content-Type", () => {
  it('should return an unsupported media type error signaling that it must contain a JSON body', () => {
    return expect(
      middleware(
        {
          params: {},
          request: {
            headers: {
              get: jest.fn().mockImplementationOnce((header) => {
                if (header === 'Content-Type') {
                  return null
                }
                throw new Error('Error')
              })
            } as unknown as Headers
          } as unknown as IHttpServerComponent.IRequest,
          url: {} as URL
        },
        jest.fn()
      )
    ).resolves.toEqual({
      status: 415,
      body: {
        ok: false,
        message: 'Content-Type must be application/json'
      }
    })
  })
})

describe('when validating a request whose Content-Type includes a charset parameter', () => {
  let next: jest.Mock

  beforeEach(() => {
    next = jest.fn()
  })

  it('should accept application/json; charset=utf-8 and continue to the next middleware', async () => {
    await middleware(
      {
        params: {},
        request: {
          clone: jest.fn().mockReturnValue({
            json: () => ({ aTestProp: 'someValue' })
          }),
          headers: {
            get: jest.fn().mockImplementationOnce((header) => {
              if (header === 'Content-Type') {
                return 'application/json; charset=utf-8'
              }
              throw new Error('Error')
            })
          } as unknown as Headers
        } as unknown as IHttpServerComponent.IRequest,
        url: {} as URL
      },
      next
    )

    expect(next).toHaveBeenCalled()
  })
})

describe('when validating a request whose Content-Type uses the +json structured suffix', () => {
  let next: jest.Mock

  beforeEach(() => {
    next = jest.fn()
  })

  it('should accept application/vnd.api+json and continue to the next middleware', async () => {
    await middleware(
      {
        params: {},
        request: {
          clone: jest.fn().mockReturnValue({
            json: () => ({ aTestProp: 'someValue' })
          }),
          headers: {
            get: jest.fn().mockImplementationOnce((header) => {
              if (header === 'Content-Type') {
                return 'application/vnd.api+json'
              }
              throw new Error('Error')
            })
          } as unknown as Headers
        } as unknown as IHttpServerComponent.IRequest,
        url: {} as URL
      },
      next
    )

    expect(next).toHaveBeenCalled()
  })
})

describe('when validating a request whose Content-Type starts with application/json but has no separator', () => {
  it('should reject application/jsonfoo as unsupported media type', () => {
    return expect(
      middleware(
        {
          params: {},
          request: {
            headers: {
              get: jest.fn().mockImplementationOnce((header) => {
                if (header === 'Content-Type') {
                  return 'application/jsonfoo'
                }
                throw new Error('Error')
              })
            } as unknown as Headers
          } as unknown as IHttpServerComponent.IRequest,
          url: {} as URL
        },
        jest.fn()
      )
    ).resolves.toEqual({
      status: 415,
      body: {
        ok: false,
        message: 'Content-Type must be application/json'
      }
    })
  })
})

describe("when validating a request that has a body that can't be parsed", () => {
  it('should return a bad request error containing the parsing error', () => {
    return expect(
      middleware(
        {
          params: {},
          request: {
            clone: jest.fn().mockReturnValue({
              json: () => {
                throw new Error('JSON Parsing Error')
              }
            }),
            headers: {
              get: jest.fn().mockImplementationOnce((header) => {
                if (header === 'Content-Type') {
                  return 'application/json'
                }
                throw new Error('Error')
              })
            } as unknown as Headers
          } as unknown as IHttpServerComponent.IRequest,
          url: {} as URL
        },
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

describe("when validating a request that has a valid schema that doesn't match the JSON body", () => {
  it('should return a bad request error signaling that the JSON body is invalid', () => {
    return expect(
      middleware(
        {
          params: {},
          request: {
            clone: jest.fn().mockReturnValue({
              json: () => ({ someProp: 'someValue' })
            }),
            headers: {
              get: jest.fn().mockImplementationOnce((header) => {
                if (header === 'Content-Type') {
                  return 'application/json'
                }
                throw new Error('Error')
              })
            } as unknown as Headers
          } as unknown as IHttpServerComponent.IRequest,
          url: {} as URL
        },
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
            params: {
              missingProperty: 'aTestProp'
            },
            schemaPath: '#/required'
          }
        ]
      }
    })
  })
})

describe('when validating a request that has a valid schema that matches the JSON body', () => {
  let next: jest.Mock
  beforeEach(() => {
    next = jest.fn()
  })

  it('should call next to continue handling the next middleware', async () => {
    await expect(
      middleware(
        {
          params: {},
          request: {
            clone: jest.fn().mockReturnValue({
              json: () => ({ aTestProp: 'someValue' })
            }),
            headers: {
              get: jest.fn().mockImplementationOnce((header) => {
                if (header === 'Content-Type') {
                  return 'application/json'
                }
                throw new Error('Error')
              })
            } as unknown as Headers
          } as unknown as IHttpServerComponent.IRequest,
          url: {} as URL
        },
        next
      )
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
    }).withSchemaValidatorMiddleware({
      type: 'object',
      properties: {
        aTestProp: {
          type: 'string'
        }
      },
      required: ['aTestProp']
    })
  })

  describe('and the Content-Type header is set to a value other than application/json', () => {
    it('should skip the Content-Type header validation and proceed to validate the JSON body', async () => {
      const next = jest.fn()

      await expect(
        middlewareWithoutContentTypeCheck(
          {
            params: {},
            request: {
              clone: jest.fn().mockReturnValue({
                json: () => ({ aTestProp: 'someValue' })
              }),
              headers: {
                get: jest.fn().mockImplementationOnce((header) => {
                  if (header === 'Content-Type') {
                    return 'text/plain' // Not application/json
                  }
                  throw new Error('Error')
                })
              } as unknown as Headers
            } as unknown as IHttpServerComponent.IRequest,
            url: {} as URL
          },
          next
        )
      )

      expect(next).toHaveBeenCalled()
    })
  })

  describe('and the Content-Type header is not set', () => {
    it('should skip the Content-Type header validation and proceed to validate the JSON body', async () => {
      const next = jest.fn()

      await expect(
        middlewareWithoutContentTypeCheck(
          {
            params: {},
            request: {
              clone: jest.fn().mockReturnValue({
                json: () => ({ aTestProp: 'someValue' })
              }),
              headers: {
                get: jest.fn().mockImplementationOnce((header) => {
                  if (header === 'Content-Type') {
                    return null
                  }
                  throw new Error('Error')
                })
              } as unknown as Headers
            } as unknown as IHttpServerComponent.IRequest,
            url: {} as URL
          },
          next
        )
      )

      expect(next).toHaveBeenCalled()
    })
  })
})

describe('when using addSchema and validateSchema directly', () => {
  let validator: ReturnType<typeof createSchemaValidatorComponent>

  beforeEach(() => {
    validator = createSchemaValidatorComponent()
    validator.addSchema(
      {
        type: 'object',
        properties: {
          aTestProp: { type: 'string' }
        },
        required: ['aTestProp']
      },
      'test-schema'
    )
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
      expect(result.errors).not.toBeNull()
      expect(result.errors?.[0]).toMatchObject({ keyword: 'required' })
    })
  })

  describe('and the referenced schema key is not registered', () => {
    it('should throw an error signaling the missing schema', () => {
      expect(() => validator.validateSchema('unknown-schema', {})).toThrow(
        'No schema was found with the key unknown-schema'
      )
    })
  })
})
