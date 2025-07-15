import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createSlackComponent } from '../src/component'
import { SlackMessage } from '../src/types'
import { IncomingWebhook } from '@slack/webhook'
import { WebClient } from '@slack/web-api'

jest.mock('@slack/webhook')
jest.mock('@slack/web-api')

let logs: ILoggerComponent
let mockWebhook: jest.Mocked<IncomingWebhook>
let mockClient: jest.Mocked<WebClient>
let infoLogMock: jest.Mock

describe('when creating a slack component', () => {
  let slackComponent: ReturnType<typeof createSlackComponent>
  let token: string

  beforeEach(() => {
    infoLogMock = jest.fn()
    logs = createLoggerMockedComponent({ info: infoLogMock })
    mockWebhook = {
      send: jest.fn().mockResolvedValue({})
    } as unknown as jest.Mocked<IncomingWebhook>
    mockClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({})
      }
    } as unknown as jest.Mocked<WebClient>
    ;(IncomingWebhook as unknown as jest.Mock).mockImplementation(() => mockWebhook)
    ;(WebClient as unknown as jest.Mock).mockImplementation(() => mockClient)
  })

  describe('and using webhook configuration', () => {
    let webhookUrl: string
    let message: SlackMessage

    beforeEach(() => {
      webhookUrl = 'https://hooks.slack.com/services/test'
      slackComponent = createSlackComponent({ logs }, { webhookUrl })
      message = {
        text: 'Test message',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }]
      }
    })

    it('should send message via webhook', async () => {
      await slackComponent.sendMessage(message)

      expect(mockWebhook.send).toHaveBeenCalledWith({
        text: 'Test message',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }]
      })
    })
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

  describe('and no configuration provided', () => {
    beforeEach(() => {
      slackComponent = createSlackComponent({ logs }, {})
    })

    it('should throw error when sending message', async () => {
      await expect(slackComponent.sendMessage({ text: 'test' })).rejects.toThrow('No webhook URL or token provided')
    })
  })

  describe('and using token without channel', () => {
    beforeEach(() => {
      token = 'xoxb-test-token'
      slackComponent = createSlackComponent({ logs }, { token })
    })

    it('should throw error when channel is missing', async () => {
      await expect(slackComponent.sendMessage({ text: 'test' })).rejects.toThrow('Channel is required when using token')
    })
  })
})
