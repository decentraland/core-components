import { IMetricsComponent } from '@well-known-components/interfaces'

/**
 * Metrics declarations, needed for your IMetricsComponent
 */
export const metricDeclarations = {
  subgraph_ok_total: {
    help: 'Subgraph request counter',
    type: IMetricsComponent.CounterType,
    labelNames: ['url']
  },
  subgraph_errors_total: {
    help: 'Subgraph error counter',
    type: IMetricsComponent.CounterType,
    labelNames: ['url', 'kind']
  },
  subgraph_query_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Request duration in seconds.',
    labelNames: ['url'],
    // Buckets cover the escalating per-attempt timeouts (default 10s, +10s per retry).
    buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10, 20, 30, 60]
  }
} satisfies IMetricsComponent.MetricsRecordDefinition<string>
