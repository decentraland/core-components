# @dcl/http-tracer-component

Adds tracing spans to each request handler, propagating W3C Trace Context
(`traceparent` / `tracestate`) headers across HTTP requests.

## Installation

```bash
npm install @dcl/http-tracer-component
```

## Usage

```typescript
import { createHttpTracerComponent } from '@dcl/http-tracer-component'

createHttpTracerComponent({ server, tracer })
```

It wraps the server with a middleware that:

1. Parses the incoming `traceparent` and `tracestate` headers
2. Opens a trace span for the request
3. Injects the resulting `traceparent` (and `tracestate`) headers into the response

## License

Apache-2.0
