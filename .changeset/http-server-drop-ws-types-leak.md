---
"@dcl/http-server": patch
---

Stop the published types from importing `ws`, so consumers no longer need `@types/ws` (or `skipLibCheck: true`) to typecheck against `@dcl/http-server`.

`ws` is only a dev/type dependency, but `WebSocketCallback`, `IWebSocketComponent` and `TestServerWithWs` referenced its `WebSocket` type, leaking `import type { WebSocket } from 'ws'` into `dist/ws.d.ts` and `dist/test-component.d.ts`. Consumers that don't install `@types/ws` then failed with `TS2307: Cannot find module 'ws'` whenever `skipLibCheck` was off, which forced them to enable it. These (deprecated/alpha) WebSocket types are now generic with an `any` default, so the published `.d.ts` no longer references `ws`; consumers that use them can still opt into precise typing via `WebSocketCallback<import('ws').WebSocket>`.
