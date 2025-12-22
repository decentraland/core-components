import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createSqsComponent } from '../src/component'
import { IQueueComponent, ReceiveMessagesOptions } from '../src/types'
import {
  ChangeMessageVisibilityBatchCommand,
  ChangeMessageVisibilityCommand,
  Message,
  ReceiveMessageCommand
} from '@aws-sdk/client-sqs'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(),
  SendMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ReceiveMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteMessageBatchCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ChangeMessageVisibilityCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ChangeMessageVisibilityBatchCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  GetQueueAttributesCommand: jest.fn().mockImplementation((params) => ({ input: params }))
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
  let testMessage: { type: string; data: string }

  describe('and the send succeeds', () => {
    beforeEach(() => {
      testMessage = { type: 'test', data: 'test data' }
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
    let mockMessages: Message[]

    beforeEach(() => {
      mockMessages = [
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

  describe('and custom options are provided', () => {
    let options: ReceiveMessagesOptions

    beforeEach(() => {
      sendMock.mockResolvedValue({ Messages: [] })
      options = {}
    })

    describe('and a custom visibility timeout is provided', () => {
      beforeEach(() => {
        options.visibilityTimeout = 120
      })

      it('should use custom visibility timeout', async () => {
        await component.receiveMessages(1, options)

        expect(ReceiveMessageCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            VisibilityTimeout: 120
          })
        )
      })
    })

    describe('and a custom wait time seconds is provided', () => {
      beforeEach(() => {
        options.waitTimeSeconds = 5
      })

      it('should use custom wait time seconds', async () => {
        await component.receiveMessages(1, options)

        expect(ReceiveMessageCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            WaitTimeSeconds: 5
          })
        )
      })
    })

    describe('and an abort signal is provided', () => {
      let controller: AbortController

      beforeEach(() => {
        controller = new AbortController()
        options.abortSignal = controller.signal
      })

      it('should pass abort signal to the client', async () => {
        await component.receiveMessages(1, options)

        expect(sendMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            abortSignal: controller.signal
          })
        )
      })
    })

    describe('and no options are provided', () => {
      it('should use default values', async () => {
        await component.receiveMessages(1)

        expect(ReceiveMessageCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            VisibilityTimeout: 60,
            WaitTimeSeconds: 20
          })
        )
      })
    })
  })

  describe('and the request is aborted', () => {
    it('should throw an abort error', async () => {
      const controller = new AbortController()
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'

      sendMock.mockRejectedValue(abortError)
      controller.abort()

      await expect(component.receiveMessages(1, { abortSignal: controller.signal })).rejects.toThrow(
        'The operation was aborted'
      )
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

describe('when changing message visibility', () => {
  const receiptHandle = 'test-receipt-handle'

  describe('and the change succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should change message visibility successfully', async () => {
      await component.changeMessageVisibility(receiptHandle, 0)

      expect(ChangeMessageVisibilityCommand).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0
      })
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('should set visibility timeout to the specified value', async () => {
      await component.changeMessageVisibility(receiptHandle, 300)

      expect(ChangeMessageVisibilityCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          VisibilityTimeout: 300
        })
      )
    })
  })

  describe('and the change fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('SQS change visibility failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.changeMessageVisibility(receiptHandle, 0)).rejects.toThrow('SQS change visibility failed')
    })
  })
})

describe('when changing visibility for multiple messages', () => {
  describe('and changing visibility for messages within batch size', () => {
    const receiptHandles = ['receipt-1', 'receipt-2', 'receipt-3']

    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should change visibility for all messages in a single batch', async () => {
      await component.changeMessagesVisibility(receiptHandles, 0)

      expect(ChangeMessageVisibilityBatchCommand).toHaveBeenCalledTimes(1)
      expect(ChangeMessageVisibilityBatchCommand).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        Entries: [
          { Id: 'msg_0', ReceiptHandle: 'receipt-1', VisibilityTimeout: 0 },
          { Id: 'msg_1', ReceiptHandle: 'receipt-2', VisibilityTimeout: 0 },
          { Id: 'msg_2', ReceiptHandle: 'receipt-3', VisibilityTimeout: 0 }
        ]
      })
    })
  })

  describe('and changing visibility for messages exceeding batch size', () => {
    const receiptHandles = Array.from({ length: 15 }, (_, i) => `receipt-${i}`)

    beforeEach(() => {
      sendMock.mockResolvedValue({})
      ;(ChangeMessageVisibilityBatchCommand as unknown as jest.Mock).mockClear()
    })

    it('should split messages into multiple batches of 10', async () => {
      await component.changeMessagesVisibility(receiptHandles, 120)

      expect(ChangeMessageVisibilityBatchCommand).toHaveBeenCalledTimes(2)

      // First batch with 10 messages
      expect(ChangeMessageVisibilityBatchCommand).toHaveBeenNthCalledWith(1, {
        QueueUrl: queueUrl,
        Entries: expect.arrayContaining([
          expect.objectContaining({ Id: 'msg_0', ReceiptHandle: 'receipt-0', VisibilityTimeout: 120 })
        ])
      })

      // Second batch with 5 messages
      expect(ChangeMessageVisibilityBatchCommand).toHaveBeenNthCalledWith(2, {
        QueueUrl: queueUrl,
        Entries: expect.arrayContaining([
          expect.objectContaining({ Id: 'msg_0', ReceiptHandle: 'receipt-10', VisibilityTimeout: 120 })
        ])
      })
    })
  })

  describe('and the batch change fails', () => {
    const receiptHandles = ['receipt-1', 'receipt-2']

    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('SQS batch change visibility failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.changeMessagesVisibility(receiptHandles, 0)).rejects.toThrow(
        'SQS batch change visibility failed'
      )
    })
  })
})

describe('when handling different message types', () => {
  let message: any

  beforeEach(() => {
    sendMock.mockResolvedValue({ MessageId: 'msg-123' })
  })

  describe('and the message is a string', () => {
    beforeEach(() => {
      message = 'simple string message'
    })

    it('should send the message successfully', async () => {
      await component.sendMessage(message)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the message is an object', () => {
    beforeEach(() => {
      message = { id: 1, name: 'test', active: true }
    })

    it('should send the message successfully', async () => {
      await component.sendMessage(message)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the message is an array', () => {
    beforeEach(() => {
      message = [1, 2, 3, 'test']
    })

    it('should send the message successfully', async () => {
      await component.sendMessage(message)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the message is null', () => {
    beforeEach(() => {
      message = null
    })

    it('should send the message successfully', async () => {
      await component.sendMessage(message)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })
})
