# @dcl/uws-http-server

uWebSockets.js based HTTP server component for the core components library. It
exposes a `uws.TemplatedApp` with lifecycle management and Prometheus metrics
helpers.

## Installation

```bash
npm install @dcl/uws-http-server
```

## Usage

```typescript
import { createUWsComponent } from '@dcl/uws-http-server'

const server = await createUWsComponent({ config, logs })

server.app.get('/health', (res) => {
  res.writeStatus('200 OK')
  res.end('ok')
})

await server.start()
```

The component reads `HTTP_SERVER_HOST` and `HTTP_SERVER_PORT` from the config
component and manages the `start`/`stop` lifecycle.

## Metrics

`getDefaultHttpMetrics`, `createMetricsHandler`, `onRequestStart` and
`onRequestEnd` provide Prometheus instrumentation for the server. The metrics
handler is exposed at `WKC_METRICS_PUBLIC_PATH` (default `/metrics`) and can be
protected with `WKC_METRICS_BEARER_TOKEN`.
