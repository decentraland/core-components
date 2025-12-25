import { createMemoryQueueComponent } from '../src/component'
import type { IQueueComponent, ReceiveMessagesOptions } from '@dcl/core-commons'

let component: IQueueComponent

beforeEach(() => {
  component = createMemoryQueueComponent({ pollingDelayMs: 10 })
})

describe('when sending messages', () => {
  describe('and a message is sent', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test', data: 'hello' })
    })

    it('should add the message to the queue', async () => {
      const status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
    })
  })

  describe('and wrapInSnsFormat is enabled (default)', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test' })
    })

    it('should wrap message in SNS format', async () => {
      const messages = await component.receiveMessages(1)
      expect(messages).toHaveLength(1)

      const body = JSON.parse(messages[0].Body)
      expect(body).toHaveProperty('Message')

      const innerMessage = JSON.parse(body.Message)
      expect(innerMessage).toEqual({ type: 'test' })
    })
  })

  describe('and wrapInSnsFormat is disabled', () => {
    beforeEach(() => {
      component = createMemoryQueueComponent({
        pollingDelayMs: 10,
        wrapInSnsFormat: false
      })
    })

    it('should not wrap message in SNS format', async () => {
      await component.sendMessage({ type: 'test' })

      const messages = await component.receiveMessages(1)
      expect(messages).toHaveLength(1)

      const body = JSON.parse(messages[0].Body)
      expect(body).toEqual({ type: 'test' })
    })
  })

  describe('and multiple messages are sent', () => {
    beforeEach(async () => {
      await component.sendMessage({ id: 1 })
      await component.sendMessage({ id: 2 })
    })

    it('should generate unique MessageId for each message', async () => {
      const messages = await component.receiveMessages(2)
      expect(messages).toHaveLength(2)
      expect(messages[0].MessageId).not.toBe(messages[1].MessageId)
    })

    it('should generate unique ReceiptHandle for each message', async () => {
      const messages = await component.receiveMessages(2)
      expect(messages).toHaveLength(2)
      expect(messages[0].ReceiptHandle).not.toBe(messages[1].ReceiptHandle)
    })
  })
})

describe('when receiving messages', () => {
  describe('and messages are available', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
    })

    it('should receive messages from the queue', async () => {
      const messages = await component.receiveMessages(2)
      expect(messages).toHaveLength(2)
    })
  })

  describe('and requesting more messages than available', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
      await component.sendMessage({ type: 'test3' })
    })

    it('should limit the number of messages received', async () => {
      const messages = await component.receiveMessages(2)
      expect(messages).toHaveLength(2)
    })
  })

  describe('and no messages are available', () => {
    it('should return empty array', async () => {
      const messages = await component.receiveMessages(10)
      expect(messages).toEqual([])
    })
  })

  describe('and no amount is specified', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
    })

    it('should default to 1 message', async () => {
      const messages = await component.receiveMessages()
      expect(messages).toHaveLength(1)
    })
  })

  describe('and custom options are provided', () => {
    let options: ReceiveMessagesOptions

    beforeEach(async () => {
      await component.sendMessage({ type: 'test' })
      options = {}
    })

    describe('and a custom visibility timeout is provided', () => {
      beforeEach(() => {
        options.visibilityTimeout = 60
      })

      it('should make message invisible after receiving', async () => {
        const messages1 = await component.receiveMessages(1, options)
        expect(messages1).toHaveLength(1)

        const messages2 = await component.receiveMessages(1)
        expect(messages2).toHaveLength(0)

        const status = await component.getStatus()
        expect(status.ApproximateNumberOfMessages).toBe('0')
        expect(status.ApproximateNumberOfMessagesNotVisible).toBe('1')
      })
    })

    describe('and a custom wait time seconds is provided', () => {
      it('should override the polling delay', async () => {
        component = createMemoryQueueComponent({ pollingDelayMs: 1000 })

        const startTime = Date.now()
        await component.receiveMessages(1, { waitTimeSeconds: 0.05 })
        const elapsed = Date.now() - startTime

        expect(elapsed).toBeGreaterThanOrEqual(40)
        expect(elapsed).toBeLessThan(500)
      })
    })
  })
})

describe('when deleting messages', () => {
  describe('and the message exists', () => {
    let receiptHandle: string

    beforeEach(async () => {
      await component.sendMessage({ type: 'test' })
      const messages = await component.receiveMessages(1)
      receiptHandle = messages[0].ReceiptHandle
    })

    it('should delete the message successfully', async () => {
      await component.deleteMessage(receiptHandle)

      const status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('0')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })
  })

  describe('and the message does not exist', () => {
    it('should not throw', async () => {
      await expect(component.deleteMessage('non-existent')).resolves.toBeUndefined()
    })
  })
})

describe('when deleting multiple messages', () => {
  describe('and the messages exist', () => {
    let receiptHandles: string[]

    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
      await component.sendMessage({ type: 'test3' })

      const messages = await component.receiveMessages(3)
      receiptHandles = messages.map((m) => m.ReceiptHandle)
    })

    it('should delete all messages successfully', async () => {
      await component.deleteMessages(receiptHandles)

      const status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('0')
    })
  })

  describe('and an empty array is provided', () => {
    it('should not throw', async () => {
      await expect(component.deleteMessages([])).resolves.toBeUndefined()
    })
  })
})

describe('when changing message visibility', () => {
  describe('and the message exists', () => {
    let receiptHandle: string

    beforeEach(async () => {
      await component.sendMessage({ type: 'test' })
      const messages = await component.receiveMessages(1, { visibilityTimeout: 300 })
      receiptHandle = messages[0].ReceiptHandle
    })

    it('should change visibility timeout successfully', async () => {
      let status = await component.getStatus()
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('1')

      await component.changeMessageVisibility(receiptHandle, 0)

      status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })
  })

  describe('and the message does not exist', () => {
    it('should not throw', async () => {
      await expect(component.changeMessageVisibility('non-existent', 60)).resolves.toBeUndefined()
    })
  })
})

describe('when changing visibility for multiple messages', () => {
  describe('and the messages exist', () => {
    let receiptHandles: string[]

    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })

      const messages = await component.receiveMessages(2, { visibilityTimeout: 300 })
      receiptHandles = messages.map((m) => m.ReceiptHandle)
    })

    it('should change visibility timeout for all messages', async () => {
      let status = await component.getStatus()
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('2')

      await component.changeMessagesVisibility(receiptHandles, 0)

      status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('2')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })
  })

  describe('and an empty array is provided', () => {
    it('should not throw', async () => {
      await expect(component.changeMessagesVisibility([], 60)).resolves.toBeUndefined()
    })
  })
})

describe('when getting queue status', () => {
  describe('and the queue is empty', () => {
    it('should return correct counts', async () => {
      const status = await component.getStatus()
      expect(status).toEqual({
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      })
    })
  })

  describe('and there are visible messages', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
    })

    it('should return correct visible count', async () => {
      const status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('2')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })
  })

  describe('and there are both visible and invisible messages', () => {
    beforeEach(async () => {
      await component.sendMessage({ type: 'test1' })
      await component.sendMessage({ type: 'test2' })
      await component.sendMessage({ type: 'test3' })

      await component.receiveMessages(2, { visibilityTimeout: 300 })
    })

    it('should correctly distinguish visible and invisible messages', async () => {
      const status = await component.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('2')
    })
  })
})

describe('when configuring the component', () => {
  describe('and a custom pollingDelayMs is provided', () => {
    it('should use the custom polling delay', async () => {
      component = createMemoryQueueComponent({ pollingDelayMs: 50 })

      const startTime = Date.now()
      await component.receiveMessages(1)
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeGreaterThanOrEqual(40)
      expect(elapsed).toBeLessThan(200)
    })
  })
})
