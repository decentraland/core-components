# @dcl/test-helpers

Jest test helpers for component-based programs built with
`@well-known-components`. Provides a lifecycle-aware test runner and a local
fetch component for integration tests.

Migrated from `@well-known-components/test-helpers` and adapted to the
core-components standards: **Jest only** (no `sinon`) and the native global
`fetch` (no `node-fetch`).

## Installation

```bash
npm install --save-dev @dcl/test-helpers
```

`jest` and `@types/jest` are peer dependencies — the consumer provides them.

## `createRunner`

Wraps `Lifecycle.run` so a suite gets the program's components wired into Jest's
`beforeAll`/`afterAll`, with per-test isolation:

```typescript
import { createRunner } from '@dcl/test-helpers'

const test = createRunner<Components>({
  async main({ startComponents }) {
    await startComponents()
  },
  async initComponents() {
    return { /* ... */ }
  }
})

test('my suite', ({ components, stubComponents, spyComponents, beforeStart }) => {
  it('uses the real components', () => {
    expect(components.myComponent.doThing()).toEqual('real')
  })

  it('stubs a dependency', () => {
    // stubComponents replace methods with no-op jest mocks (no call-through)
    stubComponents.myComponent.doThing.mockReturnValue('stubbed')
    expect(components.myComponent.doThing()).toEqual('stubbed')
  })

  it('spies on a dependency', () => {
    // spyComponents call through to the real implementation by default
    const { doThing } = spyComponents.myComponent
    components.myComponent.doThing()
    expect(doThing).toHaveBeenCalled()
  })
})
```

- `components` — the real components, as wired by the program.
- `stubComponents` — each method replaced by a `jest.SpyInstance` that does **not**
  call through (returns `undefined` until configured). Configure with
  `mockReturnValue`, `mockImplementation`, etc.
- `spyComponents` — each method wrapped by a `jest.SpyInstance` that **does** call
  through by default.
- `beforeStart(fn)` — register a function to run before the lifecycle starts
  (e.g. to set environment variables read at startup).

Each `test(name, suite)` call creates its own `describe` with a freshly
initialized program; stubs and spies are reset between test cases.

### Migrating from sinon

`stubComponents` now exposes Jest mocks instead of sinon stubs:

| sinon                                        | jest                                          |
| -------------------------------------------- | --------------------------------------------- |
| `stub.method.returns(v)`                     | `stub.method.mockReturnValue(v)`              |
| `stub.method.withArgs(a).returns(v)`         | `stub.method.mockImplementation(...)`         |
| `stub.method.throwsException(e)`             | `stub.method.mockImplementation(() => { throw e })` |
| `stub.method.calledOnce`                     | `expect(stub.method).toHaveBeenCalledTimes(1)` |
| `stub.method.restore()`                      | `stub.method.mockRestore()`                   |

## `createLocalFetchComponent`

Creates a fetch component that only resolves local testing URLs (paths starting
with `/`), targeting the host/port resolved from the config and backed by the
native global `fetch`. Requests can be optionally authenticated (see below).

```typescript
import { createLocalFetchComponent, defaultServerConfig } from '@dcl/test-helpers'

const config = /* IConfigComponent exposing HTTP_SERVER_HOST / HTTP_SERVER_PORT */
const localFetch = await createLocalFetchComponent(config)

const response = await localFetch.fetch('/some-route')
```

`defaultServerConfig()` returns `{ HTTP_SERVER_HOST, HTTP_SERVER_PORT }` with an
auto-incrementing port seeded by the Jest worker id to avoid collisions across
parallel workers.

### Authenticated requests

Pass an `identity` in the request options to send a signed request following the
signed-fetch pattern (ADR-44); omit it for a plain request. The payload
`method:path:timestamp:metadata` is signed with the identity's ephemeral key and
attached as the `x-identity-auth-chain-*`, `x-identity-timestamp` and
`x-identity-metadata` headers. Caller-provided headers are preserved.

```typescript
import { createLocalFetchComponent, getIdentity } from '@dcl/test-helpers'

const identity = await getIdentity()
const localFetch = await createLocalFetchComponent(config)

// signed request
await localFetch.fetch('/protected', { identity, metadata: { intent: 'dcl:test' } })

// plain request (no signing)
await localFetch.fetch('/public')
```

- `getIdentity(ephemeralKeyTTLInMinutes?)` — creates an unsafe, test-only identity
  (an ephemeral key authorized by a freshly generated account).
- `getAuthHeaders(method, path, metadata, chainProvider)` /
  `getSignedAuthHeaders(method, path, metadata, identity)` — build the signed-fetch
  headers directly, if you need them outside of the local fetch component.

## License

Apache-2.0
