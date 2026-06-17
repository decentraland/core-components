import { validateMetricsDeclaration } from '@dcl/metrics'

type ContentServerMetricLabelNames = 'remote_server'
export type ContentServerMetricLabels = Record<ContentServerMetricLabelNames, string>

/**
 * Prometheus metrics emitted by the content-downloader component. Wire these into your
 * `@dcl/metrics` component declaration.
 * @public
 */
export const metricsDefinitions = validateMetricsDeclaration({
  dcl_content_download_bytes_total: {
    help: 'Total downloaded bytes from other catalysts',
    type: 'counter',
    labelNames: ['remote_server']
  },
  dcl_content_download_duration_seconds: {
    help: 'Total download time from other catalysts',
    type: 'histogram',
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    labelNames: ['remote_server']
  },
  dcl_content_download_errors_total: {
    help: 'Total downloaded errors in requests',
    type: 'counter',
    labelNames: ['remote_server']
  },
  dcl_content_download_hash_errors_total: {
    help: 'Total hashing errors in downloaded files',
    type: 'counter',
    labelNames: ['remote_server']
  },
  dcl_content_download_job_succeed_retries: {
    help: 'Summary of how many retries are required for a download job to succeed',
    type: 'histogram',
    buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30],
    labelNames: []
  },
  dcl_available_servers_histogram: {
    help: 'Histogram of available content servers in which a content file is present',
    type: 'histogram',
    buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    labelNames: []
  }
})
