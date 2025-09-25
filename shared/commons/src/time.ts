const ONE_SECOND_IN_MILLISECONDS = 1000
export const DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS = ONE_SECOND_IN_MILLISECONDS * 10
export const DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS = 200
export const DEFAULT_ACQUIRE_LOCK_RETRIES = 10

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function fromSecondsToMilliseconds(seconds: number): number {
  return seconds * 1000
}
