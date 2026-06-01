# @dcl/features-component

Feature flags component for core components library. It resolves feature flags
for a given application, first from environment variables and then from the
Decentraland feature-flags service.

## Installation

```bash
npm install @dcl/features-component
```

## Usage

```typescript
import { createFeaturesComponent, ApplicationName } from '@dcl/features-component'

const features = await createFeaturesComponent({ config, fetch, logs }, 'https://my-app.decentraland.org', {
  // Applications preloaded on start and continuously refreshed in the background
  apps: [ApplicationName.DAPPS, ApplicationName.EXPLORER]
})

const isEnabled = await features.getIsFeatureEnabled('explorer', 'some-feature')
const variant = await features.getFeatureVariant('explorer', 'some-feature')
```

The component implements the well-known-components lifecycle. Register it with
your program so `startComponents()` preloads the registered apps and starts the
background refresh, and `stopComponents()` cancels it.

## How it works

`getIsFeatureEnabled` first looks for an environment variable named
`FF_<APP>_<FEATURE>` (uppercased). If it is not defined, it reads the flags for
the application and returns the `<app>-<feature>` key. `getFeatureVariant`
returns the variant for that key.

Flags are fetched from the feature-flags service (`FF_URL`, defaulting to
`https://feature-flags.decentraland.org`) with these guarantees:

- **Bounded requests** — every request uses a timeout (`FF_REQUEST_TIMEOUT`).
- **Continuous refresh** — applications passed in `options.apps` are preloaded
  on `START_COMPONENT` and refreshed every `FF_REFRESH_INTERVAL`; their reads
  are served from the in-memory cache. If a refresh fails, the last known value
  keeps being served. Applications that are not registered are fetched on every
  call.
- **In-flight de-duplication** — if a request for an application is already in
  flight, concurrent reads wait for it instead of starting another.

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `FF_URL` | `https://feature-flags.decentraland.org` | Feature-flags service base URL |
| `FF_REQUEST_TIMEOUT` | `10000` | Per-request timeout in milliseconds |
| `FF_REFRESH_INTERVAL` | `240000` | Background refresh interval (ms) for registered apps |
| `FF_<APP>_<FEATURE>` | — | Per-flag override (`"1"` enables); short-circuits the service |

Invalid `FF_REQUEST_TIMEOUT` / `FF_REFRESH_INTERVAL` values log a warning and
fall back to the defaults.

## License

Apache-2.0
