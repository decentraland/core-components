import { IHttpServerComponent } from '@dcl/core-commons'

export function shouldSkip(
  ctx: IHttpServerComponent.DefaultContext<object>,
  skipper: ((req: IHttpServerComponent.DefaultContext<object>['request']) => boolean) | string[] | string | RegExp
) {
  if (typeof skipper === 'string') {
    return skipper === ctx.url.pathname
  } else if (Array.isArray(skipper)) {
    return skipper.some(urlToSkip => urlToSkip === ctx.url.pathname)
  } else if (typeof skipper === 'function') {
    return skipper(ctx.request)
  }
  return (skipper as RegExp).test(ctx.url.pathname)
}
