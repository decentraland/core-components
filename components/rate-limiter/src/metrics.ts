import { IMetricsComponent } from '@well-known-components/interfaces'

// Every label here is deliberately low-cardinality. A Prometheus series is created per label
// combination, so the identity — an IP or a wallet address — must never become a label: it would be
// unbounded, and it would put personal data in the metrics endpoint. `handler` is the route template
// (`/v1/notes/:id`), not the request path, for the same reason.
const rateLimitLabels = ['bucket', 'handler', 'outcome', 'key_source'] as const

/**
 * Metrics declarations, needed for your IMetricsComponent.
 *
 * @public
 */
export const metricDeclarations = {
  rate_limiter_requests_total: {
    help: 'Requests counted by the rate limiter, by outcome.',
    type: IMetricsComponent.CounterType,
    labelNames: rateLimitLabels
  },
  rate_limiter_client_address_issues_total: {
    help: 'Requests whose client address could not be resolved as configured. A sustained rate means the limiter is keying on the wrong thing — most often that every caller is sharing one bucket.',
    type: IMetricsComponent.CounterType,
    labelNames: ['bucket', 'issue'] as const
  },
  rate_limiter_store_errors_total: {
    help: 'Failures reading or writing a rate limit counter. A non-zero rate means the limiter is degraded: with failOpen it is not limiting, without it everything is being rejected.',
    type: IMetricsComponent.CounterType,
    labelNames: ['bucket', 'fail_open'] as const
  }
} satisfies IMetricsComponent.MetricsRecordDefinition<string>

/**
 * The value of the `outcome` label on {@link metricDeclarations.rate_limiter_requests_total}.
 *
 * @public
 */
export enum RateLimitOutcome {
  /** Counted and within the allowance. */
  ALLOWED = 'allowed',
  /** Counted and over the allowance, so the request was rejected. */
  LIMITED = 'limited',
  /**
   * Not really counted — the store failed, and the `failOpen` policy decided the outcome. Kept
   * separate from `allowed` so a cache outage cannot masquerade as healthy traffic on a dashboard.
   */
  DEGRADED = 'degraded'
}

/**
 * The value of the `issue` label on `rate_limiter_client_address_issues_total`.
 *
 * Each of these is a misconfiguration rather than a request-level event, and each one collapses
 * callers into a shared bucket, so a sustained rate on any of them is worth an alert.
 *
 * @public
 */
export enum RateLimitAddressIssue {
  /** A `trustedClientIpHeader` is configured but the request did not carry it. */
  TRUSTED_HEADER_MISSING = 'trusted-header-missing',
  /** The configured header was present but held no usable address, or fewer hops than trusted. */
  TRUSTED_HEADER_UNUSABLE = 'trusted-header-unusable',
  /** No address at all, so the request went to the shared fallback bucket. */
  NO_CLIENT_ADDRESS = 'no-client-address'
}
