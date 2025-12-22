import { Request } from 'node-fetch'
import { bearerTokenMiddleware } from '../../../../src'
import { IHttpServerComponent } from '@well-known-components/interfaces'

describe('Bearer Token Middleware', () => {
  let next: () => Promise<IHttpServerComponent.IResponse>

  beforeEach(() => {
    next = jest.fn()
  })

  it('should fail to instantiate without a token', async () => {
    expect(() => bearerTokenMiddleware('')).toThrow('Bearer token middleware requires a secret')
    expect(next).not.toHaveBeenCalled()
  })

  it('should handle unauthenticated requests', async () => {
    const ctx: IHttpServerComponent.DefaultContext<any> = {
      request: new Request(''),
      url: new URL('http://localhost'),
      components: {}
    }

    await expect(bearerTokenMiddleware('some-token')(ctx, next)).rejects.toThrow('Authorization header is missing')
    expect(next).not.toHaveBeenCalled()
  })

  it('should handle request with wrong authentication', async () => {
    const ctx: IHttpServerComponent.DefaultContext<any> = {
      request: new Request('', {
        headers: {
          Authorization: 'Bearer saraza'
        }
      }),
      url: new URL('http://localhost'),
      components: {}
    }

    await expect(bearerTokenMiddleware('some-token')(ctx, next)).rejects.toThrow('Invalid authorization header')
    expect(next).not.toHaveBeenCalled()
  })

  it('should handle request with correct authentication', async () => {
    const ctx: IHttpServerComponent.DefaultContext<any> = {
      request: new Request('', {
        headers: {
          Authorization: 'Bearer some-token'
        }
      }),
      url: new URL('http://localhost'),
      components: {}
    }

    await expect(bearerTokenMiddleware('some-token')(ctx, next)).resolves.toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  it('should handle request with invalid authentication header', async () => {
    const ctx: IHttpServerComponent.DefaultContext<any> = {
      request: new Request('', {
        headers: {
          Authorization: 'Basic whatever'
        }
      }),
      url: new URL('http://localhost'),
      components: {}
    }

    await expect(bearerTokenMiddleware('some-token')(ctx, next)).rejects.toThrow('Invalid authorization header')
    expect(next).not.toHaveBeenCalled()
  })
})
