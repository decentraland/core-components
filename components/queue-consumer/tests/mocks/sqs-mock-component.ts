import { IQueueComponent } from '@dcl/sqs-component'

export function createMockSqsComponent(
  overrides?: Partial<jest.Mocked<IQueueComponent>>
): jest.Mocked<IQueueComponent> {
  return {
    sendMessage: overrides?.sendMessage ?? jest.fn<Promise<void>, [any]>().mockResolvedValue(undefined),
    receiveMessages: overrides?.receiveMessages ?? jest.fn<Promise<any[]>, [number?, any?]>().mockResolvedValue([]),
    deleteMessage: overrides?.deleteMessage ?? jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    deleteMessages: overrides?.deleteMessages ?? jest.fn<Promise<void>, [string[]]>().mockResolvedValue(undefined),
    changeMessageVisibility:
      overrides?.changeMessageVisibility ?? jest.fn<Promise<void>, [string, number]>().mockResolvedValue(undefined),
    changeMessagesVisibility:
      overrides?.changeMessagesVisibility ?? jest.fn<Promise<void>, [string[], number]>().mockResolvedValue(undefined),
    getStatus:
      overrides?.getStatus ??
      jest.fn<Promise<any>, []>().mockResolvedValue({
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      })
  }
}
