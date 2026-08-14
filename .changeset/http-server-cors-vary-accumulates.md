---
"@dcl/http-server": patch
---

Accumulate `Vary` in the CORS middleware instead of overwriting it, so a shared cache can no longer serve a preflight built for one origin to another.

`configureOrigin` and `configureAllowedHeaders` both wrote the header with `headers.set`, and the latter runs second on a preflight. A config that reflects the origin (`origin: true`, a fixed string, an array, a RegExp or a function) while leaving `allowedHeaders` unset therefore emitted `Vary: Access-Control-Request-Headers` alone, dropping the `Vary: Origin` that the origin-specific `Access-Control-Allow-Origin` depends on — a cache keying only on the requested headers could hand one origin's preflight to another, whose browser then fails the request. The same `set` in the actual-response path also discarded any `Vary` the handler had set itself, including `Accept-Encoding` and the `Vary: *` opt-out. Both paths now append the field when it isn't already listed, and leave an existing `Vary: *` alone.
