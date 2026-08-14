import { IHttpServerComponent } from '@dcl/core-commons'
import { InvalidRateLimitConfigurationError } from '../src/errors'
import {
  assertPositiveInteger,
  buildCounterKey,
  canonicalizeIpAddress,
  clientIpFromForwardedHeader,
  currentWindow,
  encodeIdentity,
  MAX_RAW_IDENTITY_LENGTH,
  shouldSkip
} from '../src/logic'
import { RateLimitSkipper } from '../src/types'

function createContext(pathname: string): IHttpServerComponent.DefaultContext<object> {
  return {
    request: new Request(`http://rate-limiter.test${pathname}`),
    url: new URL(`http://rate-limiter.test${pathname}`)
  }
}

describe('when canonicalizing an IP address', () => {
  describe('and it is a plain IPv4 address', () => {
    it('should return it unchanged', () => {
      expect(canonicalizeIpAddress('203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is an IPv4 address carrying a port', () => {
    it('should strip the port', () => {
      expect(canonicalizeIpAddress('203.0.113.7:53124')).toBe('203.0.113.7')
    })
  })

  describe('and it is an uppercase, non-compressed IPv6 address', () => {
    it('should return the lowercase compressed form', () => {
      expect(canonicalizeIpAddress('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    })
  })

  describe('and it is an IPv4-mapped IPv6 address', () => {
    it('should return the dotted quad so one client maps to one bucket', () => {
      expect(canonicalizeIpAddress('::ffff:203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is a bracketed IPv6 address carrying a port', () => {
    it('should return the canonical address without the brackets or the port', () => {
      expect(canonicalizeIpAddress('[2001:db8::1]:443')).toBe('2001:db8::1')
    })
  })

  describe('and it is an IPv4 address with leading zeros', () => {
    it('should reject it rather than treat two spellings as two clients', () => {
      expect(canonicalizeIpAddress('203.0.113.010')).toBeNull()
    })
  })

  describe('and it is not an address at all', () => {
    it('should return null so a caller cannot mint arbitrary buckets', () => {
      expect(canonicalizeIpAddress('not-an-address')).toBeNull()
    })
  })

  describe('and it is empty or undefined', () => {
    it('should return null', () => {
      expect(canonicalizeIpAddress('')).toBeNull()
      expect(canonicalizeIpAddress(undefined)).toBeNull()
    })
  })
})

describe('when extracting the client IP from a forwarded header', () => {
  describe('and the header is absent', () => {
    it('should return null', () => {
      expect(clientIpFromForwardedHeader(null, 1)).toBeNull()
    })
  })

  describe('and it holds a single address with one trusted proxy', () => {
    it('should return that address', () => {
      expect(clientIpFromForwardedHeader('203.0.113.7', 1)).toBe('203.0.113.7')
    })
  })

  describe('and a client-spoofed entry precedes the proxy-appended one', () => {
    it('should return the proxy-appended entry rather than the client-supplied one', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, 203.0.113.7', 1)).toBe('203.0.113.7')
    })
  })

  describe('and two proxies are trusted', () => {
    it('should return the entry two positions from the right', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, 203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7')
    })
  })

  describe('and it holds fewer entries than the trusted proxy chain would produce', () => {
    it('should return null because the header did not come through that chain', () => {
      expect(clientIpFromForwardedHeader('203.0.113.7', 2)).toBeNull()
    })
  })

  describe('and the selected entry is not an address', () => {
    it('should return null', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, garbage', 1)).toBeNull()
    })
  })

  describe('and it contains empty entries and padding', () => {
    it('should ignore them and still select the right entry', () => {
      expect(clientIpFromForwardedHeader(' 1.1.1.1 ,, 203.0.113.7 ', 1)).toBe('203.0.113.7')
    })
  })
})

describe('when computing the current window', () => {
  describe('and now sits exactly on a boundary', () => {
    it('should start the window there and reset one window later', () => {
      expect(currentWindow(60_000, 60_000)).toEqual({ windowId: 1, resetAt: 120_000 })
    })
  })

  describe('and now sits mid-window', () => {
    it('should reset at the next boundary', () => {
      expect(currentWindow(90_000, 60_000)).toEqual({ windowId: 1, resetAt: 120_000 })
    })
  })
})

describe('when building a counter key', () => {
  it('should join the segments in namespace order', () => {
    expect(buildCounterKey('svc:rl', 'login', 12345, '203.0.113.7')).toBe('svc:rl:login:12345:203.0.113.7')
  })
})

describe('when encoding an identity', () => {
  describe('and hashing is off and the identity is short', () => {
    it('should return it unchanged', () => {
      expect(encodeIdentity('203.0.113.7', false)).toBe('203.0.113.7')
    })
  })

  describe('and hashing is on', () => {
    it('should return 32 lowercase hex characters', () => {
      expect(encodeIdentity('203.0.113.7', true)).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('and the identity exceeds the raw cap with hashing off', () => {
    it('should hash it anyway so an oversized value cannot become an oversized key', () => {
      expect(encodeIdentity('a'.repeat(MAX_RAW_IDENTITY_LENGTH + 1), false)).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('and two different identities are hashed', () => {
    it('should produce different digests', () => {
      expect(encodeIdentity('one', true)).not.toBe(encodeIdentity('two', true))
    })
  })
})

describe('when deciding whether to skip a request', () => {
  describe('and the skipper is a string', () => {
    it('should skip only the matching pathname', () => {
      expect(shouldSkip(createContext('/health/live'), '/health/live')).toBe(true)
      expect(shouldSkip(createContext('/v1/notes'), '/health/live')).toBe(false)
    })
  })

  describe('and the skipper is an array of strings', () => {
    it('should skip any matching pathname', () => {
      const skipper: RateLimitSkipper = ['/health/live', '/health/ready']
      expect(shouldSkip(createContext('/health/ready'), skipper)).toBe(true)
      expect(shouldSkip(createContext('/v1/notes'), skipper)).toBe(false)
    })
  })

  describe('and the skipper is a function', () => {
    it('should defer to it', () => {
      const skipper = jest.fn().mockReturnValue(true)
      expect(shouldSkip(createContext('/v1/notes'), skipper)).toBe(true)
      expect(skipper).toHaveBeenCalled()
    })
  })

  describe('and the skipper is a regular expression', () => {
    it('should test it against the pathname', () => {
      expect(shouldSkip(createContext('/health/live'), /^\/health\//)).toBe(true)
      expect(shouldSkip(createContext('/v1/notes'), /^\/health\//)).toBe(false)
    })
  })

  describe('and the regular expression carries the global flag', () => {
    it('should match consistently across repeated calls instead of alternating on lastIndex', () => {
      const skipper = /^\/health\//g
      expect(shouldSkip(createContext('/health/live'), skipper)).toBe(true)
      expect(shouldSkip(createContext('/health/live'), skipper)).toBe(true)
    })
  })
})

describe('when asserting a positive integer', () => {
  describe.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a fractional number', 1.5],
    ['NaN', NaN],
    ['a non-number', 'ten']
  ])('and the value is %s', (_label, value) => {
    it('should throw an invalid configuration error naming the setting', () => {
      expect(() => assertPositiveInteger('max', value)).toThrow(InvalidRateLimitConfigurationError)
      expect(() => assertPositiveInteger('max', value)).toThrow('max')
    })
  })

  describe('and the value is a positive integer', () => {
    it('should not throw', () => {
      expect(() => assertPositiveInteger('max', 1)).not.toThrow()
    })
  })
})
