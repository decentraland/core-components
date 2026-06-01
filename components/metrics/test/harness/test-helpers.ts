import {
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent
} from "@well-known-components/interfaces"
import { IFetchComponent } from "@dcl/core-commons"
import { metricDeclarations } from "./defaultMetrics"

export type TestComponents = {
  server: IHttpServerComponent<{ components: TestComponents }> & { resetMiddlewares(): void }
  logs: ILoggerComponent
  config: IConfigComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetch: IFetchComponent
}
