import { parseTraceParentHeader, parseTraceState } from '../src/logic'

describe('when parsing the trace state header', () => {
  describe('and it is empty', () => {
    it('should return null', () => {
      expect(parseTraceState('')).toBeNull()
    })
  })

  describe('and it has a wrong value', () => {
    it('should return null', () => {
      expect(parseTraceState('somethingWrong')).toBeNull()
    })
  })

  describe('and it has multiple values', () => {
    it('should return an object containing the key value pair described in the header', () => {
      expect(parseTraceState('aKey=aValue,anotherKey=anotherValue')).toEqual({
        aKey: 'aValue',
        anotherKey: 'anotherValue'
      })
    })
  })
})

describe('when parsing the trace parent header', () => {
  describe("and the header doesn't contain all of the properties", () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7')).toBeNull()
    })
  })

  describe('and the header has a version with a wrong size', () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('0-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
    })
  })

  describe('and the header has a trace id with a wrong size', () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('00-4bf92f3577b34da6a3ce929d0e0e-00f067aa0ba902b7-01')).toBeNull()
    })
  })

  describe('and the header has a parent id with a wrong size', () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba90-01')).toBeNull()
    })
  })

  describe('and the header has an invalid trace id', () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull()
    })
  })

  describe('and the header has an invalid parent id', () => {
    it('should return null', () => {
      expect(parseTraceParentHeader('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull()
    })
  })

  describe('and the header is well formatted', () => {
    it('should return a trace object', () => {
      expect(parseTraceParentHeader('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({
        version: 0,
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentId: '00f067aa0ba902b7',
        traceFlags: 1
      })
    })
  })
})
