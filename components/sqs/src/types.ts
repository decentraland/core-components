export interface IQueueComponent {
  sendMessage(message: any): Promise<void>
  receiveMessages(amount?: number): Promise<any[]>
  deleteMessage(receiptHandle: string): Promise<void>
  deleteMessages(receiptHandles: string[]): Promise<void>
  getStatus(): Promise<{
    ApproximateNumberOfMessages: string
    ApproximateNumberOfMessagesNotVisible: string
    ApproximateNumberOfMessagesDelayed: string
  }>
}
