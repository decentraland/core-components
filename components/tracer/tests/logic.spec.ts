import { INVALID_SPAN_ID } from '../src/constants'
import type { TraceContext } from '@well-known-components/interfaces'
import { buildTraceContext, buildTraceString, generateSpanId, generateTraceId } from '../src/logic'

describe('when building a trace string', () => {
  const traceId = 'aTraceId'
  const parentId = 'aParentId'

  describe('and the version and trace flags are single hex digit values', () => {
    it('should zero-pad the version and trace flags to two hex digits', () => {
      expect(buildTraceString({ version: 0, traceId, parentId, traceFlags: 1 })).toBe(`00-${traceId}-${parentId}-01`)
    })
  })

  describe('and the version and trace flags already span two hex digits', () => {
    it('should hex encode them without further padding', () => {
      expect(buildTraceString({ version: 2, traceId, parentId, traceFlags: 255 })).toBe(`02-${traceId}-${parentId}-ff`)
    })
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
