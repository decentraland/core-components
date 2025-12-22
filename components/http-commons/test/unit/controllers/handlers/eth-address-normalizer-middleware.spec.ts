import { ethAddressNormalizerMiddleware } from '../../../../src/controllers/handlers/eth-address-normalizer-middleware'
import { IHttpServerComponent } from '@well-known-components/interfaces'

describe('ethAddressNormalizerMiddleware', () => {
  let middleware: ReturnType<typeof ethAddressNormalizerMiddleware>
  let mockNext: jest.Mock
  let mockContext: IHttpServerComponent.DefaultContext<any>

  beforeEach(() => {
    middleware = ethAddressNormalizerMiddleware()
    mockNext = jest.fn().mockResolvedValue({ status: 200, body: {} })
  })

  describe('when processing valid Ethereum addresses', () => {
    describe('when processing a single Ethereum address', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        })
      })

      it('should convert mixed-case Ethereum addresses to lowercase', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.address).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when processing multiple Ethereum addresses', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          userAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
          contractAddress: '0x1234567890ABCDEF1234567890ABCDEF12345678'
        })
      })

      it('should handle multiple Ethereum addresses in parameters', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.userAddress).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockContext.params.contractAddress).toBe('0x1234567890abcdef1234567890abcdef12345678')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when processing addresses with different case patterns', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          allLower: '0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6',
          allUpper: '0x742D35CC6634C0532925A3B8D4C9DB96C4B4D8B6',
          mixedCase: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        })
      })

      it('should normalize all case patterns to lowercase', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.allLower).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockContext.params.allUpper).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockContext.params.mixedCase).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  describe('when processing non-Ethereum address parameters', () => {
    describe('when processing regular string parameters', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          userId: '123',
          name: 'John Doe',
          email: 'john@example.com'
        })
      })

      it('should leave non-Ethereum address parameters unchanged', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.userId).toBe('123')
        expect(mockContext.params.name).toBe('John Doe')
        expect(mockContext.params.email).toBe('john@example.com')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when processing mixed valid and invalid parameters', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          userId: '123',
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
          name: 'John Doe',
          contractAddress: '0x1234567890ABCDEF1234567890ABCDEF12345678'
        })
      })

      it('should handle mixed parameters correctly', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.userId).toBe('123')
        expect(mockContext.params.address).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockContext.params.name).toBe('John Doe')
        expect(mockContext.params.contractAddress).toBe('0x1234567890abcdef1234567890abcdef12345678')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  describe('when processing invalid Ethereum addresses', () => {
    describe('when processing malformed addresses', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          invalidAddress: '0x123', // Too short
          shortAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b', // 39 chars
          longAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6a', // 41 chars
          validAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        })
      })

      it('should reject invalid Ethereum addresses', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.invalidAddress).toBe('0x123')
        expect(mockContext.params.shortAddress).toBe('0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b')
        expect(mockContext.params.longAddress).toBe('0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6a')
        expect(mockContext.params.validAddress).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  describe('when processing different data types', () => {
    describe('when processing non-string parameters', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          number: 123,
          boolean: true,
          array: ['0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'],
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        })
      })

      it('should only process string parameters', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.number).toBe(123)
        expect(mockContext.params.boolean).toBe(true)
        expect(mockContext.params.array).toEqual(['0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'])
        expect(mockContext.params.address).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  describe('when handling missing or invalid parameters object', () => {
    describe('when params is undefined', () => {
      beforeEach(() => {
        mockContext = createMockContext()
        mockContext.params = undefined
      })

      it('should handle undefined parameters gracefully', async () => {
        await middleware(mockContext, mockNext)

        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when params is null', () => {
      beforeEach(() => {
        mockContext = createMockContext()
        mockContext.params = null
      })

      it('should handle null parameters gracefully', async () => {
        await middleware(mockContext, mockNext)

        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when params is not an object', () => {
      beforeEach(() => {
        mockContext = createMockContext()
        mockContext.params = 'not-an-object'
      })

      it('should handle non-object parameters gracefully', async () => {
        await middleware(mockContext, mockNext)

        expect(mockNext).toHaveBeenCalledWith()
      })
    })

    describe('when params is an empty object', () => {
      beforeEach(() => {
        mockContext = createMockContext({})
      })

      it('should handle empty parameters object', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params).toEqual({})
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  describe('when testing middleware behavior', () => {
    describe('when processing valid addresses', () => {
      beforeEach(() => {
        const originalParams = {
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        }
        mockContext = createMockContext(originalParams)
      })

      it('should mutate the original context parameters', async () => {
        await middleware(mockContext, mockNext)

        expect(mockContext.params.address).toBe('0x742d35cc6634c0532925a3b8d4c9db96c4b4d8b6')
      })
    })

    describe('when calling the next middleware', () => {
      beforeEach(() => {
        mockContext = createMockContext({
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
        })
      })

      it('should call the next middleware function', async () => {
        await middleware(mockContext, mockNext)

        expect(mockNext).toHaveBeenCalledTimes(1)
        expect(mockNext).toHaveBeenCalledWith()
      })
    })
  })

  // Helpers
  const createMockContext = (params: Record<string, any> = {}) => {
    return {
      url: new URL('http://localhost:3000/test'),
      params,
      components: {
        logs: {
          getLogger: jest.fn().mockReturnValue({
            warn: jest.fn(),
            error: jest.fn(),
            info: jest.fn()
          })
        }
      }
    } as IHttpServerComponent.DefaultContext<any>
  }
})
