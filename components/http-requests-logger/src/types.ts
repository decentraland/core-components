// Source IHttpServerComponent from @dcl/core-commons so this logger accepts an @dcl/http-server v2
// server (native-fetch request/response types) without casts.
import { IHttpServerComponent } from '@dcl/core-commons'

export enum Verbosity {
  INFO = 'info',
  DEBUG = 'debug',
  ERROR = 'error',
  WARN = 'warn'
}

export type RequestLoggerConfigurations = {
  /** The verbosity on which the logs will be outputted. Defaults to INFO. */
  verbosity?: Verbosity
  /** A customizable function that defines how the input log will be outputted. Defaults to outputting [$method: $path]. */
  inputLog?: (req: IHttpServerComponent.DefaultContext<object>['request']) => string
  /** A customizable function that defines how the output log will be outputted. Defaults to outputting [$method: $path][$status]. */
  outputLog?: (req: IHttpServerComponent.DefaultContext<object>['request'], res: IHttpServerComponent.IResponse) => string
  /** A flag to disable the outputting of the input log. */
  skipInput?: boolean
  /** A flag to disable the outputting of the output log. */
  skipOutput?: boolean
  /** A flexible parameter to define how to skip the logging of endpoints. Defaults to skipping the /health/live endpoint. */
  skip?: ((req: IHttpServerComponent.DefaultContext<object>['request']) => boolean) | string[] | string | RegExp
}
