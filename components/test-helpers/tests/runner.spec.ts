import { createRunner } from '../src'

type Components = {
  componentA: {
    functionThatThrows(): void
  }
  componentB: {
    sum(a: number, b: number): number
    counter(): number
    label: string
  }
}

const test = createRunner<Components>({
  async main({ startComponents }) {
    await startComponents()
  },
  async initComponents(): Promise<Components> {
    let counter = 0

    return {
      componentA: {
        functionThatThrows() {
          throw new Error('ABC')
        }
      },
      componentB: {
        sum(a: number, b: number) {
          counter++
          return a + b
        },
        counter() {
          return counter
        },
        label: 'b'
      }
    }
  }
})

test('when accessing the components before the program is initialized', ({ components }) => {
  // Runs at suite-declaration time, before beforeAll initializes the program.
  expect(() => components.componentB.sum(1, 2)).toThrow(
    'Cannot get the components before the test program is initialized'
  )

  it('should expose the initialized components once the test cases run', () => {
    expect(components.componentB.sum(1, 2)).toBe(3)
  })
})

test('when using the real components', ({ components }) => {
  it('should run the original implementation', () => {
    expect(components.componentB.sum(2, 3)).toBe(5)
  })

  it('should share the same component instances across test cases of the same run', () => {
    // The previous test already incremented the counter once.
    expect(components.componentB.counter()).toBe(1)
  })
})

test('when stubbing components', ({ components, stubComponents }) => {
  it('should replace methods with no-op mocks that return undefined by default', () => {
    expect(stubComponents.componentB.sum(1, 2)).toBeUndefined()
  })

  it('should return a configured value from a stubbed method', () => {
    stubComponents.componentB.sum.mockReturnValue(42)

    expect(components.componentB.sum(1, 2)).toBe(42)
  })

  it('should track the calls made to a stubbed method', () => {
    stubComponents.componentB.sum(4, 5)

    expect(stubComponents.componentB.sum).toHaveBeenCalledWith(4, 5)
    expect(stubComponents.componentB.sum).toHaveBeenCalledTimes(1)
  })

  it('should make a stubbed method throw a configured error', () => {
    stubComponents.componentA.functionThatThrows.mockImplementation(() => {
      throw new Error('XYZ')
    })

    expect(() => components.componentA.functionThatThrows()).toThrow('XYZ')
  })

  it('should run the original implementation when the method is not stubbed', () => {
    expect(() => components.componentA.functionThatThrows()).toThrow('ABC')
  })

  describe('and a stub was configured in a previous test case', () => {
    it('should isolate the configuration to that test case (configure)', () => {
      stubComponents.componentB.counter.mockReturnValue(99)

      expect(components.componentB.counter()).toBe(99)
    })

    it('should restore the original implementation in the next test case (verify)', () => {
      expect(components.componentB.counter()).toBe(0)
    })
  })
})

test('when spying on components', ({ components, spyComponents }) => {
  it('should call through to the real implementation by default', () => {
    const { sum } = spyComponents.componentB

    expect(components.componentB.sum(2, 3)).toBe(5)
    expect(sum).toHaveBeenCalledWith(2, 3)
  })

  it('should allow overriding the implementation of a spied method', () => {
    spyComponents.componentB.sum.mockImplementation(() => 4)

    expect(components.componentB.sum(1, 2)).toBe(4)
    expect(spyComponents.componentB.sum).toHaveBeenCalledTimes(1)
  })
})

type LifecycleComponents = {
  service: {
    start(): Promise<void>
    stop(): Promise<void>
    read(): { started: boolean; envAtStart: string | undefined }
  }
}

const ENV_VALUE = 'before-start-value'

const lifecycleTest = createRunner<LifecycleComponents>({
  async main({ startComponents }) {
    await startComponents()
  },
  async initComponents(): Promise<LifecycleComponents> {
    let started = false
    let envAtStart: string | undefined

    return {
      service: {
        async start() {
          started = true
          envAtStart = process.env.TEST_HELPERS_ENV
        },
        async stop() {},
        read() {
          return { started, envAtStart }
        }
      }
    }
  }
})

lifecycleTest('when the components expose a lifecycle', ({ components }) => {
  it('should start the components before the test cases run', () => {
    expect(components.service.read().started).toBe(true)
  })
})

lifecycleTest('when registering a beforeStart hook', ({ beforeStart, components }) => {
  beforeStart(async () => {
    process.env.TEST_HELPERS_ENV = ENV_VALUE
  })

  it('should run the hook before the components start', () => {
    expect(components.service.read().envAtStart).toBe(ENV_VALUE)
    delete process.env.TEST_HELPERS_ENV
  })
})
