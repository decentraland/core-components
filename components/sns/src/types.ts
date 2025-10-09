import { PublishCommandOutput } from '@aws-sdk/client-sns'

export interface IPublisherComponent {
  publishMessage(event: any): Promise<PublishCommandOutput>
  publishMessages(events: any[]): Promise<{
    successfulMessageIds: string[]
    failedEvents: any[]
  }>
}
