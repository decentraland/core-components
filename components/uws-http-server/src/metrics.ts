import { IMetricsComponent } from '@well-known-components/interfaces'
import * as uws from 'uWebSockets.js'
import { Components, HttpMetrics, metrics } from './types'

export const CONFIG_PREFIX = 'WKC_METRICS' as const

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
      const body = await registry.metrics()

      if (bearerToken) {
        const header = req.getHeader('authorization')
        if (!header) {
          res.writeStatus('401 Forbidden')
          res.end()
          return
        }
        const [_, value] = header.split(' ')
        if (value !== bearerToken) {
          res.writeStatus('401 Forbidden')
          res.end()
          return
        }
      }

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
