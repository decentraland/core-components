import { contextFromRequest, defaultHandler, getDefaultMiddlewares, normalizeResponseBody, NormalizedResponse } from './logic'
import { Middleware, compose } from './middleware'
import { IHttpServerComponent as http } from '@dcl/core-commons'

// @internal
export function createServerHandler<Context extends object>() {
  let middlewares: http.IRequestHandler<Context>[]
  let theFinalHandler: http.IRequestHandler<Context>

  function doMiddlewareComposition() {
    theFinalHandler = compose(...middlewares)
  }

  function resetMiddlewares() {
    middlewares = getDefaultMiddlewares()
    doMiddlewareComposition()
  }

  // initialize default middleware
  resetMiddlewares()

  const use: http<Context>['use'] = async (handler) => {
    middlewares.push(handler)
    doMiddlewareComposition()
  }

  async function processRequest(currentContext: Context, req: http.IRequest): Promise<NormalizedResponse> {
    const ctx = contextFromRequest(currentContext, req)
    const res = await theFinalHandler(ctx, defaultHandler)
    return normalizeResponseBody(req, res)
  }

  return {
    resetMiddlewares,
    use,
    processRequest
  }
}
