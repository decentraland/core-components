import { isIPv4 } from 'net'
import type { IHttpServerComponent } from '@dcl/core-commons'

// Carries the peer address captured from the Node socket over to `contextFromRequest`, which is the
// only place that can put it on the middleware context. Weakly keyed, so the entry disappears
// together with its request — the same pattern `logic.ts` uses for `parsedUrlByRequest`.
const remoteAddressByRequest = new WeakMap<IHttpServerComponent.IRequest, string>()

// Node reports IPv4 peers as IPv4-mapped IPv6 (`::ffff:127.0.0.1`) when the listening socket is
// dual-stack, and as a plain `127.0.0.1` otherwise — the same client would otherwise produce two
// different values depending on how the server happens to be bound.
const IPV4_MAPPED_IPV6_PREFIX = '::ffff:'

/**
 * Normalizes a socket peer address into a stable form: an IPv4-mapped IPv6 address is reduced to its
 * IPv4 form, everything else is returned unchanged.
 *
 * A link-local `%zone` suffix is deliberately preserved — it only appears for link-local addresses,
 * which are not internet clients, and stripping it would merge distinct peers on different
 * interfaces into one value.
 *
 * @public
 */
export function normalizeRemoteAddress(address: string | undefined): string | undefined {
  // Guards JS callers too, not just the empty case: this is exported, so a non-string reaching
  // `toLowerCase` below would throw rather than simply report "no address".
  if (!address || typeof address !== 'string') return undefined

  if (address.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    const candidate = address.slice(IPV4_MAPPED_IPV6_PREFIX.length)
    // Only unwrap the dotted-quad form; `::ffff:0102:0304` is left alone rather than mangled.
    if (isIPv4(candidate)) return candidate
  }

  return address
}

/**
 * Associates a peer address with a request, so it surfaces as `context.remoteAddress` once the
 * request reaches the middleware chain.
 *
 * The server does this automatically for every incoming connection. Call it directly to give a
 * request built by hand — in a test, or in front of `createTestServerComponent` — a fake peer
 * address.
 *
 * Only effective **before** the request enters the middleware chain: the context copies the address
 * once, when it is built, so a later call updates what `getRemoteAddress` returns but not what
 * handlers see on `context.remoteAddress`. To override the address mid-chain (for example to trust a
 * forwarding header), assign `context.remoteAddress` directly instead.
 *
 * The address is stored as given apart from IPv4-mapped normalization — it is not validated, and an
 * empty value is ignored rather than clearing a previously stored one.
 *
 * @public
 */
export function setRemoteAddress(request: IHttpServerComponent.IRequest, remoteAddress: string): void {
  const normalized = normalizeRemoteAddress(remoteAddress)
  if (normalized) remoteAddressByRequest.set(request, normalized)
}

/**
 * Returns the peer address previously associated with a request, or `undefined` when there is none
 * (a request built directly rather than received over a socket, or a socket already torn down).
 *
 * Prefer reading `context.remoteAddress` from a middleware: that value survives middleware which
 * replace `context.request` — `createBodySizeLimitMiddleware` does exactly that — whereas this
 * lookup, being keyed on request identity, does not.
 *
 * @public
 */
export function getRemoteAddress(request: IHttpServerComponent.IRequest): string | undefined {
  return remoteAddressByRequest.get(request)
}
