import { validateMetricsDeclaration } from '@dcl/metrics'

/**
 * Prometheus metrics emitted by the snapshots-synchronizer component. Wire these into your
 * `@dcl/metrics` component declaration. (Download metrics live in `@dcl/content-downloader-component`.)
 * @public
 */
export const metricsDefinitions = validateMetricsDeclaration({
  dcl_entities_deployments_processed_total: {
    help: 'Entities processed from remote catalysts',
    type: 'counter',
    labelNames: ['remote_server', 'source']
  },
  dcl_entities_deployments_streamed_total: {
    help: 'Entities streamed from remote catalysts',
    type: 'counter',
    labelNames: ['remote_server', 'source'] // source=snapshots|pointer-changes
  },
  dcl_catalysts_pointer_changes_response_time_seconds: {
    help: 'Response time of the pointer-changes endpoint',
    type: 'histogram',
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    labelNames: ['remote_server', 'status_code']
  },
  dcl_deployments_stream_reconnection_count: {
    help: 'Counts the connection of a deployment stream',
    type: 'counter',
    labelNames: ['remote_server']
  },
  dcl_deployments_stream_failure_count: {
    help: 'Counts the failures of a deployment stream',
    type: 'counter',
    labelNames: ['remote_server']
  },
  dcl_bootstrapping_servers: {
    help: 'Servers that are in bootstrapping state',
    type: 'gauge',
    labelNames: ['from'] // from='snapshots'|'pointer-changes'
  },
  dcl_syncing_servers: {
    help: 'Servers that are in syncing state',
    type: 'gauge'
  },
  dcl_processed_snapshots_total: {
    help: 'Total number of processed snapshots that started being streamed.',
    type: 'counter',
    labelNames: ['state'] // state='stream_start'|'stream_end'|'saved'
  }
})
