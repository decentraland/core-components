import { IHttpServerComponent } from '@well-known-components/interfaces'
import { InvalidRequestError, NotAuthorizedError, NotFoundError } from '../../errors'
import { ComponentsWithLogger } from '../../types'

export async function errorHandler(
  ctx: IHttpServerComponent.DefaultContext<ComponentsWithLogger>,
  next: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  try {
    return await next()
  } catch (error: any) {
    if (error instanceof InvalidRequestError) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: error.message
        }
      }
    }

    if (error instanceof NotFoundError) {
      return {
        status: 404,
        body: {
          error: 'Not Found',
          message: error.message
        }
      }
    }

    if (error instanceof NotAuthorizedError) {
      return {
        status: 401,
        body: {
          error: 'Not Authorized',
          message: error.message
        }
      }
    }

    const { logs } = ctx.components
    const logger = logs.getLogger('error-handler')
    logger.warn(`Error handling ${ctx.url.toString()}: ${error.message}`)

    return {
      status: 500,
      body: {
        error: 'Internal Server Error'
      }
    }
  }
}
