import { ILoggerComponent, IFetchComponent } from '@well-known-components/interfaces'
import { createFetchMockedComponent, createLoggerMockedComponent } from '@dcl/core-commons'
import { createAnalyticsComponent } from '../src/component'
import { IAnalyticsComponent, AnalyticsEvent, Environment } from '../src/types'

let logs: ILoggerComponent
let fetch: IFetchComponent
let component: IAnalyticsComponent
let analyticsApiUrl: string
let analyticsApiToken: string
let environment: Environment
let fetchMock: jest.Mock
let errorLogMock: jest.Mock

beforeEach(async () => {
  analyticsApiUrl = 'https://analytics.example.com/events'
  analyticsApiToken = 'test-token-123'
  environment = 'dev'
  fetchMock = jest.fn()
  errorLogMock = jest.fn()
  logs = createLoggerMockedComponent({ error: errorLogMock })
  fetch = createFetchMockedComponent({ fetch: fetchMock })
  component = await createAnalyticsComponent(
    { logs, fetch },
    'test-context',
    environment,
    analyticsApiUrl,
    analyticsApiToken
  )
})

describe('when sending an event', () => {
  let testEvent: AnalyticsEvent

  beforeEach(async () => {
    testEvent = {
      event: 'user_login',
      body: {
        userId: '123',
        timestamp: Date.now()
      }
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
      await expect(component.sendEvent(testEvent)).resolves.not.toThrow()

      expect(fetchMock).toHaveBeenCalledWith(analyticsApiUrl, {
        method: 'POST',
        headers: {
          'x-token': analyticsApiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...testEvent,
          context: 'test-context',
          body: {
            ...testEvent.body,
            env: environment
          }
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
      await component.sendEvent(testEvent)

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
      await component.sendEvent(testEvent)

      expect(errorLogMock).toHaveBeenCalledWith('Error sending event to Analytics user_login', {
        error: 'Got status 400 from the Analytics API'
      })
    })
  })
})
