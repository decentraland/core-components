# @dcl/http-requests-logger-component

Logs each HTTP request and response handled by the server, with configurable
verbosity, custom log formats, and endpoint skipping.

## Installation

```bash
npm install @dcl/http-requests-logger-component
```

## Usage

Instrument the server with the request logger, passing the `server` and a
`logger` component:

```typescript
import { instrumentHttpServerWithRequestLogger } from '@dcl/http-requests-logger-component'

instrumentHttpServerWithRequestLogger({ server, logger })
```

It registers a middleware that logs an input line when a request comes in and an
output line (including the response status) once it is handled. Health-check
endpoints (`/health/live` and `/health/ready`) are skipped by default.

### Configuration

An optional second argument customizes the behavior:

```typescript
import { instrumentHttpServerWithRequestLogger, Verbosity } from '@dcl/http-requests-logger-component'

instrumentHttpServerWithRequestLogger(
  { server, logger },
  {
    verbosity: Verbosity.DEBUG,
    skipInput: false,
    skipOutput: false,
    skip: ['/health/live', '/health/ready'],
    inputLog: req => `--> ${req.method} ${req.url}`,
    outputLog: (req, res) => `<-- ${req.method} ${req.url} ${res.status}`
  }
)
```

- **`verbosity`** - log level used for the request logs. Defaults to `Verbosity.INFO`.
- **`inputLog`** / **`outputLog`** - functions to customize the logged messages.
- **`skipInput`** / **`skipOutput`** - disable the input or output log line.
- **`skip`** - a string, array of strings, `RegExp`, or predicate over the request
  to decide which endpoints to skip. Defaults to skipping `/health/live` and `/health/ready`.
