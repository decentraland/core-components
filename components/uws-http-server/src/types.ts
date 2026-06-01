import {
  IBaseComponent,
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
const httpLabels = ['method', 'handler', 'code'] as const
import * as uws from 'uWebSockets.js'

export const metrics = {
  http_request_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Request duration in seconds.',
    labelNames: httpLabels
  },
  http_requests_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total number of HTTP requests',
    labelNames: httpLabels
  },
  http_request_size_bytes: {
    type: IMetricsComponent.HistogramType,
    help: 'Duration of HTTP requests size in bytes',
    labelNames: httpLabels
  }
}

/**
 * HTTP metrics definitions
 * @public
 */
export type HttpMetrics = keyof typeof metrics

/**
 * Prometheus Registry abstraction, used in prometheus instrumentation
 * @public
 */
export type PromRegistry = {
  contentType: string
  metrics(): Promise<string>
}

export type IUWsComponent = IBaseComponent & {
  start(): Promise<void>
  app: uws.TemplatedApp
}

export type Components = {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<HttpMetrics>
}
