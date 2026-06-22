import { INVALID_SPAN_ID } from '../src/constants'
import type { TraceContext } from '@well-known-components/interfaces'
import { buildTraceContext, buildTraceString, generateSpanId, generateTraceId } from '../src/logic'

describe('when building a trace string', () => {
  const version = 0
  const traceId = 'aTraceId'
  const parentId = 'aParentId'
  const traceFlags = 1

  it('should create a string based in the traceparent header', () => {
    expect(buildTraceString({ version, traceId, parentId, traceFlags })).toBe(`${version}-${traceId}-${parentId}-${traceFlags}`)
  })
})

describe('when generating a traceId', () => {
  it('should generate a random hex string of 16 bytes', () => {
    expect(generateTraceId().length).toBe(32)
  })
})

describe('when generating a span id', () => {
  it('should generate a random hex string of 8 bytes', () => {
    expect(generateSpanId().length).toBe(16)
  })
})

describe('when building a trace context', () => {
  let traceContextBuilderInput: Omit<TraceContext, 'id' | 'parentId'> & Partial<Pick<TraceContext, 'parentId'>>

  beforeEach(() => {
    traceContextBuilderInput = {
      name: 'aName',
      traceId: 'aTraceId',
      version: 0,
      traceFlags: 0,
      traceState: { aTraceState: 'aTraceStateValue' },
      data: {}
    }
  })

  describe("and there's no parent id", () => {
    it('should return a Trace with a randomly generated span id and an invalid parent id', () => {
      expect(buildTraceContext(traceContextBuilderInput)).toEqual({
        ...traceContextBuilderInput,
        parentId: INVALID_SPAN_ID,
        id: expect.any(String)
      })
    })
  })

  describe("and there's a parent id", () => {
    beforeEach(() => {
      traceContextBuilderInput.parentId = 'aParentId'
    })

    it('should return a Trace with a randomly generated span id and the given parent id', () => {
      expect(buildTraceContext(traceContextBuilderInput)).toEqual({
        ...traceContextBuilderInput,
        id: expect.any(String)
      })
    })
  })
})
