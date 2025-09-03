export interface IQueueComponent {
  send(message: any): Promise<void>
  receiveMessages(amount?: number): Promise<any[]>
  deleteMessage(receiptHandle: string): Promise<void>
}
