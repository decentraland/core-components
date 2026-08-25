import { AUTH_CHAIN_HEADER_PREFIX, AUTH_METADATA_HEADER, AUTH_TIMESTAMP_HEADER } from '@dcl/crypto'
import { getAuthHeaders, getIdentity } from '../src'
import type { Identity } from '../src'

/**
 * Pins the payload format `getAuthHeaders` signs.
 *
 * @dcl/crypto-middleware 6 reconstructs `method:path:timestamp:metadata` with the metadata bytes
 * exactly as `x-identity-metadata` delivers them. This helper used to lowercase the whole joined
 * string, which is the pre-6.0.0 format: it folded the metadata after building it.
 *
 * For all-lowercase metadata the two are byte-identical, which is why every existing suite passed
 * and nobody noticed. The cost showed up only for metadata carrying uppercase, where the helper
 * signed one thing and delivered another -- so a service test could not exercise the current format
 * at all, and a request that should have been refused by a metadata gate was refused by signature
 * verification instead, for the wrong reason.
 */
describe('when building signed-fetch headers', () => {
  let identity: Identity

  beforeEach(async () => {
    identity = await getIdentity()
  })

  /** The payload the signature covers is the last auth-chain link's `payload`. */
  function signedPayloadFor(method: string, path: string, metadata: Record<string, unknown>): string {
    let signed = ''
    const headers = getAuthHeaders(method, path, metadata, (payload) => {
      signed = payload
      return []
    })
    // The helper still emits the timestamp and metadata headers it signed against.
    expect(headers[AUTH_TIMESTAMP_HEADER]).toBeDefined()
    return signed
  }

  describe('and the metadata carries uppercase', () => {
    const metadata = { signer: 'dcl:explorer', realmName: 'MyRealm' }

    it('should sign the metadata bytes exactly as the header delivers them', () => {
      const payload = signedPayloadFor('GET', '/protected', metadata)

      expect(payload.endsWith(JSON.stringify(metadata))).toBe(true)
    })

    it('should deliver the same metadata bytes it signed', () => {
      let signed = ''
      const headers = getAuthHeaders('GET', '/protected', metadata, (payload) => {
        signed = payload
        return []
      })

      // The mismatch this fixes: the signed copy was folded while the delivered copy was not.
      expect(signed.endsWith(headers[AUTH_METADATA_HEADER])).toBe(true)
    })
  })

  describe('and the metadata differs only by the casing of a key', () => {
    it('should produce different payloads, so a re-spelled key is not signable as the canonical one', () => {
      // What the fold made impossible to express: `{"Signer":…}` folded to `{"signer":…}`, so a test
      // could not sign the spelling it wanted to deliver.
      const canonical = signedPayloadFor('GET', '/protected', { signer: 'decentraland-kernel-scene' })
      const respelled = signedPayloadFor('GET', '/protected', { Signer: 'decentraland-kernel-scene' })

      expect(canonical.split(':').slice(3).join(':')).not.toEqual(respelled.split(':').slice(3).join(':'))
    })
  })

  describe('and the method and path carry uppercase', () => {
    it('should still lowercase both, which the signed payload does bind that way', () => {
      const payload = signedPayloadFor('POST', '/Protected/Path', {})

      expect(payload.startsWith('post:/protected/path:')).toBe(true)
    })
  })

  describe('and the metadata is all lowercase', () => {
    it('should be unchanged by this fix, which is why existing suites keep passing', () => {
      const metadata = { signer: 'dcl:explorer' }
      const payload = signedPayloadFor('GET', '/protected', metadata)

      expect(payload).toEqual(payload.toLowerCase())
      expect(payload.endsWith(JSON.stringify(metadata))).toBe(true)
    })
  })

  describe('and an auth chain is produced', () => {
    it('should emit one header per link', () => {
      const headers = getAuthHeaders('GET', '/protected', {}, (payload) => [
        { type: 'SIGNER', payload, signature: '' } as never
      ])

      expect(headers[`${AUTH_CHAIN_HEADER_PREFIX}0`]).toBeDefined()
    })
  })
})
