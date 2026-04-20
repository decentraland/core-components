import { PublishBatchCommand, PublishCommand, SNSClient, PublishCommandOutput } from '@aws-sdk/client-sns'
import { IConfigComponent } from '@well-known-components/interfaces'

import { IPublisherComponent, CustomMessageAttributes, MessageAttribute } from './types'

function chunk<T>(theArray: T[], size: number): T[][] {
  return theArray.reduce((acc: T[][], _, i) => {
    if (i % size === 0) {
      acc.push(theArray.slice(i, i + size))
    }
    return acc
  }, [])
}

function validateCustomAttributes(customMessageAttributes?: CustomMessageAttributes): void {
  if (!customMessageAttributes) {
    return
  }

  const reservedKeys = ['type', 'subType']
  const invalidKeys = Object.keys(customMessageAttributes).filter((key) => reservedKeys.includes(key))

  if (invalidKeys.length > 0) {
    throw new Error(
      `Cannot override reserved message attributes: ${invalidKeys.join(', ')}. These attributes are automatically set from the event object.`
    )
  }
}

function buildMessageAttributes(
  event: { type: string; subType?: string },
  customMessageAttributes?: CustomMessageAttributes
): Record<string, MessageAttribute> {
  const attributes: Record<string, MessageAttribute> = {
    type: { DataType: 'String', StringValue: event.type }
  }

  if (event.subType !== undefined) {
    attributes.subType = { DataType: 'String', StringValue: event.subType }
  }

  return { ...attributes, ...customMessageAttributes }
}

export async function createSnsComponent({ config }: { config: IConfigComponent }): Promise<IPublisherComponent> {
  // SNS PublishBatch can handle up to 10 messages in a single request
  const MAX_BATCH_SIZE = 10
  const snsArn = await config.requireString('AWS_SNS_ARN')
  const optionalEndpoint = await config.getString('AWS_SNS_ENDPOINT')

  const client = new SNSClient({
    endpoint: optionalEndpoint ? optionalEndpoint : undefined
  })

  async function publishMessage(
    event: {
      type: string
      subType?: string
      [key: string]: any
    },
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<PublishCommandOutput> {
    validateCustomAttributes(customMessageAttributes)

    const command = new PublishCommand({
      TopicArn: snsArn,
      Message: JSON.stringify(event),
      MessageAttributes: buildMessageAttributes(event, customMessageAttributes)
    })
    return client.send(command)
  }

  async function publishMessages(
    events: Array<{ type: string; subType?: string; [key: string]: any }>,
    customMessageAttributes?: CustomMessageAttributes
  ): Promise<{
    successfulMessageIds: string[]
    failedEvents: Array<{ type: string; subType?: string; [key: string]: any }>
  }> {
    validateCustomAttributes(customMessageAttributes)

    const batches = chunk(events, MAX_BATCH_SIZE)

    const publishBatchPromises = batches.map(async (batch) => {
      const entries = batch.map((event, index) => ({
        Id: `msg_${index}`,
        Message: JSON.stringify(event),
        MessageAttributes: buildMessageAttributes(event, customMessageAttributes)
      }))

      const command = new PublishBatchCommand({
        TopicArn: snsArn,
        PublishBatchRequestEntries: entries
      })

      const { Successful, Failed } = await client.send(command)

      const successfulMessageIds: string[] =
        Successful?.flatMap((result) => (result.MessageId ? [result.MessageId] : [])) ?? []

      const failedEvents: Array<{ type: string; subType?: string; [key: string]: any }> =
        Failed?.flatMap((failure) => {
          const localIndex = failure.Id ? parseInt(failure.Id.slice('msg_'.length), 10) : NaN
          const failedEvent = Number.isInteger(localIndex) ? batch[localIndex] : undefined
          return failedEvent ? [failedEvent] : []
        }) ?? []

      return { successfulMessageIds, failedEvents }
    })

    const results = await Promise.allSettled(publishBatchPromises)

    const successfulMessageIds: string[] = []
    const failedEvents: Array<{ type: string; subType?: string; [key: string]: any }> = []

    results.forEach((result, batchIndex) => {
      if (result.status === 'fulfilled') {
        successfulMessageIds.push(...result.value.successfulMessageIds)
        failedEvents.push(...result.value.failedEvents)
      } else {
        // A batch that rejected (e.g. network failure, throttling) fails in full;
        // treat every event in the batch as failed so callers can retry them.
        failedEvents.push(...batches[batchIndex])
      }
    })

    return { successfulMessageIds, failedEvents }
  }

  return { publishMessage, publishMessages }
}
