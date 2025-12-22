import { Request } from 'node-fetch'
import { InvalidRequestError, NotAuthorizedError, NotFoundError } from '../../../../src'
import { IHttpServerComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { errorHandler } from '../../../../src/controllers'
import { createLogComponent } from '@well-known-components/logger'
import { ComponentsWithLogger } from '../../../../src/types'

describe('Error Handler', () => {
  let ctx: IHttpServerComponent.DefaultContext<ComponentsWithLogger>
  let logs: ILoggerComponent

  beforeEach(async () => {
    logs = await createLogComponent({})
    ctx = {
      request: new Request('', {
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' })
      }),
      url: new URL('http://localhost'),
      components: { logs }
    }
  })

  it('should handle InvalidRequestError correctly', async () => {
    const next = async () => {
      throw new InvalidRequestError('invalid error')
    }

    await expect(errorHandler(ctx, next)).resolves.toEqual({
      body: { error: 'Bad request', message: 'invalid error' },
      status: 400
    })
  })

  it('should handle NotFoundError correctly', async () => {
    const next = async () => {
      throw new NotFoundError('not found error')
    }

    await expect(errorHandler(ctx, next)).resolves.toEqual({
      body: { error: 'Not Found', message: 'not found error' },
      status: 404
    })
  })

  it('should handle NotAuthorizedError correctly', async () => {
    const next = async () => {
      throw new NotAuthorizedError('not authorized error')
    }

    await expect(errorHandler(ctx, next)).resolves.toEqual({
      body: { error: 'Not Authorized', message: 'not authorized error' },
      status: 401
    })
  })

  it('should handle unhandled errors correctly', async () => {
    const next = async () => {
      throw new Error('unknown error')
    }

    await expect(errorHandler(ctx, next)).resolves.toEqual({
      body: { error: 'Internal Server Error' },
      status: 500
    })
  })
})
