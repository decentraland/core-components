import { randomUUID } from 'node:crypto'
import { sleep } from '@dcl/core-commons'
import { IQueueComponent, ReceiveMessagesOptions } from '@dcl/core-commons'
import { MemoryQueueOptions, StoredMessage, QueueMessage } from './types'

/**
 * Creates an in-memory queue component that implements IQueueComponent.
 * This is useful for local development and testing without requiring AWS SQS.
 *
 * @example
 * ```typescript
 * // Simple usage for local development
 * const queue = createMemoryQueueComponent()
 *
 * // Send a message
 * await queue.sendMessage({ type: 'user_created', userId: '123' })
 *
 * // Receive messages
 * const messages = await queue.receiveMessages(10)
 *
 * // Process and delete
 * for (const message of messages) {
 *   console.log(JSON.parse(message.Body))
 *   await queue.deleteMessage(message.ReceiptHandle)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With custom options
 * const queue = createMemoryQueueComponent({
 *   pollingDelayMs: 500,      // Faster polling
 *   wrapInSnsFormat: false    // Don't wrap in SNS format
 * })
 * ```
 */
export function createMemoryQueueComponent(options: MemoryQueueOptions = {}): IQueueComponent {
  const { pollingDelayMs = 1000, wrapInSnsFormat = true } = options

  const queue: Map<string, StoredMessage> = new Map()

  async function sendMessage(message: unknown): Promise<void> {
    const receiptHandle = randomUUID()
    const messageId = randomUUID()

    const body = wrapInSnsFormat ? JSON.stringify({ Message: JSON.stringify(message) }) : JSON.stringify(message)

    queue.set(receiptHandle, {
      MessageId: messageId,
      ReceiptHandle: receiptHandle,
      Body: body,
      visibleAt: Date.now()
    })
  }

  async function receiveMessages(amount: number = 1, options?: ReceiveMessagesOptions): Promise<QueueMessage[]> {
    // Simulate long-polling behavior with configurable delay
    const waitTimeMs = options?.waitTimeSeconds ? options.waitTimeSeconds * 1000 : pollingDelayMs
    await sleep(waitTimeMs)

    const now = Date.now()
    const visibleMessages = Array.from(queue.values())
      .filter((msg) => msg.visibleAt <= now)
      .slice(0, amount)

    // Simulate visibility timeout - messages become invisible after being received
    const visibilityTimeout = options?.visibilityTimeout ?? 30
    for (const msg of visibleMessages) {
      const stored = queue.get(msg.ReceiptHandle)
      if (stored) {
        stored.visibleAt = now + visibilityTimeout * 1000
      }
    }

    return visibleMessages.map((msg) => ({
      MessageId: msg.MessageId,
      ReceiptHandle: msg.ReceiptHandle,
      Body: msg.Body
    }))
  }

  async function deleteMessage(receiptHandle: string): Promise<void> {
    queue.delete(receiptHandle)
  }

  async function deleteMessages(receiptHandles: string[]): Promise<void> {
    for (const receiptHandle of receiptHandles) {
      queue.delete(receiptHandle)
    }
  }

  async function changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void> {
    const message = queue.get(receiptHandle)
    if (message) {
      message.visibleAt = Date.now() + visibilityTimeout * 1000
    }
  }

  async function changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void> {
    const newVisibleAt = Date.now() + visibilityTimeout * 1000
    for (const receiptHandle of receiptHandles) {
      const message = queue.get(receiptHandle)
      if (message) {
        message.visibleAt = newVisibleAt
      }
    }
  }

  async function getStatus(): Promise<{
    ApproximateNumberOfMessages: string
    ApproximateNumberOfMessagesNotVisible: string
    ApproximateNumberOfMessagesDelayed: string
  }> {
    const now = Date.now()
    const allMessages = Array.from(queue.values())

    const visibleCount = allMessages.filter((msg) => msg.visibleAt <= now).length
    const invisibleCount = allMessages.filter((msg) => msg.visibleAt > now).length

    return {
      ApproximateNumberOfMessages: visibleCount.toString(),
      ApproximateNumberOfMessagesNotVisible: invisibleCount.toString(),
      ApproximateNumberOfMessagesDelayed: '0'
    }
  }

  return {
    sendMessage,
    receiveMessages,
    deleteMessage,
    deleteMessages,
    changeMessageVisibility,
    changeMessagesVisibility,
    getStatus
  }
}
