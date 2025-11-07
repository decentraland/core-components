import { createFetchComponent } from '@well-known-components/fetch-component'
import type { IFetchComponent, ITracerComponent } from '@well-known-components/interfaces'

/**
 * Type guard to check if the headers object is a Headers-like object.
 * This is used to to handle Header instances from different libraries.
 * @param headers - The headers object to check.
 * @returns True if the headers object is a Headers-like object, false otherwise.
 */
function isHeadersLike(
  headers: unknown
): headers is { forEach: (callback: (value: string, key: string) => void) => void } {
  return (
    typeof headers === 'object' &&
    headers !== null &&
    'forEach' in headers &&
    typeof (headers as any).forEach === 'function'
  )
}

export async function createTracedFetcherComponent(components: {
  tracer: ITracerComponent
  fetchComponent?: IFetchComponent
}): Promise<IFetchComponent> {
  const { tracer, fetchComponent: fetchComponentOverride } = components

  const fetchComponent = fetchComponentOverride ?? createFetchComponent()

  const fetch: IFetchComponent = {
    async fetch(
      url: Parameters<typeof fetchComponent.fetch>[0],
      init?: Parameters<typeof fetchComponent.fetch>[1]
    ): ReturnType<typeof fetchComponent.fetch> {
      const headers: Record<string, string> = {}
      if (init?.headers) {
        if (isHeadersLike(init.headers)) {
          init.headers.forEach((value, key) => {
            headers[key] = value
          })
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value
          })
        } else {
          Object.assign(headers, init.headers)
        }
      }
      const traceParent = tracer.isInsideOfTraceSpan() ? tracer.getTraceChildString() : null
      if (traceParent) {
        headers.traceparent = traceParent
        const traceState = tracer.getTraceStateString()
        if (traceState) {
          headers.tracestate = traceState
        }
      }
      return fetchComponent.fetch(url, { ...init, headers })
    }
  }

  return fetch
}
