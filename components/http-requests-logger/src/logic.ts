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
  const regExp = skipper as RegExp
  // Strip the global/sticky flags: the same regex is reused across requests, and `.test()`
  // on a global/sticky regex advances `lastIndex`, which would make matches alternate per call.
  const statelessRegExp =
    regExp.global || regExp.sticky ? new RegExp(regExp.source, regExp.flags.replace(/[gy]/g, '')) : regExp
  return statelessRegExp.test(ctx.url.pathname)
}
