import { IMetricsComponent } from "@well-known-components/interfaces"

/**
 * Metrics declarations, needed for your IMetricsComponent
 * @public
 */
export const metricDeclarations: IMetricsComponent.MetricsRecordDefinition<string> = {
  dcl_db_query_duration_seconds: {
    help: "Histogram of query duration to the database in seconds per query",
    type: IMetricsComponent.HistogramType,
    labelNames: ["query", "status"], // status=(success|error)
  },
  dcl_db_connection_status: {
    help: "Whether the database is currently reachable (1) or not (0)",
    type: IMetricsComponent.GaugeType,
  },
  dcl_db_reconnection_attempts_total: {
    help: "Count of attempts made to recover from a database disconnection",
    type: IMetricsComponent.CounterType,
    // source=(operation|probe): a retried operation vs. the background reconnection loop
    labelNames: ["source", "status"], // status=(success|failure)
  },
}
