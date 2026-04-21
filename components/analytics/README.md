# Analytics Component (`@dcl/analytics-component`)

A component for sending analytics events to an external API.

## Features

- Send analytics events with environment and service context
- Error handling and logging
- Configurable request timeout
- Fire-and-forget or awaited delivery modes

## Configuration

The component reads the following environment variables via the config component:

| Variable | Required | Description |
| --- | --- | --- |
| `ANALYTICS_API_URL` | yes | Endpoint that receives the POSTed events. |
| `ANALYTICS_API_TOKEN` | yes | Token sent in the `x-token` header. |
| `ANALYTICS_CONTEXT` | yes | Context value included with every event (e.g. service name). |
| `ENV` | yes | Environment name injected into each event body. |
| `ANALYTICS_REQUEST_TIMEOUT` | no | Request timeout in ms. Defaults to `10000`. |

## Usage

```typescript
import { createAnalyticsComponent } from '@dcl/analytics-component'

type Events = {
  user_login: { userId: string; timestamp: number }
}

const analytics = await createAnalyticsComponent<Events>({
  fetcher,
  logs,
  config
})

// Await delivery (errors are logged, never thrown):
await analytics.sendEvent('user_login', { userId: '123', timestamp: Date.now() })

// Fire-and-forget:
analytics.fireEvent('user_login', { userId: '123', timestamp: Date.now() })
```

> Note: the caller's `body` is merged with `{ env }`, so `env` is a reserved key and will be overwritten if passed.
