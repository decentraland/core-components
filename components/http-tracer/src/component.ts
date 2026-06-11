import type { ITracerComponent, TraceContext } from '@well-known-components/interfaces'
// Source IHttpServerComponent from @dcl/core-commons so this tracer accepts an @dcl/http-server v2
// server (native-fetch request/response types) without casts.
import type { IHttpServerComponent } from '@dcl/core-commons'
import { parseTraceParentHeader, parseTraceState } from './logic'
import { IHttpTracerComponent } from './types'

export function createHttpTracerComponent(components: {
  server: IHttpServerComponent<object>
  tracer: ITracerComponent
}): IHttpTracerComponent {
  const { server, tracer } = components

  server.use((ctx: IHttpServerComponent.DefaultContext<object>, next) => {
    const traceParentHeader = ctx.request.headers.get('traceparent')
    const traceParent = traceParentHeader ? parseTraceParentHeader(traceParentHeader) : null
    const traceStateHeader = ctx.request.headers.get('tracestate')
    const traceState = traceStateHeader ? parseTraceState(traceStateHeader) : undefined

    const traceContext: Omit<TraceContext, 'id' | 'data' | 'name'> | undefined = traceParent
      ? { ...traceParent, traceState: traceState ?? undefined }
      : undefined

    return tracer.span(
      `${ctx.request.method} ${ctx.url.toString()}`,
      () => {
        return next().then(response => {
          let traceHeaders: { traceparent: string; tracestate?: string } | undefined
          const traceparent = tracer.getTraceString()
          if (traceparent) {
            traceHeaders = { traceparent }
            const tracestate = tracer.getTraceStateString()
            if (tracestate) {
              traceHeaders.tracestate = tracestate
            }
          }
          return { ...response, headers: { ...response.headers, ...traceHeaders } }
        })
      },
      traceContext
    )
  })
}
