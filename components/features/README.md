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
import { createFeaturesComponent } from '@dcl/features-component'

const features = await createFeaturesComponent({ config, fetch, logs }, 'https://my-app.decentraland.org')

const isEnabled = await features.getIsFeatureEnabled('explorer', 'some-feature')
const variant = await features.getFeatureVariant('explorer', 'some-feature')
```

## How it works

`getIsFeatureEnabled` first looks for an environment variable named
`FF_<APP>_<FEATURE>` (uppercased). If it is not defined, it fetches the flags
for the application from the feature-flags service (`FF_URL`, defaulting to
`https://feature-flags.decentraland.org`) and reads the `<app>-<feature>` key.

## License

Apache-2.0
