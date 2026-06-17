---
"@dcl/tasks-component": minor
---

Add `@dcl/tasks-component`: generic, domain-agnostic task-scheduling primitives extracted from `@dcl/snapshots-synchronizer-component`, all built on a single `ITaskWithLifecycle` interface. Provides `createTaskQueue` (concurrency-limited retry queue over p-queue), `createSerialTaskRunner` (FIFO lifecycle runner that aborts the running task on stop), `createTaskLifecycleManagerComponent` (reconciles a set of named long-running tasks to a desired set) and `createExponentialBackoffRetry` (interruptible retry loop with exponential backoff). Typed errors (`InvalidRetriesError`, `InvalidMaxIntervalError`).
