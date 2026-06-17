import { IBaseComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { ITaskWithLifecycle } from './types'

export type TaskLifecycleManagerComponent = {
  setDesiredTasks(desiredTaskNames: Set<string>): void
  getRunningTasks(): Set<string>
}

export type TaskLifecycleManagerOptions = {
  taskManagerName: string
  createTask(taskName: string): ITaskWithLifecycle
}

/**
 * Handles a list of running tasks. Each call to setDesiredTasks creates a task per name not already
 * running, and stops tasks no longer desired.
 */
export function createTaskLifecycleManagerComponent(
  components: { logs: ILoggerComponent },
  options: TaskLifecycleManagerOptions
): IBaseComponent & TaskLifecycleManagerComponent {
  const logs = components.logs.getLogger(options.taskManagerName)
  const createdTasks = new Map<string, ITaskWithLifecycle>()

  return {
    setDesiredTasks(desiredTaskNames: Set<string>): void {
      for (const [name, task] of createdTasks) {
        if (!desiredTaskNames.has(name)) {
          logs.info('Stopping task', { name })
          task.stop().catch((err) => logs.error(err))
          createdTasks.delete(name)
        }
      }

      for (const name of desiredTaskNames) {
        if (!createdTasks.has(name)) {
          logs.info('Creating task', { name })
          const task = options.createTask(name)
          createdTasks.set(name, task)
          task
            .start()
            .catch((err) => logs.error(err))
            .finally(() => {
              if (createdTasks.get(name) === task) {
                logs.info('Task finished', { name })
                createdTasks.delete(name)
              }
            })
        }
      }
    },
    getRunningTasks() {
      return new Set(createdTasks.keys())
    },
    async stop() {
      for (const [name, task] of createdTasks) {
        logs.info('Stopping task', { name })
        try {
          await task.stop()
        } catch (e: any) {
          logs.error(e)
        }
        createdTasks.delete(name)
      }
    }
  }
}
