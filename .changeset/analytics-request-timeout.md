---
'@dcl/analytics-component': major
---

- Apply a request timeout to the Analytics API call to prevent hung fetches. The timeout is read from the optional `ANALYTICS_REQUEST_TIMEOUT` env var; only finite positive numbers are accepted, otherwise the default (10000 ms) is used.
- Remove the per-event `logger.debug`. It sat outside the try/catch, which meant a failing logger could produce an unhandled rejection through `fireEvent`.
- **Breaking:** Tighten `sendEvent` / `fireEvent` typing so `body` is bound to the specific event key (`<K extends keyof T>(name: K, body: T[K])`) instead of the union of all event bodies. Export `AnalyticsEventMap = Record<string, Record<string, any>>` as the generic constraint on `IAnalyticsComponent` and `createAnalyticsComponent`, so primitive event bodies are rejected at compile time. Consumers that declared an event map with a primitive body (e.g. `{ page_view: string }`) will see a compile error — in practice these were already broken at runtime because spreading a primitive into the outgoing payload yields `{}`.
- Rewrite the README to match the current constructor and public API.
