import { ILoggerComponent } from '@well-known-components/interfaces'
import { IHttpServerComponent } from '@dcl/core-commons'
import { instrumentHttpServerWithRequestLogger } from '../src/component'
import { RequestLoggerConfigurations, Verbosity } from '../src/types'

let options: RequestLoggerConfigurations
let loggerMock: ILoggerComponent
let serverMock: IHttpServerComponent<IHttpServerComponent.DefaultContext<object>>
let mockedContext: IHttpServerComponent.DefaultContext<object>
let storedMiddleware: (
  ctx: IHttpServerComponent.DefaultContext<object>,
  next: () => Promise<IHttpServerComponent.IResponse>
) => Promise<IHttpServerComponent.IResponse>
let mockedNext: () => Promise<IHttpServerComponent.IResponse>
let mockedResponse: IHttpServerComponent.IResponse
let loggers: (ILoggerComponent.ILogger & { name: string })[]

beforeEach(() => {
  options = {}
  loggers = []
  loggerMock = {
    getLogger: (name: string) => {
      const aLogger = {
        name,
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
        debug: jest.fn()
      }
      loggers.push(aLogger)
      return aLogger
    }
  }
  serverMock = {
    use: jest.fn().mockImplementation(middleware => (storedMiddleware = middleware)),
    setContext: jest.fn()
  }
  mockedContext = {
    request: {
      method: 'GET',
      url: 'http://localhost/some-endpoint?someParameter=1'
    } as any,
    url: new URL('http://localhost/some-endpoint?someParameter=1')
  }
  mockedResponse = {
    headers: {
      aHeader: 'aValue'
    }
  }
  mockedNext = jest.fn().mockResolvedValue(mockedResponse)
})

let response: IHttpServerComponent.IResponse

describe('when initializing the component', () => {
  beforeEach(() => {
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
  })

  it('should instantiate the output and the input loggers', () => {
    expect(loggers[0]?.name).toEqual('http-in')
    expect(loggers[1]?.name).toEqual('http-out')
  })
})

describe('when the verbosity configuration is set', () => {
  beforeEach(async () => {
    options.verbosity = Verbosity.DEBUG
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
    response = await storedMiddleware(mockedContext, mockedNext)
  })

  it('should log the requests using the verbosity', () => {
    expect(loggers[0]?.debug).toHaveBeenCalled()
    expect(loggers[1]?.debug).toHaveBeenCalled()
  })

  it('should resolve the request by continuing with the middleware execution chain', () => {
    expect(mockedNext).toHaveBeenCalled()
    expect(response).toEqual(mockedResponse)
  })
})

describe('when the verbosity configuration is not set', () => {
  beforeEach(async () => {
    options.verbosity = undefined
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
    response = await storedMiddleware(mockedContext, mockedNext)
  })

  it('should log the requests using INFO as the default verbosity', () => {
    expect(loggers[0]?.info).toHaveBeenCalled()
    expect(loggers[1]?.info).toHaveBeenCalled()
  })

  it('should resolve the request by continuing with the middleware execution chain', () => {
    expect(mockedNext).toHaveBeenCalled()
    expect(response).toEqual(mockedResponse)
  })
})

describe('when the skip output configuration is set', () => {
  describe('and is set to true', () => {
    beforeEach(async () => {
      options.skipOutput = true
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it('should log the request input and not log the request output', () => {
      expect(loggers[0]?.info).toHaveBeenCalled()
      expect(loggers[1]?.info).not.toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })

  describe('and is set to false', () => {
    beforeEach(async () => {
      options.skipOutput = false
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it("should log both the request's input and output", () => {
      expect(loggers[0]?.info).toHaveBeenCalled()
      expect(loggers[1]?.info).toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })
})

describe('when the skip output configuration is not set', () => {
  beforeEach(async () => {
    options.skipOutput = undefined
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
    response = await storedMiddleware(mockedContext, mockedNext)
  })

  it("should log both the request's input and output", () => {
    expect(loggers[0]?.info).toHaveBeenCalled()
    expect(loggers[1]?.info).toHaveBeenCalled()
  })

  it('should resolve the request by continuing with the middleware execution chain', () => {
    expect(mockedNext).toHaveBeenCalled()
    expect(response).toEqual(mockedResponse)
  })
})

describe('when the skip input configuration is set', () => {
  describe('and is set to true', () => {
    beforeEach(async () => {
      options.skipInput = true
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it('should not log the request input and log the request output', () => {
      expect(loggers[0]?.info).not.toHaveBeenCalled()
      expect(loggers[1]?.info).toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })

  describe('and is set to false', () => {
    beforeEach(async () => {
      options.skipInput = false
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it("should log both the request's input and output", () => {
      expect(loggers[0]?.info).toHaveBeenCalled()
      expect(loggers[1]?.info).toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })
})

describe('when the skip input configuration is not set', () => {
  beforeEach(async () => {
    options.skipInput = undefined
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
    response = await storedMiddleware(mockedContext, mockedNext)
  })

  it("should log both the request's input and output", () => {
    expect(loggers[0]?.info).toHaveBeenCalled()
    expect(loggers[1]?.info).toHaveBeenCalled()
  })

  it('should resolve the request by continuing with the middleware execution chain', () => {
    expect(mockedNext).toHaveBeenCalled()
    expect(response).toEqual(mockedResponse)
  })
})

describe('when the skip parameter is set', () => {
  beforeEach(() => {
    options.skip = '/v1/endpoint'
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
  })

  describe('and the log should be skipped', () => {
    beforeEach(async () => {
      mockedContext.url = new URL('http://localhost/v1/endpoint')
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it('should not log the requests', () => {
      expect(loggers[0]?.info).not.toHaveBeenCalled()
      expect(loggers[1]?.info).not.toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })

  describe('and the log should not be skipped', () => {
    beforeEach(async () => {
      mockedContext.url = new URL('http://localhost/v1/another-endpoint')
      response = await storedMiddleware(mockedContext, mockedNext)
    })

    it('should log the requests', () => {
      expect(loggers[0]?.info).toHaveBeenCalled()
      expect(loggers[1]?.info).toHaveBeenCalled()
    })

    it('should resolve the request by continuing with the middleware execution chain', () => {
      expect(mockedNext).toHaveBeenCalled()
      expect(response).toEqual(mockedResponse)
    })
  })
})

describe('when the skip parameter is not set', () => {
  beforeEach(async () => {
    options.skip = undefined
    mockedContext.request = { method: 'GET', url: 'http://localhost/health/live' } as any
    mockedContext.url = new URL('http://localhost/health/live')
    instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
    response = await storedMiddleware(mockedContext, mockedNext)
  })

  it('should not log the health requests', () => {
    expect(loggers[0]?.info).not.toHaveBeenCalled()
    expect(loggers[1]?.info).not.toHaveBeenCalled()
  })

  it('should resolve the request by continuing with the middleware execution chain', () => {
    expect(mockedNext).toHaveBeenCalled()
    expect(response).toEqual(mockedResponse)
  })
})

describe('when any of the following middlewares fail', () => {
  let error: object

  describe('and the failure is caused with an error containing an status code', () => {
    beforeEach(() => {
      error = { status: 400, statusCode: 400 }
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      mockedNext = jest.fn().mockRejectedValueOnce(error)
    })

    it('should log the output at error level based on the status code of the exception and propagate the error', async () => {
      await expect(storedMiddleware(mockedContext, mockedNext)).rejects.toEqual(error)
      expect(loggers[1]?.error).toHaveBeenCalledWith(
        `[${mockedContext.request.method}: ${mockedContext.url.pathname}${mockedContext.url.search}${mockedContext.url.hash}][400]`
      )
    })
  })

  describe('and the failure is caused without an http error', () => {
    beforeEach(() => {
      error = { message: 'An error occurred' }
      instrumentHttpServerWithRequestLogger({ server: serverMock, logger: loggerMock }, options)
      mockedNext = jest.fn().mockRejectedValueOnce(error)
    })

    it('should log the output at error level using the status code as 500', async () => {
      await expect(storedMiddleware(mockedContext, mockedNext)).rejects.toEqual(error)
      expect(loggers[1]?.error).toHaveBeenCalledWith(
        `[${mockedContext.request.method}: ${mockedContext.url.pathname}${mockedContext.url.search}${mockedContext.url.hash}][500]`
      )
    })
  })
})
