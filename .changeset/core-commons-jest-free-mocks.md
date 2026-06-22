---
"@dcl/core-commons": patch
---

stop the published mock declarations from referencing the global `jest` namespace (#fix). `createFetchMockedComponent` and `createLoggerMockedComponent` are now typed against the plain `IFetchComponent` / `ILoggerComponent` interfaces (matching `createConfigMockedComponent`) instead of `jest.Mocked<...>`, while still returning `jest.fn()`-backed mocks at runtime. As a result `dist/mocks/fetch.d.ts` and `dist/mocks/logs.d.ts` no longer reference `jest`, so consumers that import `@dcl/core-commons` no longer need `@types/jest` (or `skipLibCheck`) just to type-check.
