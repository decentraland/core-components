import { isIP } from 'net'
import { createHash } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { InvalidRateLimitConfigurationError } from './errors'
import type { RateLimitSkipper } from './types'

/** Identities longer than this are hashed, so an oversized value can't become an oversized key. */
export const MAX_RAW_IDENTITY_LENGTH = 128

/** `::ffff:cb00:710a`, the canonical serialization of an IPv4-mapped address. */
const IPV4_MAPPED_IPV6 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/

export function assertPositiveInteger(setting: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidRateLimitConfigurationError(setting, value)
  }
}

// Strips the `host:port` / `[host]:port` spellings some proxies emit (Azure Application Gateway
// among them). Without this, such a deployment fails every address parse and silently collapses
// into the shared fallback bucket — a very quiet way to lose per-client limiting.
function stripPort(value: string): string {
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value)
  if (bracketed) return bracketed[1]
  // Only strip a port from something unambiguously IPv4:port; a bare IPv6 address is full of
  // colons and must be left alone.
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value)
  return ipv4WithPort ? ipv4WithPort[1] : value
}

/**
 * Collapses every spelling of one address into a single form, so one client is one bucket.
 * Zero-compression, leading zeros and case make a single IPv6 address writable many ways, and an
 * IPv4 client can be reported either as a dotted quad or in IPv4-mapped form.
 *
 * @returns The canonical address, or `null` when the value is not an IP address.
 */
export function canonicalizeIpAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = stripPort(value.trim())
  const version = isIP(candidate)
  // Anything that is not an address would let a caller mint unlimited buckets.
  if (version === 0) return null
  // IPv4 needs no canonical step: `isIP` already rejects the alternative spellings, e.g. the
  // leading zeros in 203.0.113.010.
  if (version === 4) return candidate

  let canonical: string
  try {
    // The URL host of an IPv6 literal is bracketed and canonically serialized.
    canonical = new URL(`http://[${candidate}]`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return null
  }

  const mapped = IPV4_MAPPED_IPV6.exec(canonical)
  if (!mapped) return canonical

  const high = parseInt(mapped[1], 16)
  const low = parseInt(mapped[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/**
 * Picks the client address out of a forwarded header.
 *
 * Every proxy **appends** the address it saw, so the rightmost entries were written by our own
 * infrastructure and the leftmost is whatever the client chose to send. Reading the leftmost — the
 * common shortcut — hands a caller two primitives at once: an unlimited allowance (rotate the value,
 * get a fresh bucket every request) and a targeted denial of service (claim a victim's address and
 * spend their budget). So we count in from the right instead.
 *
 * @param value - The raw header value. `Headers.get` joins repeated header lines with commas, so
 *   one split handles both spellings.
 * @param trustedProxyCount - Number of proxies in front of this service that append to the header.
 * @returns The canonical address, or `null` when the header is absent, holds fewer entries than the
 *   trusted chain would produce (so it did not come through that chain), or the selected entry is
 *   not an address.
 */
export function clientIpFromForwardedHeader(value: string | null, trustedProxyCount: number): string | null {
  if (!value) return null

  const hops = value
    .split(',')
    .map(hop => hop.trim())
    .filter(hop => hop.length > 0)

  const index = hops.length - trustedProxyCount
  if (index < 0) return null

  return canonicalizeIpAddress(hops[index])
}

/** Deterministic, epoch-aligned window boundaries. See the README note on the 2x boundary burst. */
export function currentWindow(now: number, windowMs: number): { windowId: number; resetAt: number } {
  const windowId = Math.floor(now / windowMs)
  return { windowId, resetAt: (windowId + 1) * windowMs }
}

/**
 * Namespaces a counter. `windowId` sits ahead of the identity so one window's counters share a
 * prefix and can be enumerated or dropped with a single `SCAN MATCH prefix:bucket:12345:*`.
 */
export function buildCounterKey(keyPrefix: string, bucket: string, windowId: number, identity: string): string {
  return `${keyPrefix}:${bucket}:${windowId}:${identity}`
}

/**
 * Encodes the identity for storage. The digest is lowercase hex, which is also the only encoding
 * that survives `@dcl/redis-component` lowercasing every key. 32 hex characters is 128 bits, so
 * collisions are not a practical concern — and a collision only merges two buckets.
 */
export function encodeIdentity(identity: string, hashKeys: boolean): string {
  if (!hashKeys && identity.length <= MAX_RAW_IDENTITY_LENGTH) return identity
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/**
 * Mirrors `shouldSkip` from `@dcl/http-requests-logger-component`. Duplicated rather than imported:
 * a rate limiter must not depend on a logging package.
 */
export function shouldSkip(
  context: IHttpServerComponent.DefaultContext<object>,
  skipper: RateLimitSkipper
): boolean {
  if (typeof skipper === 'string') return skipper === context.url.pathname
  if (Array.isArray(skipper)) return skipper.some(path => path === context.url.pathname)
  if (typeof skipper === 'function') return skipper(context.request)
  // Strip the global/sticky flags: the same regex is reused across requests, and `.test()` on a
  // global/sticky regex advances `lastIndex`, which would make matches alternate per call.
  const statelessRegExp =
    skipper.global || skipper.sticky ? new RegExp(skipper.source, skipper.flags.replace(/[gy]/g, '')) : skipper
  return statelessRegExp.test(context.url.pathname)
}
