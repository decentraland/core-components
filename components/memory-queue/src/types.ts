import { IQueueComponent, QueueStatus, ReceiveMessagesOptions } from '@dcl/core-commons'

/**
 * Options for configuring the in-memory queue component
 */
export type MemoryQueueOptions = {
  /**
   * Delay in milliseconds when polling for messages.
   * Used to prevent blocking the main thread in a polling loop.
   * @default 1000
   */
  pollingDelayMs?: number

  /**
   * Whether to wrap the message body in SNS format ({ Message: JSON.stringify(message) }).
   * Set to true for compatibility with the SQS component message format.
   * @default true
   */
  wrapInSnsFormat?: boolean
}

/**
 * A message from a queue.
 */
export type QueueMessage = {
  MessageId: string
  ReceiptHandle: string
  Body: string
}

export type StoredMessage = QueueMessage & {
  visibleAt: number
}

export type { IQueueComponent, ReceiveMessagesOptions, QueueStatus }
