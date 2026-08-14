import { contextFromRequest, getRequestFromNodeMessage } from '../src/logic'
import { getRemoteAddress, normalizeRemoteAddress, setRemoteAddress } from '../src/remote-address'
import { createBodySizeLimitMiddleware } from '../src/body-size-limiter'
import { createTestServerComponent } from '../src/test-component'

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

  describe('and the mapped prefix is uppercase', () => {
    it('should still unwrap it, since the prefix comparison is case-insensitive', () => {
      expect(normalizeRemoteAddress('::FFFF:203.0.113.7')).toBe('203.0.113.7')
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

  let request: ReturnType<typeof getRequestFromNodeMessage>

  beforeEach(() => {
    request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
  })

  it('should capture the peer address in normalized form', () => {
    expect(getRemoteAddress(request)).toBe('10.0.0.1')
  })

  it('should surface it on the middleware context', () => {
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
    expect(contextFromRequest({}, getRequestFromNodeMessage(nodeMessage, '0.0.0.0')).remoteAddress).toBeUndefined()
  })
})

describe('when a Node message reports a non-string socket address', () => {
  let nodeMessage: any

  beforeEach(() => {
    // `getRequestFromNodeMessage` is public and adapters pass hand-rolled message objects, so a
    // socket carrying something other than a string must not reach the normalizer and throw.
    nodeMessage = { method: 'GET', url: '/resource', headers: {}, socket: { remoteAddress: 12345 } }
  })

  it('should not throw', () => {
    expect(() => getRequestFromNodeMessage(nodeMessage, '0.0.0.0')).not.toThrow()
  })

  it('should report no address rather than a coerced one', () => {
    expect(getRemoteAddress(getRequestFromNodeMessage(nodeMessage, '0.0.0.0'))).toBeUndefined()
  })
})

describe('when a base context already carries a remote address', () => {
  let baseContext: { remoteAddress: string; other: string }
  let request: ReturnType<typeof getRequestFromNodeMessage>

  beforeEach(() => {
    baseContext = { remoteAddress: '198.51.100.9', other: 'kept' }
    // No socket, so the request has no address of its own.
    request = getRequestFromNodeMessage({ method: 'GET', url: '/r', headers: {} } as any, '0.0.0.0')
  })

  it('should not shadow it with undefined', () => {
    expect(contextFromRequest(baseContext, request).remoteAddress).toBe('198.51.100.9')
  })

  it('should leave the rest of the base context reachable', () => {
    expect(contextFromRequest(baseContext, request).other).toBe('kept')
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

describe('when a test server is given a peer address', () => {
  let server: ReturnType<typeof createTestServerComponent>
  let seen: string | undefined

  beforeEach(async () => {
    seen = undefined
    server = createTestServerComponent({ remoteAddress: '::ffff:203.0.113.7' })
    server.use(async ctx => {
      seen = ctx.remoteAddress
      return { status: 200 }
    })
    await server.fetch('/resource')
  })

  it('should report it on the context, normalized', () => {
    expect(seen).toBe('203.0.113.7')
  })
})

describe('when a test server request carries its own peer address', () => {
  let server: ReturnType<typeof createTestServerComponent>
  let seen: string | undefined
  let request: Request

  beforeEach(async () => {
    seen = undefined
    server = createTestServerComponent({ remoteAddress: '10.0.0.1' })
    server.use(async ctx => {
      seen = ctx.remoteAddress
      return { status: 200 }
    })
    request = new Request('http://remote-address.test/resource')
    setRemoteAddress(request, '198.51.100.5')
    await server.fetch(request)
  })

  it('should let the per-request address win over the server-wide option', () => {
    expect(seen).toBe('198.51.100.5')
  })
})

describe('when a test server is given no peer address', () => {
  let server: ReturnType<typeof createTestServerComponent>
  let seen: string | undefined
  let sawKey: boolean

  beforeEach(async () => {
    seen = undefined
    sawKey = true
    server = createTestServerComponent()
    server.use(async ctx => {
      seen = ctx.remoteAddress
      sawKey = 'remoteAddress' in ctx
      return { status: 200 }
    })
    await server.fetch('/resource')
  })

  it('should report no address', () => {
    expect(seen).toBeUndefined()
  })

  it('should not leave an own undefined key on the context', () => {
    expect(sawKey).toBe(false)
  })
})
