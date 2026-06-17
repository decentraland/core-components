import { IBaseComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createTaskLifecycleManagerComponent, TaskLifecycleManagerComponent } from '../src/lifecycle-manager'
import { ITaskWithLifecycle } from '../src/types'

describe('when managing tasks with the task lifecycle manager', () => {
  let logger: ILoggerComponent.ILogger
  let createdTasks: Map<string, { start: jest.Mock; stop: jest.Mock }>
  let createTask: jest.Mock
  let manager: IBaseComponent & TaskLifecycleManagerComponent

  beforeEach(() => {
    logger = { log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    createdTasks = new Map()
    createTask = jest.fn((name: string) => {
      // start() never resolves so the task stays "running" and is observable via getRunningTasks
      const task = { start: jest.fn(() => new Promise<void>(() => {})), stop: jest.fn().mockResolvedValue(undefined) }
      createdTasks.set(name, task)
      return task as unknown as ITaskWithLifecycle
    })
    manager = createTaskLifecycleManagerComponent({ logs: { getLogger: () => logger } } as any, {
      taskManagerName: 'TestManager',
      createTask
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and a set of desired tasks is requested', () => {
    beforeEach(() => {
      manager.setDesiredTasks(new Set(['a', 'b']))
    })

    it('should create a task for each desired name', () => {
      expect(createTask.mock.calls.map((call) => call[0])).toEqual(['a', 'b'])
    })

    it('should report all of them as running', () => {
      expect(manager.getRunningTasks()).toEqual(new Set(['a', 'b']))
    })
  })

  describe('and a previously desired task is no longer desired', () => {
    beforeEach(() => {
      manager.setDesiredTasks(new Set(['a', 'b']))
      manager.setDesiredTasks(new Set(['a']))
    })

    it('should stop the task that is no longer desired', () => {
      expect(createdTasks.get('b')!.stop).toHaveBeenCalledTimes(1)
    })

    it('should keep only the still-desired tasks running', () => {
      expect(manager.getRunningTasks()).toEqual(new Set(['a']))
    })
  })

  describe('and the same task is requested again', () => {
    beforeEach(() => {
      manager.setDesiredTasks(new Set(['a']))
      manager.setDesiredTasks(new Set(['a']))
    })

    it('should not recreate the already-running task', () => {
      expect(createTask).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the manager is stopped', () => {
    beforeEach(async () => {
      manager.setDesiredTasks(new Set(['a', 'b']))
      await manager.stop!()
    })

    it('should stop every running task', () => {
      const stopped = [...createdTasks.values()].filter((task) => task.stop.mock.calls.length > 0)
      expect(stopped).toHaveLength(2)
    })

    it('should report no running tasks', () => {
      expect(manager.getRunningTasks()).toEqual(new Set())
    })
  })
})
