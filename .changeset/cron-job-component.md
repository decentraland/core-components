---
'@dcl/job-component': minor
---

- Add `createCronJobComponent` for cron-expression scheduling alongside the existing fixed-interval `createJobComponent`. Schedules accept an optional `timezone` and a `skipFirstRun` flag that waits for the first cron match before running.
- Fix `stop()` so it awaits the entire run loop — including an async `onFinish` — before resolving. Previously `stop()` only awaited the current iteration's promise, so cleanup was still in-flight when the lifecycle manager considered shutdown complete.
- Fix `stop()` re-throwing a rejection from an earlier iteration when called during the inter-iteration sleep.
- Guard `start()` against double invocation: the second call logs a warning and returns instead of racing against the first `runJob`.
- Isolate `onError` and `onFinish` callback errors: a throwing callback is logged and the runner continues, instead of producing an unhandled rejection or silently killing the component.
- Harden `nextDelayMs`: throwing or non-finite (`NaN`, `Infinity`) values are logged and fall back to a 60s sleep instead of corrupting the loop.
- Warn when `skipFirstRun: true` is combined with a non-default `startupDelay`, since `startupDelay` is silently ignored in favor of the next cron match.
- New `InvalidStartupDelayError` (thrown when `startupDelay < 0`). `InvalidCronExpressionError` now preserves the raw parser error on `.cause`. All error subclasses now set `.name` for clearer diagnostics.
- Correct the `WrongOnTimeError` message to match the `>= 500ms` bound.
- Tighten public types: `job: () => unknown` on both factories (was `() => any`); `JobOptions.onFinish: () => void | Promise<void>` (was `() => any`).
