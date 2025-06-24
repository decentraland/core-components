import { IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'

export interface IAnalyticsDependencies {
  logs: ILoggerComponent
  fetch: IFetchComponent
}

export type AnalyticsEvent = {
  event: string
  body: Record<string, any>
}

export type Environment = 'prd' | 'stg' | 'dev'

export interface IAnalyticsComponent {
  sendEvent: (event: AnalyticsEvent) => Promise<void>
}
