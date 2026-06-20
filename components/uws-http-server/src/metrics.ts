import { createHash, timingSafeEqual } from 'crypto'
import { IMetricsComponent } from '@well-known-components/interfaces'
import * as uws from 'uWebSockets.js'
import { Components, HttpMetrics, metrics } from './types'

export const CONFIG_PREFIX = 'WKC_METRICS' as const

/**
 * Constant-time comparison of a candidate bearer token against the expected one.
 * Both values are hashed to a fixed-length digest first so `timingSafeEqual`
 * never throws on a length mismatch and the comparison does not leak the token
 * length through timing.
 */
function safeTokenEquals(candidate: string | undefined, expected: string): boolean {
  if (typeof candidate !== 'string') return false
  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}

export function getDefaultHttpMetrics(): IMetricsComponent.MetricsRecordDefinition<HttpMetrics> {
  return metrics
}

export function _configKey(key: Uppercase<string>): string {
  return `${CONFIG_PREFIX}_${key.toUpperCase().replace(/^(_*)/, '')}`
}

const noopStartTimer = { end() {} }

export async function createMetricsHandler(
  components: Pick<Components, 'config' | 'metrics'>,
  registry: IMetricsComponent.Registry
) {
  const { metrics, config } = components

  const metricsPath = (await config.getString(_configKey('PUBLIC_PATH'))) || '/metrics'
  const bearerToken = await config.getString(_configKey('BEARER_TOKEN'))
  const rotateMetrics = (await config.getString(_configKey('RESET_AT_NIGHT'))) === 'true'

  function calculateNextReset() {
    return new Date(new Date(new Date().toDateString()).getTime() + 86400000).getTime()
  }

  let nextReset: number = calculateNextReset()

  return {
    path: metricsPath,
    handler: async (res: uws.HttpResponse, req: uws.HttpRequest) => {
      // uWebSockets.js invalidates `res` once the client disconnects; writing to
      // it afterwards throws and crashes the process. Track aborts so the async
      // section below can bail out before touching `res` again.
      let aborted = false
      res.onAborted(() => {
        aborted = true
      })

      // The request object is only valid synchronously (before the first
      // `await`), so authorization is checked here. This also avoids serializing
      // the metrics for unauthorized callers.
      if (bearerToken) {
        const header = req.getHeader('authorization')
        const [scheme, value] = header ? header.split(' ') : []
        if (scheme !== 'Bearer' || !safeTokenEquals(value, bearerToken)) {
          res.writeStatus('401 Unauthorized')
          res.end()
          return
        }
      }

      const body = await registry.metrics()

      if (aborted) return

      // heavy-metric servers that run for long hours tend to generate precision problems
      // and memory degradation for histograms if not cleared enough. this method
      // resets the metrics once per day at 00.00UTC
      if (rotateMetrics && Date.now() > nextReset) {
        nextReset = calculateNextReset()
        metrics.resetAll()
      }

      res.writeStatus('200 OK')
      res.writeHeader('content-type', registry.contentType)
      res.end(body)
    }
  }
}

export function onRequestStart(metrics: IMetricsComponent<HttpMetrics>, method: string, handler: string) {
  const labels = {
    method,
    handler
  }
  const startTimerResult = metrics.startTimer('http_request_duration_seconds', labels)
  const end = startTimerResult?.end || noopStartTimer.end
  return { end, labels }
}

export function onRequestEnd(
  metrics: IMetricsComponent<HttpMetrics>,
  startLabels: Record<string, any>,
  code: number,
  end: (labels: Record<string, any>) => void
) {
  const labels = {
    ...startLabels,
    code
  }

  metrics.increment('http_requests_total', labels)
  end(labels)
}
