import { IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'

export interface IAnalyticsDependencies {
  logs: ILoggerComponent
  fetcher: IFetchComponent
  config: IConfigComponent
}

/**
 * Maps event names to their body shapes. Event bodies must be objects — primitives cannot be safely spread into the outgoing payload.
 */
export type AnalyticsEventMap = Record<string, Record<string, any>>

export interface IAnalyticsComponent<T extends AnalyticsEventMap = AnalyticsEventMap> {
  /**
   * Send an event and wait for the response.
   * @param name - The name of the event.
   * @param body - The body of the event, typed against the event name.
   */
  sendEvent: <K extends keyof T>(name: K, body: T[K]) => Promise<void>
  /**
   * Send an event without waiting for the response.
   * @param name - The name of the event.
   * @param body - The body of the event, typed against the event name.
   */
  fireEvent: <K extends keyof T>(name: K, body: T[K]) => void
}
