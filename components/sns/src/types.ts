import { PublishCommandOutput } from '@aws-sdk/client-sns'

export interface MessageAttribute {
  DataType: string
  StringValue: string
}

export interface CustomMessageAttributes {
  [key: string]: MessageAttribute
}

export interface IPublisherComponent {
  publishMessage(
    event: any,
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<PublishCommandOutput>
  publishMessages(
    events: any[],
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<{
    successfulMessageIds: string[]
    failedEvents: any[]
  }>
}
