import type { Trace } from '@well-known-components/interfaces'

/**
 * Parses the tracestate header into an object.
 * @param traceParent - The tracestate header.
 * @returns An object which contains each property and its value found in the tracestate header or null.
 */
export function parseTraceState(traceState: string): Record<string, string> | null {
  const convertedTraceState = traceState.split(',').reduce((acc, curr) => {
    const [key, value] = curr.split('=')
    if (!key || !value) {
      return acc
    }
    acc[key.trim()] = value.trim()
    return acc
  }, {} as Record<string, string>)

  return Object.keys(convertedTraceState).length > 0 ? convertedTraceState : null
}

/**
 * Parses the traceparent header into an object.
 * @param traceParent - The traceparent header.
 * @returns An object which contains each property of the tranceparent header or null if it can't be parsed.
 */
export function parseTraceParentHeader(traceParent: string): Trace | null {
  const traceParentProperties = traceParent.split('-')
  if (!traceParentProperties[0] || !traceParentProperties[1] || !traceParentProperties[2] || !traceParentProperties[3]) {
    return null
  }

  const versionHasTheWrongSize = traceParentProperties[0].length !== 2
  const traceIdHasTheWrongSize = traceParentProperties[1].length !== 32
  const parentIdHasTheWrongSize = traceParentProperties[2].length !== 16
  const traceFlagsHaveTheWrongSize = traceParentProperties[3].length !== 2
  const traceIdIsInvalid = traceParentProperties[1] === '00000000000000000000000000000000'
  const parentIdIsInvalid = traceParentProperties[2] === '0000000000000000'

  return versionHasTheWrongSize ||
    traceIdHasTheWrongSize ||
    parentIdHasTheWrongSize ||
    traceFlagsHaveTheWrongSize ||
    traceIdIsInvalid ||
    parentIdIsInvalid
    ? null
    : {
        version: parseInt(traceParentProperties[0], 16),
        traceId: traceParentProperties[1],
        parentId: traceParentProperties[2],
        traceFlags: parseInt(traceParentProperties[3], 16)
      }
}
