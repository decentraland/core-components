import { ILoggerComponent, IFetchComponent, IConfigComponent } from '@well-known-components/interfaces'
import { createFetchMockedComponent, createLoggerMockedComponent, createConfigMockedComponent } from '@dcl/core-commons'
import { createAnalyticsComponent } from '../src/component'
import { IAnalyticsComponent } from '../src/types'

let logs: ILoggerComponent
let fetcher: IFetchComponent
let component: IAnalyticsComponent
let config: IConfigComponent
let context: string
let analyticsApiUrl: string
let analyticsApiToken: string
let environment: string
let fetchMock: jest.Mock
let errorLogMock: jest.Mock

beforeEach(async () => {
  analyticsApiUrl = 'https://analytics.example.com/events'
  analyticsApiToken = 'test-token-123'
  environment = 'dev'
  context = 'test-context'
  fetchMock = jest.fn()
  errorLogMock = jest.fn()
  logs = createLoggerMockedComponent({ error: errorLogMock })
  fetcher = createFetchMockedComponent({ fetch: fetchMock })
  config = createConfigMockedComponent({
    requireString: jest.fn().mockImplementation((key) => {
      switch (key) {
        case 'ANALYTICS_CONTEXT':
          return context
        case 'ANALYTICS_API_URL':
          return analyticsApiUrl
        case 'ANALYTICS_API_TOKEN':
          return analyticsApiToken
        case 'ENV':
          return environment
      }
    })
  })
  component = await createAnalyticsComponent({ logs, fetcher, config })
})

describe('when sending an event', () => {
  let eventBody: Record<string, any>
  let eventName: string

  beforeEach(async () => {
    eventName = 'user_login'
    eventBody = {
      userId: '123',
      timestamp: Date.now()
    }
  })

  describe('and the API call succeeds', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200
      })
    })

    it('should send the event to the Analytics API and resolve', async () => {
      await expect(component.sendEvent(eventName, eventBody)).resolves.not.toThrow()

      expect(fetchMock).toHaveBeenCalledWith(analyticsApiUrl, {
        method: 'POST',
        timeout: 10000,
        headers: {
          'x-token': analyticsApiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: eventName,
          body: {
            ...eventBody,
            env: environment
          },
          context: 'test-context'
        })
      })
    })
  })

  describe('and the API call fails with a network error', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Network error')
      fetchMock.mockRejectedValue(error)
    })

    it('should log the error message with the event details and resolve', async () => {
      await expect(component.sendEvent(eventName, eventBody)).resolves.toBeUndefined()

      expect(errorLogMock).toHaveBeenCalledWith('Error sending event to Analytics user_login', {
        error: 'Network error'
      })
    })
  })

  describe('and the API call fails with a non-200 status', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400
      })
    })

    it('should log error message with event details and resolve', async () => {
      await expect(component.sendEvent(eventName, eventBody)).resolves.toBeUndefined()

      expect(errorLogMock).toHaveBeenCalledWith('Error sending event to Analytics user_login', {
        error: 'Got status 400 from the Analytics API'
      })
    })
  })

  describe('and the API call is rejected with a non-Error value', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue('network glitch string')
    })

    it('should log "Unknown error" and resolve', async () => {
      await expect(component.sendEvent(eventName, eventBody)).resolves.toBeUndefined()

      expect(errorLogMock).toHaveBeenCalledWith('Error sending event to Analytics user_login', {
        error: 'Unknown error'
      })
    })
  })
})

describe('when firing an event', () => {
  let eventBody: Record<string, any>
  let eventName: string

  beforeEach(() => {
    eventName = 'user_login'
    eventBody = { userId: '123', timestamp: 1 }
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  it('should dispatch the fetch call without awaiting the response', () => {
    component.fireEvent(eventName, eventBody)

    expect(fetchMock).toHaveBeenCalledWith(analyticsApiUrl, {
      method: 'POST',
      timeout: 10000,
      headers: {
        'x-token': analyticsApiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: eventName,
        body: {
          ...eventBody,
          env: environment
        },
        context: 'test-context'
      })
    })
  })
})

describe('when ANALYTICS_REQUEST_TIMEOUT is configured', () => {
  let eventBody: Record<string, any>
  let eventName: string
  let customTimeout: number

  beforeEach(async () => {
    customTimeout = 5000
    config = createConfigMockedComponent({
      requireString: jest.fn().mockImplementation((key) => {
        switch (key) {
          case 'ANALYTICS_CONTEXT':
            return context
          case 'ANALYTICS_API_URL':
            return analyticsApiUrl
          case 'ANALYTICS_API_TOKEN':
            return analyticsApiToken
          case 'ENV':
            return environment
        }
      }),
      getNumber: jest.fn().mockImplementation((key) =>
        key === 'ANALYTICS_REQUEST_TIMEOUT' ? customTimeout : undefined
      )
    })
    component = await createAnalyticsComponent({ logs, fetcher, config })
    eventName = 'user_login'
    eventBody = { userId: '123' }
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  it('should forward the configured timeout on the fetch call', async () => {
    await component.sendEvent(eventName, eventBody)

    expect(fetchMock).toHaveBeenCalledWith(
      analyticsApiUrl,
      expect.objectContaining({ timeout: customTimeout })
    )
  })
})
