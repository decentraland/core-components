import { IHttpServerComponent } from '@well-known-components/interfaces'
import { NotAuthorizedError } from '../../errors'

export function bearerTokenMiddleware(authSecret: string) {
  if (!authSecret) {
    throw new Error('Bearer token middleware requires a secret')
  }

  return async function (
    ctx: IHttpServerComponent.DefaultContext<any>,
    next: () => Promise<IHttpServerComponent.IResponse>
  ): Promise<IHttpServerComponent.IResponse> {
    const header = ctx.request.headers.get('authorization')
    if (!header) {
      throw new NotAuthorizedError('Authorization header is missing')
    }

    const [type, value] = header.split(' ')
    if (type !== 'Bearer' || value !== authSecret) {
      throw new NotAuthorizedError('Invalid authorization header')
    }

    return await next()
  }
}
