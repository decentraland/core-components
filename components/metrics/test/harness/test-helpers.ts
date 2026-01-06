import {
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent,
  IFetchComponent
} from "@well-known-components/interfaces"
import { metricDeclarations } from "./defaultMetrics"

export type TestComponents = {
  server: IHttpServerComponent<{ components: TestComponents }> & { resetMiddlewares(): void }
  logs: ILoggerComponent
  config: IConfigComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetch: IFetchComponent
}
