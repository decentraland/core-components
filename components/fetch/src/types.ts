import { RequestOptions } from '@dcl/core-commons'

/**
 * Options used to configure a fetch component instance.
 */
export type FetcherOptions = {
  /** Headers injected on every request performed by the component. */
  defaultHeaders?: RequestInit['headers']
  /** Default request options merged into every request performed by the component. */
  defaultFetcherOptions?: RequestOptions
}
