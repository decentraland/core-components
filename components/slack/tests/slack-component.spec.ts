import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createSlackComponent } from '../src/component'
import { SlackMessage } from '../src/types'
import { WebClient } from '@slack/web-api'

jest.mock('@slack/web-api')

let logs: ILoggerComponent
let mockClient: jest.Mocked<WebClient>
let infoLogMock: jest.Mock

describe('when creating a slack component', () => {
  let slackComponent: ReturnType<typeof createSlackComponent>
  let token: string

  beforeEach(() => {
    infoLogMock = jest.fn()
    logs = createLoggerMockedComponent({ info: infoLogMock })
    mockClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({})
      }
    } as unknown as jest.Mocked<WebClient>
    ;(WebClient as unknown as jest.Mock).mockImplementation(() => mockClient)
  })

  describe('and using token configuration', () => {
    let message: SlackMessage

    beforeEach(() => {
      token = 'xoxb-test-token'
      slackComponent = createSlackComponent({ logs }, { token })
      message = {
        text: 'Test message',
        channel: 'test-channel',
        username: 'Test Bot',
        icon_emoji: ':rocket:',
        icon_url: 'https://example.com/icon.png',
        thread_ts: '1234567890.123456',
        reply_broadcast: true,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }],
        attachments: [{ color: '#36a64f', text: 'Attachment' }]
      }
    })

    it('should send message via API with all fields', async () => {
      await slackComponent.sendMessage(message)

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: 'Test message',
        username: 'Test Bot',
        icon_emoji: ':rocket:',
        icon_url: 'https://example.com/icon.png',
        thread_ts: '1234567890.123456',
        reply_broadcast: true,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }],
        attachments: [{ color: '#36a64f', text: 'Attachment' }]
      })
    })
  })

  describe('and no token provided', () => {
    it('should throw error when creating component', () => {
      expect(() => createSlackComponent({ logs }, { token: '' })).toThrow('No token provided')
    })
  })

  describe('and API call fails', () => {
    let message: SlackMessage

    beforeEach(() => {
      token = 'xoxb-test-token'
      slackComponent = createSlackComponent({ logs }, { token })
      message = {
        text: 'Test message',
        channel: 'test-channel'
      }
      ;(mockClient.chat.postMessage as jest.Mock).mockRejectedValueOnce(new Error('API Error'))
    })

    it('should throw error with failure message', async () => {
      await expect(slackComponent.sendMessage(message)).rejects.toThrow('Failed to send message: Error: API Error')
    })
  })
})
