import { ILoggerComponent } from '@well-known-components/interfaces'
import { createSerialTaskRunner, SerialTaskRunner } from '../src/serial-runner'
import { ITaskWithLifecycle } from '../src/types'

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('when running tasks with the serial task runner', () => {
  let logger: ILoggerComponent.ILogger
  let runner: SerialTaskRunner

  beforeEach(() => {
    logger = { log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    runner = createSerialTaskRunner(logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and several tasks are enqueued', () => {
    let order: number[]
    let tasks: ITaskWithLifecycle[]
    let allDone: Promise<void>

    beforeEach(() => {
      order = []
      let resolveDone: () => void = () => {}
      allDone = new Promise((resolve) => (resolveDone = resolve))
      tasks = [1, 2, 3].map((n) => ({
        async start() {
          order.push(n)
          if (order.length === 3) resolveDone()
        },
        async stop() {}
      }))
    })

    it('should run them one at a time in FIFO order', async () => {
      tasks.forEach((task) => runner.enqueue(task))
      await allDone
      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('and a task is already running', () => {
    let secondStarted: boolean
    let releaseFirst: () => void

    beforeEach(async () => {
      secondStarted = false
      releaseFirst = () => {}
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
      const first: ITaskWithLifecycle = { start: () => firstGate, stop: async () => {} }
      const second: ITaskWithLifecycle = {
        async start() {
          secondStarted = true
        },
        async stop() {}
      }
      runner.enqueue(first)
      runner.enqueue(second)
      await tick()
    })

    afterEach(() => {
      releaseFirst()
    })

    it('should not start the next task until the running one finishes', () => {
      expect(secondStarted).toBe(false)
    })
  })

  describe('and stop is called while a task is running', () => {
    let runningTask: ITaskWithLifecycle

    beforeEach(async () => {
      runningTask = { start: () => new Promise<void>(() => {}), stop: jest.fn().mockResolvedValue(undefined) }
      const queuedTask: ITaskWithLifecycle = { start: jest.fn().mockResolvedValue(undefined), stop: async () => {} }
      runner.enqueue(runningTask)
      runner.enqueue(queuedTask)
      await tick()
      await runner.stop()
    })

    it('should abort the running task', () => {
      expect(runningTask.stop).toHaveBeenCalledTimes(1)
    })

    it('should empty its queue', () => {
      expect(runner.size()).toBe(0)
    })
  })
})
