---
'@dcl/job-component': minor
---

- Add `createCronJobComponent` for cron-expression scheduling alongside the existing fixed-interval `createJobComponent`. Schedules accept an optional `timezone` and a `skipFirstRun` flag that waits for the first cron match before running.
- Fix `stop()` so it awaits the entire run loop — including an async `onFinish` — before resolving. Previously `stop()` only awaited the current iteration's promise, so cleanup was still in-flight when the lifecycle manager considered shutdown complete.
- Fix `stop()` re-throwing a rejection from an earlier iteration when called during the inter-iteration sleep.
- Guard `start()` against double invocation: the second call logs a warning and returns instead of racing against the first `runJob`.
- Isolate `onError` and `onFinish` callback errors: a throwing callback is logged and the runner continues, instead of producing an unhandled rejection or silently killing the component.
- Harden `nextDelayMs`: throwing or non-finite (`NaN`, `Infinity`) values are logged and fall back to a 60s sleep instead of corrupting the loop. Finite values are also clamped to Node's 32-bit `setTimeout` maximum (~24.85 days), so long cron delays (e.g. monthly expressions) no longer overflow into a ~1ms hot loop.
- Fix `stop()` called mid-job: once the executing iteration resolves, the run loop now re-checks `shouldStop` before scheduling the next inter-iteration sleep, so shutdown no longer waits out a full cron delay.
- Surface unexpected run-loop failures: the defensive `.catch` on `runJob()` now logs any rejection instead of silently dropping it, so bugs in the runner itself are visible.
- Reject non-finite `onTime` and `startupDelay`: `NaN` and `Infinity` previously bypassed the `< 500` / `< 0` guards and fell through to a 1ms `setTimeout` or the 60s fallback. They now throw `WrongOnTimeError` / `InvalidStartupDelayError` at construction time.
- Warn when `skipFirstRun: true` is combined with a non-default `startupDelay`, since `startupDelay` is silently ignored in favor of the next cron match.
- New `InvalidStartupDelayError` (thrown when `startupDelay` is negative or non-finite). `InvalidCronExpressionError` preserves the raw parser error via the ES2022 `Error` `cause` option, keeping it interoperable with the native error-cause chain. All error subclasses now set `.name` for clearer diagnostics.
- Correct the `WrongOnTimeError` message to match the `>= 500ms` bound.
- Tighten public types: `job: () => unknown` on both factories (was `() => any`); `JobOptions.onFinish: () => void | Promise<void>` (was `() => any`).
