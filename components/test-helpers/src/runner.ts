import { Lifecycle } from '@well-known-components/interfaces'
import { BeforeStartFunction, MockedComponent, TestArguments } from './types'

/**
 * Creates a jest test runner bound to a component-based program. It receives the
 * same configuration as `Lifecycle.run` and returns a `test(name, suite)`
 * function that wires the program's lifecycle into jest's `beforeAll`/`afterAll`
 * and exposes the components — plus jest stubs and spies — to the suite.
 *
 * Each `test(name, suite)` call creates its own `describe` block with a freshly
 * initialized program, so component state is isolated between suites.
 * @public
 */
export function createRunner<TestComponents extends Record<string, any>>(
  options: Lifecycle.ProgramConfig<TestComponents>
) {
  return (name: string, suite: (testArgs: TestArguments<TestComponents>) => void) => {
    let program: Lifecycle.ComponentBasedProgram<TestComponents>
    const stubComponentInstances = new Map<keyof TestComponents, MockedComponent<any>>()
    const spyComponentInstances = new Map<keyof TestComponents, MockedComponent<any>>()

    function getComponent(key: string) {
      if (!program) {
        throw new Error('Cannot get the components before the test program is initialized')
      }
      if (!program.components) {
        throw new Error('Cannot get the components')
      }
      if (!(key in program.components)) {
        throw new Error(`Component ${key} does not exist`)
      }
      return program.components[key]
    }

    // Wraps every function-valued property of a component with a jest spy. When
    // `callThrough` is false the spy replaces the implementation with a no-op
    // (the previous sinon `stub` behavior); when true the original implementation
    // runs (a `spy`). jest.spyOn mutates the component in place, so the real
    // `components` proxy observes the same wrapped methods.
    function mockComponent<T extends {}>(component: T, callThrough: boolean): MockedComponent<T> {
      const mocked = {} as MockedComponent<T>
      for (const key in component) {
        if (typeof component[key] === 'function') {
          const spy = jest.spyOn(component as any, key as any)
          if (!callThrough) {
            spy.mockImplementation(() => undefined as any)
          }
          mocked[key as keyof T] = spy as any
        }
      }
      return mocked
    }

    function stubComponent(key: string): MockedComponent<TestComponents[any]> {
      if (!stubComponentInstances.has(key)) {
        stubComponentInstances.set(key, mockComponent(getComponent(key), false))
      }
      return stubComponentInstances.get(key)!
    }

    function spyComponent(key: string): MockedComponent<TestComponents[any]> {
      if (!spyComponentInstances.has(key)) {
        spyComponentInstances.set(key, mockComponent(getComponent(key), true))
      }
      return spyComponentInstances.get(key)!
    }

    const beforeStartFunctions: BeforeStartFunction[] = []

    const testArgs: TestArguments<TestComponents> = {
      components: new Proxy({}, { get: (_obj, key) => getComponent(key as string) }) as any,
      stubComponents: new Proxy({}, { get: (_obj, key) => stubComponent(key as string) }) as any,
      spyComponents: new Proxy({}, { get: (_obj, key) => spyComponent(key as string) }) as any,
      beforeStart(fn) {
        beforeStartFunctions.push(fn)
      }
    }

    describe(name, () => {
      beforeAll(async () => {
        jest.resetModules()
        for (const fn of beforeStartFunctions) {
          await fn()
        }
        program = await Lifecycle.run<TestComponents>(options)
      })

      beforeEach(() => {
        // Each test case gets fresh stubs/spies: drop the cached wrappers and
        // clear any mock state left over from the previous test.
        jest.resetAllMocks()
        stubComponentInstances.clear()
        spyComponentInstances.clear()
      })

      afterEach(() => {
        // Restore the original implementations that the stubs/spies replaced.
        jest.restoreAllMocks()
      })

      suite(testArgs)

      afterAll(async () => {
        if (program) {
          await program.stop()
        }
      })
    })
  }
}
