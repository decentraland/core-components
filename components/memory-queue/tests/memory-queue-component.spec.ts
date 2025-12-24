import { createMemoryQueueComponent } from '../src/component'

describe('createMemoryQueueComponent', () => {
  describe('sendMessage', () => {
    it('should send a message to the queue', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test', data: 'hello' })

      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
    })

    it('should wrap message in SNS format by default', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test' })

      const messages = await queue.receiveMessages(1)
      expect(messages).toHaveLength(1)

      const body = JSON.parse(messages[0].Body)
      expect(body).toHaveProperty('Message')

      const innerMessage = JSON.parse(body.Message)
      expect(innerMessage).toEqual({ type: 'test' })
    })

    it('should not wrap in SNS format when wrapInSnsFormat is false', async () => {
      const queue = createMemoryQueueComponent({
        pollingDelayMs: 10,
        wrapInSnsFormat: false
      })

      await queue.sendMessage({ type: 'test' })

      const messages = await queue.receiveMessages(1)
      expect(messages).toHaveLength(1)

      const body = JSON.parse(messages[0].Body)
      expect(body).toEqual({ type: 'test' })
    })

    it('should generate unique MessageId and ReceiptHandle for each message', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ id: 1 })
      await queue.sendMessage({ id: 2 })

      const messages = await queue.receiveMessages(2)
      expect(messages).toHaveLength(2)
      expect(messages[0].MessageId).not.toBe(messages[1].MessageId)
      expect(messages[0].ReceiptHandle).not.toBe(messages[1].ReceiptHandle)
    })
  })

  describe('receiveMessages', () => {
    it('should receive messages from the queue', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })

      const messages = await queue.receiveMessages(2)
      expect(messages).toHaveLength(2)
    })

    it('should limit the number of messages received', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })
      await queue.sendMessage({ type: 'test3' })

      const messages = await queue.receiveMessages(2)
      expect(messages).toHaveLength(2)
    })

    it('should return empty array when queue is empty', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      const messages = await queue.receiveMessages(10)
      expect(messages).toEqual([])
    })

    it('should make messages invisible after receiving', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test' })

      // First receive should get the message
      const messages1 = await queue.receiveMessages(1, { visibilityTimeout: 60 })
      expect(messages1).toHaveLength(1)

      // Second receive should get nothing (message is invisible)
      const messages2 = await queue.receiveMessages(1)
      expect(messages2).toHaveLength(0)

      // Status should show 0 visible, 1 invisible
      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('0')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('1')
    })

    it('should default to 1 message when amount not specified', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })

      const messages = await queue.receiveMessages()
      expect(messages).toHaveLength(1)
    })
  })

  describe('deleteMessage', () => {
    it('should delete a message from the queue', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test' })
      const messages = await queue.receiveMessages(1)
      expect(messages).toHaveLength(1)

      await queue.deleteMessage(messages[0].ReceiptHandle)

      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('0')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })

    it('should not throw when deleting non-existent message', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await expect(queue.deleteMessage('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('deleteMessages', () => {
    it('should delete multiple messages from the queue', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })
      await queue.sendMessage({ type: 'test3' })

      const messages = await queue.receiveMessages(3)
      expect(messages).toHaveLength(3)

      await queue.deleteMessages(messages.map((m) => m.ReceiptHandle))

      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('0')
    })

    it('should handle empty array', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await expect(queue.deleteMessages([])).resolves.toBeUndefined()
    })
  })

  describe('changeMessageVisibility', () => {
    it('should change visibility timeout of a message', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test' })
      const messages = await queue.receiveMessages(1, { visibilityTimeout: 300 })

      // Message is invisible
      let status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('1')

      // Make it visible immediately
      await queue.changeMessageVisibility(messages[0].ReceiptHandle, 0)

      // Now it should be visible again
      status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })

    it('should not throw when changing visibility of non-existent message', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await expect(queue.changeMessageVisibility('non-existent', 60)).resolves.toBeUndefined()
    })
  })

  describe('changeMessagesVisibility', () => {
    it('should change visibility timeout of multiple messages', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })

      const messages = await queue.receiveMessages(2, { visibilityTimeout: 300 })

      // Messages are invisible
      let status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('2')

      // Make them visible immediately
      await queue.changeMessagesVisibility(
        messages.map((m) => m.ReceiptHandle),
        0
      )

      // Now they should be visible again
      status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('2')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })

    it('should handle empty array', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await expect(queue.changeMessagesVisibility([], 60)).resolves.toBeUndefined()
    })
  })

  describe('getStatus', () => {
    it('should return correct counts for empty queue', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      const status = await queue.getStatus()
      expect(status).toEqual({
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      })
    })

    it('should return correct counts for queue with visible messages', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })

      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('2')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('0')
    })

    it('should correctly distinguish visible and invisible messages', async () => {
      const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

      await queue.sendMessage({ type: 'test1' })
      await queue.sendMessage({ type: 'test2' })
      await queue.sendMessage({ type: 'test3' })

      // Receive 2 messages (they become invisible)
      await queue.receiveMessages(2, { visibilityTimeout: 300 })

      const status = await queue.getStatus()
      expect(status.ApproximateNumberOfMessages).toBe('1')
      expect(status.ApproximateNumberOfMessagesNotVisible).toBe('2')
    })
  })

  describe('options', () => {
    it('should use custom pollingDelayMs', async () => {
      const startTime = Date.now()
      const queue = createMemoryQueueComponent({ pollingDelayMs: 50 })

      await queue.receiveMessages(1)
      const elapsed = Date.now() - startTime

      // Should have waited approximately 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40)
      expect(elapsed).toBeLessThan(200)
    })

    it('should use waitTimeSeconds from options when provided', async () => {
      const startTime = Date.now()
      const queue = createMemoryQueueComponent({ pollingDelayMs: 1000 })

      // waitTimeSeconds should override pollingDelayMs
      await queue.receiveMessages(1, { waitTimeSeconds: 0.05 })
      const elapsed = Date.now() - startTime

      // Should have waited approximately 50ms (0.05 * 1000), not 1000ms
      expect(elapsed).toBeGreaterThanOrEqual(40)
      expect(elapsed).toBeLessThan(500)
    })
  })
})

