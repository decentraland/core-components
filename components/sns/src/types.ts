import { PublishCommandOutput } from '@aws-sdk/client-sns'

export interface MessageAttribute {
  DataType: string
  StringValue: string
}

export interface CustomMessageAttributes {
  [key: string]: MessageAttribute
}

/**
 * Shape required by the SNS publisher: `type` is mandatory (used as a
 * MessageAttribute and for SNS filter policies), `subType` is optional,
 * and any additional fields are preserved in the published JSON body.
 */
export interface PublishableEvent {
  type: string
  subType?: string
  [key: string]: any
}

export interface IPublisherComponent {
  publishMessage(
    event: PublishableEvent,
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<PublishCommandOutput>
  publishMessages(
    events: PublishableEvent[],
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<{
    successfulMessageIds: string[]
    failedEvents: PublishableEvent[]
  }>
}
