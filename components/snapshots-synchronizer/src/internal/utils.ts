import { IFetchComponent, RequestOptions } from '@well-known-components/interfaces'

// Bounds buffered JSON responses so a malicious server can't OOM the process via response.json().
// The underlying fetch implementation rejects bodies larger than `size`.
const MAX_JSON_RESPONSE_SIZE_IN_BYTES = 50 * 1024 * 1024 // 50 MiB

export async function fetchJson(url: string, fetcher: IFetchComponent, init?: RequestOptions): Promise<any> {
  // `size` is spread last so the cap can't be accidentally overridden (or removed) by a caller.
  const response = await fetcher.fetch(url, { ...init, size: MAX_JSON_RESPONSE_SIZE_IN_BYTES })
  if (!response.ok) {
    throw new Error('Error fetching ' + url + '. Status code was: ' + response.status)
  }
  return response.json()
}

export type ContentServerMetricLabels = { remote_server: string }

export function contentServerMetricLabels(contentServer: string): ContentServerMetricLabels {
  return { remote_server: new URL(contentServer).origin }
}

export function sleep(time: number): Promise<void> {
  if (time <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => setTimeout(resolve, time))
}
