import { Authenticator } from '@dcl/crypto'
import type { AuthIdentity, AuthLink, IdentityType } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import {
  AUTH_CHAIN_HEADER_PREFIX,
  AUTH_METADATA_HEADER,
  AUTH_TIMESTAMP_HEADER
} from '@dcl/crypto-middleware'

/**
 * A test identity: an ephemeral key, the real account that authorized it, and
 * the auth chain linking them. Produced by {@link getIdentity}.
 * @public
 */
export type Identity = {
  authChain: AuthIdentity
  realAccount: IdentityType
  ephemeralIdentity: IdentityType
}

/**
 * Creates an unsafe (test-only) identity with an ephemeral key authorized by a
 * freshly generated account, valid for `ephemeralKeyTTLInMinutes`.
 * @public
 */
export async function getIdentity(ephemeralKeyTTLInMinutes = 10): Promise<Identity> {
  const ephemeralIdentity = createUnsafeIdentity()
  const realAccount = createUnsafeIdentity()

  const authChain = await Authenticator.initializeAuthChain(
    realAccount.address,
    ephemeralIdentity,
    ephemeralKeyTTLInMinutes,
    async (message) => Authenticator.createSignature(realAccount, message)
  )

  return { authChain, realAccount, ephemeralIdentity }
}

/**
 * Builds the signed-fetch headers (ADR-44) for a request. The payload
 * `method:path:timestamp:metadata` is signed by `chainProvider`, and the
 * resulting auth chain, timestamp and metadata are returned as headers.
 * @public
 */
export function getAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, any>,
  chainProvider: (payload: string) => AuthLink[]
): Record<string, string> {
  const headers: Record<string, string> = {}
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payloadParts = [method.toLowerCase(), path.toLowerCase(), timestamp.toString(), metadataJSON]
  const payloadToSign = payloadParts.join(':').toLowerCase()

  const chain = chainProvider(payloadToSign)

  chain.forEach((link, index) => {
    headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
  })

  headers[AUTH_TIMESTAMP_HEADER] = timestamp.toString()
  headers[AUTH_METADATA_HEADER] = metadataJSON

  return headers
}

/**
 * Builds the signed-fetch headers for a request signed with the given identity's
 * ephemeral key (ADR-44).
 * @public
 */
export function getSignedAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, any>,
  identity: Identity
): Record<string, string> {
  return getAuthHeaders(method, path, metadata, (payload) =>
    Authenticator.signPayload(
      {
        ephemeralIdentity: identity.ephemeralIdentity,
        expiration: new Date(),
        authChain: identity.authChain.authChain
      },
      payload
    )
  )
}
