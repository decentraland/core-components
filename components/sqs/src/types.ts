export interface ReceiveMessagesOptions {
  visibilityTimeout?: number
  waitTimeSeconds?: number
  abortSignal?: AbortSignal
}

export interface IQueueComponent {
  sendMessage(message: any): Promise<void>
  receiveMessages(amount?: number, options?: ReceiveMessagesOptions): Promise<any[]>
  deleteMessage(receiptHandle: string): Promise<void>
  deleteMessages(receiptHandles: string[]): Promise<void>
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>
  changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void>
  getStatus(): Promise<{
    ApproximateNumberOfMessages: string
    ApproximateNumberOfMessagesNotVisible: string
    ApproximateNumberOfMessagesDelayed: string
  }>
}
