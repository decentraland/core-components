export interface ReceiveMessagesOptions {
  visibilityTimeout?: number
  waitTimeSeconds?: number
  abortSignal?: AbortSignal
}

export interface QueueMessage {
  MessageId: string
  ReceiptHandle: string
  Body: string
}

export interface QueueStatus {
  ApproximateNumberOfMessages: string
  ApproximateNumberOfMessagesNotVisible: string
  ApproximateNumberOfMessagesDelayed: string
}

export interface IQueueComponent {
  sendMessage(message: unknown): Promise<void>
  receiveMessages(amount?: number, options?: ReceiveMessagesOptions): Promise<QueueMessage[]>
  deleteMessage(receiptHandle: string): Promise<void>
  deleteMessages(receiptHandles: string[]): Promise<void>
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>
  changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void>
  getStatus(): Promise<QueueStatus>
}

