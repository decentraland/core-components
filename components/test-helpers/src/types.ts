/**
 * A component whose methods have been wrapped with jest mocks. Function-valued
 * properties become `jest.SpyInstance`s so they can be configured
 * (`mockReturnValue`, `mockImplementation`, ...) and asserted on
 * (`toHaveBeenCalled`, ...); non-function properties are not wrapped.
 * @public
 */
export type MockedComponent<TType extends {}> = {
  [P in keyof TType]: Required<TType>[P] extends (...args: any[]) => any
    ? jest.SpyInstance<ReturnType<Required<TType>[P]>, jest.ArgsType<Required<TType>[P]>> & Required<TType>[P]
    : never
}

/**
 * @public
 * @deprecated use {@link MockedComponent} instead.
 */
export type SpiedInstance<TType extends {}> = MockedComponent<TType>

/**
 * A function registered through {@link TestArguments.beforeStart} to run before
 * the program's lifecycle starts.
 * @public
 */
export type BeforeStartFunction<TestComponents extends Record<string, any> = any> = () => Promise<void> | void

/**
 * Arguments passed to a test suite created with `createRunner`.
 * @public
 */
export type TestArguments<TestComponents extends Record<string, any>> = {
  /** The real components, as wired by the program. */
  components: Readonly<TestComponents>
  /**
   * Components whose methods are replaced by jest mocks that do **not** call
   * through to the original implementation (they return `undefined` until
   * configured). Useful to fully control a dependency's behavior.
   */
  stubComponents: {
    readonly [T in keyof TestComponents]: MockedComponent<TestComponents[T]>
  }
  /**
   * Components whose methods are wrapped by jest spies that **do** call through
   * to the original implementation by default. Useful to assert on calls while
   * keeping the real behavior.
   */
  spyComponents: {
    readonly [T in keyof TestComponents]: MockedComponent<TestComponents[T]>
  }
  /**
   * Registers a function to run before the components' lifecycle starts (e.g. to
   * set environment variables the components read at startup).
   */
  beforeStart(fn: BeforeStartFunction<TestComponents>): void
}
