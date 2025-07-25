import { IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'

export interface IAnalyticsDependencies {
  logs: ILoggerComponent
  fetcher: IFetchComponent
  config: IConfigComponent
}

export interface IAnalyticsComponent<T extends Record<string, any> = Record<string, any>> {
  /**
   * Send an event and wait for the response.
   * @param name - The name of the event.
   * @param body - The body of the event.
   */
  sendEvent: (name: keyof T, body: T[keyof T]) => Promise<void>
  /**
   * Send and event without waiting for the response.
   * @param name - The name of the event.
   * @param body - The body of the event.
   */
  fireEvent: (name: keyof T, body: T[keyof T]) => void
}
