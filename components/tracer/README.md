# @dcl/tracer-component

Creates trace spans over an execution, providing context to the code being run
so it can be traced and the W3C Trace Context (`traceparent` / `tracestate`)
propagated.

## Installation

```bash
npm install @dcl/tracer-component
```

## Usage

Import the component, initialize it and wrap your traceable code into a trace span:

```typescript
import { createTracerComponent } from '@dcl/tracer-component'

const tracer = createTracerComponent()
tracer.span('my span', () => {
  // Do some work here
})
```

While inside the span, the traced code is able to access the trace context.
This is especially useful for adding traced logs:

```typescript
const tracer = createTracerComponent()
tracer.span('my span', () => {
  console.log(`[${tracer.getTraceString()}] Starting some work`)
  // Do some work here
  console.log(`[${tracer.getTraceString()}] Finishing some work`)
})
```

The logs output a trace alongside the message using the
[traceparent format](https://www.w3.org/TR/trace-context/#traceparent-header)
(`version-traceId-parentId-flags`):

```bash
  [00-7970d1a8361cc811ee59dc3ee1c8134e-0000000000000000-00] Starting some work
  [00-7970d1a8361cc811ee59dc3ee1c8134e-0000000000000000-00] Finishing some work
```

The `traceId` is unique throughout the span execution and makes it easy to track
which run of the span a log belongs to. The `parentId` identifies the span the
current span was created from, making it possible to follow the chain of spans.
See the [W3C Trace Context](https://www.w3.org/TR/trace-context/) spec for the
meaning of the `version` and `flags` values.
