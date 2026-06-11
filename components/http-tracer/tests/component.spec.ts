import type { ITracerComponent } from '@well-known-components/interfaces'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { createHttpTracerComponent } from '../src'
import { parseTraceParentHeader } from '../src/logic'

let tracerComponentMock: ITracerComponent
let serverComponentMock: IHttpServerComponent<IHttpServerComponent.DefaultContext<any>>
let storedMiddleware: (
  ctx: IHttpServerComponent.DefaultContext<object>,
  next: () => Promise<IHttpServerComponent.IResponse>
) => Promise<IHttpServerComponent.IResponse>
let mockedContext: IHttpServerComponent.DefaultContext<object>
let mockedNext: () => Promise<IHttpServerComponent.IResponse>
let mockedGetHeader: jest.Mock
let mockedGetTraceString: jest.Mock
let mockedGetTraceStateString: jest.Mock

beforeEach(() => {
  mockedGetTraceString = jest.fn()
  mockedGetTraceStateString = jest.fn()
  tracerComponentMock = {
    span: jest.fn().mockImplementation((_name, spanFunction) => spanFunction()),
    isInsideOfTraceSpan: jest.fn(),
    getSpanId: jest.fn(),
    getTrace: jest.fn(),
    getTraceString: mockedGetTraceString,
    getTraceChild: jest.fn(),
    getTraceChildString: jest.fn(),
    getTraceState: jest.fn(),
    getTraceStateString: mockedGetTraceStateString,
    getContextData: jest.fn(),
    setContextData: jest.fn(),
    setTraceStateProperty: jest.fn(),
    deleteTraceStateProperty: jest.fn()
  }
  serverComponentMock = {
    use: jest.fn().mockImplementation(middleware => (storedMiddleware = middleware)),
    setContext: jest.fn()
  }
  mockedGetHeader = jest.fn()
  mockedContext = {
    request: {
      headers: {
        get: mockedGetHeader
      } as any
    } as any,
    url: new URL('http://localhost')
  }
  mockedNext = () => Promise.resolve({})
  createHttpTracerComponent({ server: serverComponentMock, tracer: tracerComponentMock })
})

describe('when receiving a request with a traceparent header', () => {
  let traceParentHeader: string

  describe('and the header is correctly formatted', () => {
    beforeEach(() => {
      traceParentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
      mockedGetHeader.mockImplementation(header => (header === 'traceparent' ? traceParentHeader : null))
    })

    it('should store it in the span context', async () => {
      await storedMiddleware(mockedContext, mockedNext)
      expect(tracerComponentMock.span).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ ...parseTraceParentHeader(traceParentHeader) })
      )
    })
  })

  describe('and the header is not correctly formatted', () => {
    beforeEach(() => {
      traceParentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'
      mockedGetHeader.mockImplementation(header => (header === 'traceparent' ? traceParentHeader : null))
    })

    it('should not store it in the span context', async () => {
      await storedMiddleware(mockedContext, mockedNext)
      expect(tracerComponentMock.span).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined)
    })
  })
})

describe('when receiving a request with a tracestate header', () => {
  let traceStateHeader: string

  describe('without a traceparent header', () => {
    beforeEach(() => {
      traceStateHeader = 'aKey=aValue'
      mockedGetHeader.mockImplementation(header => {
        if (header === 'traceparent') {
          return undefined
        } else if (header === 'tracestate') {
          return traceStateHeader
        }
        return undefined
      })
    })

    it('should not store it in the span context', async () => {
      await storedMiddleware(mockedContext, mockedNext)
      expect(tracerComponentMock.span).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined)
    })
  })

  describe('with a traceparent header', () => {
    let traceParentHeader: string
    beforeEach(() => {
      traceParentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'
    })

    describe('and the tracestate header is not well formatted', () => {
      beforeEach(() => {
        traceStateHeader = 'aKey=aValue'
        mockedGetHeader.mockImplementation(header => {
          if (header === 'traceparent') {
            return traceParentHeader
          } else if (header === 'tracestate') {
            return traceStateHeader
          }
          return undefined
        })
      })

      it('should not store it in the span context', async () => {
        await storedMiddleware(mockedContext, mockedNext)
        expect(tracerComponentMock.span).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined)
      })
    })

    describe('and the tracestate header is well formatted', () => {
      beforeEach(() => {
        traceStateHeader = 'someBrokenValue'
        mockedGetHeader.mockImplementation(header => {
          if (header === 'traceparent') {
            return traceParentHeader
          } else if (header === 'tracestate') {
            return traceStateHeader
          }
          return undefined
        })
      })

      it('should store it in the span context', async () => {
        await storedMiddleware(mockedContext, mockedNext)
        expect(tracerComponentMock.span).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined)
      })
    })
  })
})

describe('when responding a request', () => {
  let traceStateHeader: string
  let traceParentHeader: string

  describe('having a trace but no trace state', () => {
    beforeEach(() => {
      traceParentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'
      mockedGetHeader.mockImplementation(header => {
        if (header === 'traceparent') {
          return traceParentHeader
        } else if (header === 'tracestate') {
          return undefined
        }
        return undefined
      })
      mockedGetTraceString.mockReturnValue('aTraceString')
      mockedGetTraceStateString.mockReturnValue(undefined)
    })

    it('should return a response with the traceparent header', () => {
      return expect(storedMiddleware(mockedContext, mockedNext)).resolves.toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            traceparent: 'aTraceString'
          })
        })
      )
    })
  })

  describe('having a trace and a trace state', () => {
    beforeEach(() => {
      traceParentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'
      traceStateHeader = 'aKey=aValue'
      mockedGetHeader.mockImplementation(header => {
        if (header === 'traceparent') {
          return traceParentHeader
        } else if (header === 'tracestate') {
          return traceStateHeader
        }
        return undefined
      })
      mockedGetTraceString.mockReturnValue('aTraceString')
      mockedGetTraceStateString.mockReturnValue('aTraceStateString')
    })

    it('should return a response with the traceparent and tracestate headers', () => {
      return expect(storedMiddleware(mockedContext, mockedNext)).resolves.toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            traceparent: 'aTraceString',
            tracestate: 'aTraceStateString'
          })
        })
      )
    })
  })
})
