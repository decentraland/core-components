# @dcl/tracer-component

## 1.0.0

### Major Changes

- d7f89a6: initial release of `@dcl/tracer-component`, moved into core-components from `@well-known-components/tracer-component`. creates trace spans over an execution and exposes the w3c trace context (`traceparent` / `tracestate`) to the traced code.

  includes fixes relative to the original component:
  - `getTraceStateString()` now formats the trace state as `key=value` pairs joined by commas (it previously emitted malformed output such as `=a,1,=b,2`).
  - `getTraceState()` / `getContextData()` now freeze a shallow copy instead of the live value, so reading the trace state no longer makes later `setTraceStateProperty` / `deleteTraceStateProperty` calls throw.
  - nested spans now set the child `parentId` to the parent span id rather than the trace id, preserving the span hierarchy.
  - nested spans now copy the inherited trace state, so a child span's `setTraceStateProperty` / `deleteTraceStateProperty` calls no longer leak back into the parent and sibling spans.
  - `buildTraceString()` now zero-pads the version and trace flags to two hex digits, matching the w3c `traceparent` format.
  - `NotInSpanError` and `INVALID_SPAN_ID` are now exported from the package entry point.
