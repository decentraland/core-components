import { randomBytes } from 'node:crypto'
import type { Trace, TraceContext } from '@well-known-components/interfaces'
import { INVALID_SPAN_ID } from './constants'

/**
 * Builds a trace parent string representation based on its properties.
 * @param traceParent - The trace parent.
 */
export function buildTraceString(traceParent: Trace): string {
  return `${traceParent.version.toString(16)}-${traceParent.traceId}-${traceParent.parentId}-${traceParent.traceFlags.toString(16)}`
}

/**
 * Generates a random set of bytes and then converts them into a lowercased hex string.
 * @param length - The length in bytes from where to generate the hex string.
 */
function generateRandomBytesHexString(length: number): string {
  return randomBytes(length).toString('hex').toLowerCase()
}

/**
 * Generates a random trace id represented as an hex string.
 */
export function generateTraceId(): string {
  return generateRandomBytesHexString(16)
}

/**
 * Generates a random parent id represented as an hex string.
 */
export function generateSpanId(): string {
  return generateRandomBytesHexString(8)
}

/**
 * Builds a trace context using the provided trace information.
 * If no parent id is provided, a null parent id will be set for the trace context.
 */
export function buildTraceContext<T>({
  name,
  parentId,
  traceId,
  version,
  traceFlags,
  traceState,
  data
}: {
  name: string
  parentId?: string
  traceId: string
  version: number
  traceFlags: number
  traceState?: Record<string, string>
  data?: T
}): TraceContext {
  return {
    name,
    id: generateSpanId(),
    parentId: parentId ?? INVALID_SPAN_ID,
    traceId,
    version,
    traceFlags,
    traceState,
    data
  }
}
