# @dcl/http-tracer-component

## 2.0.1

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 2.0.0

### Major Changes

- 372e52b: source `IHttpServerComponent` from `@dcl/core-commons` instead of `@well-known-components/interfaces`, so the tracer accepts an `@dcl/http-server` v2 server (native-fetch request/response types) without a cast. The middleware behavior is unchanged — it only reads the request's headers/method/url, which are WHATWG-compatible.

  BREAKING CHANGE: the `server` argument is now typed against `@dcl/core-commons`' `IHttpServerComponent`; pair this component with `@dcl/http-server` v2.

## 1.0.0

### Major Changes

- 4d23f4f: initial release of `@dcl/http-tracer-component`, moved into core-components from `@well-known-components/http-tracer-component`. adds tracing spans to each request handler and propagates the w3c trace context headers.
