import { IMetricsComponent } from "@well-known-components/interfaces"
import { Registry, Counter, Histogram, Summary, Gauge } from "prom-client"

type InternalMetric =
  | {
      type: IMetricsComponent.GaugeType
      definition: IMetricsComponent.GaugeMetricDefinition
      value: Gauge<any>
    }
  | {
      type: IMetricsComponent.HistogramType
      definition: IMetricsComponent.HistogramMetricDefinition
      value: Histogram<any>
    }
  | {
      type: IMetricsComponent.CounterType
      definition: IMetricsComponent.CounterMetricDefinition
      value: Counter<any>
    }
  | {
      type: IMetricsComponent.SummaryType
      definition: IMetricsComponent.SummaryMetricDefinition
      value: Summary<any>
    }

/**
 * @public
 */
export function createTestMetricsComponent<K extends string>(
  metricsDefinition: IMetricsComponent.MetricsRecordDefinition<K>
): IMetricsComponent<K> & { registry: Registry } {
  const registry = new Registry()
  const metricsMap = new Map<K, InternalMetric>()

  Object.entries<IMetricsComponent.MetricDefinition>(metricsDefinition).forEach(([name, definition]) => {
    let value: Counter<any> | Histogram<any> | Summary<any> | Gauge<any> | undefined

    let args = {
      name: name,
      ...definition,
      registers: [registry],
    }

    if (definition.type == IMetricsComponent.CounterType) {
      value = new Counter(args)
    } else if (definition.type == IMetricsComponent.HistogramType) {
      value = new Histogram(args)
    } else if (definition.type == IMetricsComponent.SummaryType) {
      value = new Summary(args)
    } else if (definition.type == IMetricsComponent.GaugeType) {
      value = new Gauge(args)
    }

    if (!value) throw new Error(`Unknown metric type ${definition.type}`)

    const metric = {
      definition: { ...definition },
      type: definition.type,
      value,
    } as InternalMetric

    metricsMap.set(name as any, metric)
  })

  registry.resetMetrics()

  return {
    observe(metricName, labels, value) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        if (metric.type == IMetricsComponent.GaugeType) {
          metric.value.set(labels, value)
        } else if (metric.type == IMetricsComponent.SummaryType) {
          metric.value.observe(labels, value)
        } else if (metric.type == IMetricsComponent.HistogramType) {
          metric.value.observe(labels, value)
        } else
          throw new Error(
            `Only "${IMetricsComponent.GaugeType}" and "${IMetricsComponent.SummaryType}" can be used with .observe`
          )
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },
    increment(metricName, labels?, value?) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        if (metric.type == IMetricsComponent.CounterType) {
          metric.value.inc(labels || {}, value)
        } else if (metric.type == IMetricsComponent.GaugeType) {
          metric.value.inc(labels || {}, value)
        } else
          throw new Error(
            `Only "${IMetricsComponent.GaugeType}" and "${IMetricsComponent.CounterType}" metrics can be used with .increment`
          )
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },
    decrement(metricName, labels?, value?) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        if (metric.type == IMetricsComponent.GaugeType) {
          metric.value.dec(labels || {}, value)
        } else throw new Error(`Only "${IMetricsComponent.GaugeType}" metrics can be used with .decrement`)
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },
    startTimer(metricName, labels?) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        if (metric.type == IMetricsComponent.GaugeType) {
          const end = metric.value.startTimer(labels)
          return { end }
        } else if (metric.type == IMetricsComponent.HistogramType) {
          const end = metric.value.startTimer(labels)
          return { end }
        } else if (metric.type == IMetricsComponent.SummaryType) {
          const end = metric.value.startTimer(labels)
          return { end }
        } else
          throw new Error(
            `Only "${IMetricsComponent.GaugeType}", "${IMetricsComponent.HistogramType}" and "${IMetricsComponent.SummaryType}" metrics can be used with .startTimer`
          )
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },

    reset(metricName: K) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        metric.value.reset()
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },
    resetAll() {
      registry.resetMetrics()
    },
    getValue(metricName: K) {
      if (metricsMap.has(metricName)) {
        const metric = metricsMap.get(metricName)!
        return (metric.value as any).get()
      } else {
        throw new Error(`Unknown metric ${metricName}`)
      }
    },
    registry,
  }
}
