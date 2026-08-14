import { assertIntegerCounter, assertValidIncrementOptions, isErrorWithMessage } from '../src/utils'
import { IncrementOptions } from '../src/types'

describe('when checking whether a value is an error with a message', () => {
  describe.each([
    ['an Error instance', new Error('boom')],
    ['a plain object carrying a message', { message: 'boom' }],
    ['an object whose message is not a string', { message: 42 }]
  ])('and the value is %s', (_label, value) => {
    it('should report it as an error with a message', () => {
      expect(isErrorWithMessage(value)).toBe(true)
    })
  })

  describe.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'boom'],
    ['a number', 42],
    ['an object without a message', { code: 'ENOENT' }]
  ])('and the value is %s', (_label, value) => {
    it('should not report it as an error with a message', () => {
      expect(isErrorWithMessage(value)).toBe(false)
    })
  })
})

describe('when validating increment options', () => {
  describe('and no options are given', () => {
    it('should default the amount to one and leave the TTL unset', () => {
      expect(assertValidIncrementOptions()).toEqual({ amount: 1, ttlInSeconds: undefined })
    })
  })

  describe('and an empty options object is given', () => {
    it('should default the amount to one', () => {
      expect(assertValidIncrementOptions({})).toEqual({ amount: 1, ttlInSeconds: undefined })
    })
  })

  describe('and a valid amount and TTL are given', () => {
    it('should return them unchanged', () => {
      expect(assertValidIncrementOptions({ amount: 5, ttlInSeconds: 60 })).toEqual({ amount: 5, ttlInSeconds: 60 })
    })
  })

  describe('and the amount is negative', () => {
    it('should accept it, since a counter may be decremented', () => {
      expect(assertValidIncrementOptions({ amount: -3 })).toEqual({ amount: -3, ttlInSeconds: undefined })
    })
  })

  describe('and the amount is zero', () => {
    it('should accept it', () => {
      expect(assertValidIncrementOptions({ amount: 0 })).toEqual({ amount: 0, ttlInSeconds: undefined })
    })
  })

  describe.each([
    ['fractional', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['null', null],
    ['a numeric string', '3'],
    ['a boolean', true]
  ])('and the amount is %s', (_label, amount) => {
    it('should reject it', () => {
      expect(() => assertValidIncrementOptions({ amount } as IncrementOptions)).toThrow(TypeError)
    })

    it('should name the offending option', () => {
      expect(() => assertValidIncrementOptions({ amount } as IncrementOptions)).toThrow('"amount"')
    })
  })

  describe('and the amount is a numeric string', () => {
    it('should quote it so the message is not self-contradictory', () => {
      // Without quoting this reads `got 3`, which looks like a valid integer was rejected.
      expect(() => assertValidIncrementOptions({ amount: '3' } as unknown as IncrementOptions)).toThrow('got "3"')
    })
  })

  describe.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['null', null],
    ['a numeric string', '60']
  ])('and the TTL is %s', (_label, ttlInSeconds) => {
    it('should reject it', () => {
      expect(() => assertValidIncrementOptions({ ttlInSeconds } as IncrementOptions)).toThrow(TypeError)
    })

    it('should name the offending option', () => {
      expect(() => assertValidIncrementOptions({ ttlInSeconds } as IncrementOptions)).toThrow('"ttlInSeconds"')
    })
  })

  describe('and the TTL is fractional', () => {
    it('should accept it, since sub-second windows are legitimate', () => {
      expect(assertValidIncrementOptions({ ttlInSeconds: 0.5 })).toEqual({ amount: 1, ttlInSeconds: 0.5 })
    })
  })
})

describe('when asserting that a stored value is an integer counter', () => {
  describe.each([
    ['a positive integer', 5],
    ['zero', 0],
    ['a negative integer', -5]
  ])('and the value is %s', (_label, value) => {
    it('should not throw', () => {
      expect(() => assertIntegerCounter(value)).not.toThrow()
    })
  })

  describe.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['fractional', 1.5],
    ['a numeric string', '5'],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['an object', { not: 'a counter' }]
  ])('and the value is %s', (_label, value) => {
    it('should throw', () => {
      expect(() => assertIntegerCounter(value)).toThrow(TypeError)
    })
  })

  describe('and the value is NaN', () => {
    it('should reject it even though it is typed as a number', () => {
      // `typeof NaN === 'number'` and `NaN + 1` is `NaN`, so a counter poisoned with it would never
      // cross a threshold again — a limiter over that key would fail open silently and forever.
      expect(() => assertIntegerCounter(NaN)).toThrow('got NaN')
    })
  })

  describe('and the value is rejected', () => {
    it('should not include a key in the message, since callers pass keys holding personal data', () => {
      expect(() => assertIntegerCounter({ some: 'object' })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('key') })
      )
    })
  })
})
