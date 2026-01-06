import { IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '../../src'
import { metricDeclarations as logMetricDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics } from '@well-known-components/http-server'

export const metricDeclarations = {
  ...logMetricDeclarations,
  ...getDefaultHttpMetrics(),
  test_counter: {
    type: IMetricsComponent.CounterType,
    help: 'Count calls to ping',
    labelNames: ['pathname']
  },
  test_gauge: {
    type: IMetricsComponent.GaugeType,
    help: 'Gauges calls to ping (?)',
    labelNames: ['pathname']
  },
  test_histogram: {
    type: IMetricsComponent.HistogramType,
    help: 'Histograms calls to ping (?)',
    labelNames: ['pathname']
  },
  test_summary: {
    type: IMetricsComponent.SummaryType,
    help: 'Summaries calls to ping (?)',
    labelNames: ['pathname']
  },
  user_counter: {
    type: IMetricsComponent.CounterType,
    help: 'Count calls to /user/:userId',
    labelNames: ['userId']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
