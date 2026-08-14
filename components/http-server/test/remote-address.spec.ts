import { contextFromRequest, getRequestFromNodeMessage } from '../src/logic'
import { getRemoteAddress, normalizeRemoteAddress, setRemoteAddress } from '../src/remote-address'
import { createBodySizeLimitMiddleware } from '../src/body-size-limiter'

describe('when normalizing a remote address', () => {
  describe('and it is an IPv4-mapped IPv6 address', () => {
    it('should return the IPv4 form so a dual-stack listener keys the same client as an IPv4-only one', () => {
      expect(normalizeRemoteAddress('::ffff:203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is a plain IPv4 address', () => {
    it('should return it unchanged', () => {
      expect(normalizeRemoteAddress('203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is an IPv6 address', () => {
    it('should return it unchanged', () => {
      expect(normalizeRemoteAddress('2001:db8::1')).toBe('2001:db8::1')
    })
  })

  describe('and it is a mapped address whose remainder is not a dotted quad', () => {
    it('should leave it alone rather than mangle it', () => {
      expect(normalizeRemoteAddress('::ffff:0102:0304')).toBe('::ffff:0102:0304')
    })
  })

  describe('and it carries a link-local zone identifier', () => {
    it('should preserve the zone so peers on different interfaces stay distinct', () => {
      expect(normalizeRemoteAddress('fe80::1%eth0')).toBe('fe80::1%eth0')
    })
  })

  describe('and it is empty or undefined', () => {
    it('should return undefined', () => {
      expect(normalizeRemoteAddress('')).toBeUndefined()
      expect(normalizeRemoteAddress(undefined)).toBeUndefined()
    })
  })
})

describe('when building a request from a Node message carrying a socket', () => {
  let nodeMessage: any

  beforeEach(() => {
    nodeMessage = {
      method: 'GET',
      url: '/resource',
      headers: {},
      socket: { remoteAddress: '::ffff:10.0.0.1' }
    }
  })

  it('should capture the peer address in normalized form', () => {
    const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
    expect(getRemoteAddress(request)).toBe('10.0.0.1')
  })

  it('should surface it on the middleware context', () => {
    const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
    expect(contextFromRequest({}, request).remoteAddress).toBe('10.0.0.1')
  })
})

describe('when building a request from a Node message with no socket', () => {
  let nodeMessage: any

  beforeEach(() => {
    nodeMessage = { method: 'GET', url: '/resource', headers: {} }
  })

  it('should not throw', () => {
    expect(() => getRequestFromNodeMessage(nodeMessage, '0.0.0.0')).not.toThrow()
  })

  it('should leave the context address undefined rather than inventing a placeholder', () => {
    const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
    expect(contextFromRequest({}, request).remoteAddress).toBeUndefined()
  })
})

describe('when a middleware downstream of the body size limiter reads the peer address', () => {
  let seenRemoteAddress: string | undefined
  let context: any

  beforeEach(async () => {
    seenRemoteAddress = undefined
    const request = new Request('http://remote-address.test/resource', {
      method: 'POST',
      body: 'payload',
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })
    setRemoteAddress(request, '203.0.113.7')
    context = contextFromRequest({}, request)

    // The body size limiter replaces `context.request` wholesale, which is exactly what a
    // request-keyed lookup would not survive — the reason the address lives on the context.
    await createBodySizeLimitMiddleware(1024)(context, async () => {
      seenRemoteAddress = context.remoteAddress
      return { status: 200 }
    })
  })

  it('should still see the address after the request object was replaced', () => {
    expect(seenRemoteAddress).toBe('203.0.113.7')
  })

  it('should confirm the request object really was replaced', () => {
    expect(getRemoteAddress(context.request)).toBeUndefined()
  })
})
