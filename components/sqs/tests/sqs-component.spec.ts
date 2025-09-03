import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createSqsComponent } from '../src/component'
import { IQueueComponent } from '../src/types'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(),
  SendMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ReceiveMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteMessageCommand: jest.fn().mockImplementation((params) => ({ input: params }))
}))

let config: IConfigComponent
let component: IQueueComponent
let mockSqsClient: any
let sendMock: jest.Mock
let queueUrl: string
let sqsEndpoint: string

beforeEach(async () => {
  queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'
  sqsEndpoint = 'http://localhost:4566'
  sendMock = jest.fn()

  mockSqsClient = {
    send: sendMock
  }

  const { SQSClient } = require('@aws-sdk/client-sqs')
  SQSClient.mockImplementation(() => mockSqsClient)

  config = createConfigMockedComponent({
    requireString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_SQS_QUEUE_URL':
          return queueUrl
        default:
          throw new Error(`Unknown key: ${key}`)
      }
    }),
    getString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_SQS_ENDPOINT':
          return sqsEndpoint
        default:
          return undefined
      }
    })
  })

  component = await createSqsComponent(config)
})

describe('when sending messages', () => {
  const testMessage = { type: 'test', data: 'test data' }

  describe('and the send succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({ MessageId: 'msg-123' })
    })

    it('should send the message successfully', async () => {
      await expect(component.sendMessage(testMessage)).resolves.not.toThrow()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the send fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('SQS send failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.sendMessage(testMessage)).rejects.toThrow('SQS send failed')
    })
  })
})

describe('when receiving messages', () => {
  describe('and messages are available', () => {
    const mockMessages = [
      {
        MessageId: 'msg-1',
        Body: JSON.stringify({ Message: JSON.stringify({ type: 'test1' }) }),
        ReceiptHandle: 'receipt-1'
      },
      {
        MessageId: 'msg-2',
        Body: JSON.stringify({ Message: JSON.stringify({ type: 'test2' }) }),
        ReceiptHandle: 'receipt-2'
      }
    ]

    beforeEach(() => {
      sendMock.mockResolvedValue({
        Messages: mockMessages
      })
    })

    it('should receive messages with default amount', async () => {
      const messages = await component.receiveMessages()

      expect(messages).toHaveLength(2)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('should receive messages with specified amount', async () => {
      const messages = await component.receiveMessages(5)

      expect(messages).toHaveLength(2)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and no messages are available', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should return empty array', async () => {
      const messages = await component.receiveMessages()

      expect(messages).toEqual([])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the receive fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('SQS receive failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.receiveMessages()).rejects.toThrow('SQS receive failed')
    })
  })
})

describe('when deleting messages', () => {
  const receiptHandle = 'test-receipt-handle'

  describe('and the delete succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should delete the message successfully', async () => {
      await expect(component.deleteMessage(receiptHandle)).resolves.not.toThrow()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the delete fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('SQS delete failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.deleteMessage(receiptHandle)).rejects.toThrow('SQS delete failed')
    })
  })
})

describe('when handling different message types', () => {
  beforeEach(() => {
    sendMock.mockResolvedValue({ MessageId: 'msg-123' })
  })

  it('should handle string messages', async () => {
    const message = 'simple string message'
    await component.sendMessage(message)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('should handle object messages', async () => {
    const message = { id: 1, name: 'test', active: true }
    await component.sendMessage(message)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('should handle array messages', async () => {
    const message = [1, 2, 3, 'test']
    await component.sendMessage(message)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('should handle null and undefined messages', async () => {
    await component.sendMessage(null)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
