/**
 * A unit of long-running work with an explicit lifecycle. Once `start()` resolves the task has
 * ended; `stop()` signals it to end.
 */
export type ITaskWithLifecycle = {
  // once start() finishes, the task ends
  start(): Promise<void>
  // should trigger the signal to end the task
  stop(): Promise<void>
}
