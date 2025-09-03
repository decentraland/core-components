export interface IPublisherComponent {
  publishMessages(events: any[]): Promise<{
    successfulMessageIds: string[]
    failedEvents: any[]
  }>
}
