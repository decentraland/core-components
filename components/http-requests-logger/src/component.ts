import { ILoggerComponent } from '@well-known-components/interfaces'
// Source IHttpServerComponent from @dcl/core-commons so this logger accepts an @dcl/http-server v2
// server (native-fetch request/response types) without casts.
import { IHttpServerComponent } from '@dcl/core-commons'
import { HEALTH_LIVE, HEALTH_READY } from './constants'
import { shouldSkip } from './logic'
import { RequestLoggerConfigurations, Verbosity } from './types'

// Endpoints whose request/response logs are skipped unless the caller overrides `skip`.
const DEFAULT_SKIP_ENDPOINTS = [HEALTH_LIVE, HEALTH_READY]

export function instrumentHttpServerWithRequestLogger(
  components: {
    server: IHttpServerComponent<object>
    logger: ILoggerComponent
  },
  config?: RequestLoggerConfigurations
): void {
  const { server, logger } = components
  const verbosity = config?.verbosity ?? Verbosity.INFO
  const inLogger = logger.getLogger('http-in')
  const outLogger = logger.getLogger('http-out')

  server.use(async (ctx: IHttpServerComponent.DefaultContext<object>, next) => {
    const skipInput = config?.skipInput
    const skipOutput = config?.skipOutput
    // Skip health checks by default
    const skip = shouldSkip(ctx, config?.skip ?? DEFAULT_SKIP_ENDPOINTS)

    if (!skipInput && !skip) {
      // Build the input log lazily so a custom inputLog callback isn't invoked for skipped requests.
      const inLog = config?.inputLog
        ? config.inputLog(ctx.request)
        : `[${ctx.request.method}: ${ctx.url.pathname}${ctx.url.search}${ctx.url.hash}]`
      inLogger[verbosity](inLog)
    }
    let response: IHttpServerComponent.IResponse | undefined = undefined
    let errored = false

    try {
      response = await next()
      return response
    } catch (e) {
      errored = true
      // Craft a custom response with the purpose of printing the log. Default to 500
      // since reaching here means an error escaped the handler chain.
      let statusCode = 500
      if (typeof e === 'object' && e !== null && e !== undefined) {
        if ('status' in e && typeof e.status == 'number') {
          statusCode = e.status
        } else if ('statusCode' in e && typeof e.statusCode == 'number') {
          statusCode = e.statusCode
        }
      }
      response = {
        status: statusCode
      }
      throw e
    } finally {
      if (!skipOutput && !skip && response) {
        // Surface failures at error level regardless of the configured verbosity.
        const outVerbosity = errored ? Verbosity.ERROR : verbosity
        outLogger[outVerbosity](
          config?.outputLog
            ? config.outputLog(ctx.request, response)
            : `[${ctx.request.method}: ${ctx.url.pathname}${ctx.url.search}${ctx.url.hash}][${response.status}]`
        )
      }
    }
  })
}
