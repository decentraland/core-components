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
  sendEvent: (name: string, body: Record<string, any>) => Promise<void>
}
