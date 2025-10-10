import { PublishBatchCommand, PublishCommand, SNSClient, PublishCommandOutput } from '@aws-sdk/client-sns'
import { IConfigComponent } from '@well-known-components/interfaces'

import { IPublisherComponent, CustomMessageAttributes } from './types'

function chunk<T>(theArray: T[], size: number): T[][] {
  return theArray.reduce((acc: T[][], _, i) => {
    if (i % size === 0) {
      acc.push(theArray.slice(i, i + size))
    }
    return acc
  }, [])
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
    const command = new PublishCommand({
      TopicArn: snsArn,
      Message: JSON.stringify(event),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: event.type
        },
        subType: {
          DataType: 'String',
          StringValue: event.subType
        },
        ...customMessageAttributes
      }
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
    // split events into batches of 10
    const batches = chunk(events, MAX_BATCH_SIZE)

    const publishBatchPromises = batches.map(async (batch, batchIndex) => {
      const entries = batch.map((event, index) => {
        return {
          Id: `msg_${batchIndex * MAX_BATCH_SIZE + index}`,
          Message: JSON.stringify(event),
          MessageAttributes: {
            type: {
              DataType: 'String',
              StringValue: event.type || 'unknown'
            },
            subType: {
              DataType: 'String',
              StringValue: event.subType || 'unknown'
            },
            ...customMessageAttributes
          }
        }
      })

      const command = new PublishBatchCommand({
        TopicArn: snsArn,
        PublishBatchRequestEntries: entries
      })

      const { Successful, Failed } = await client.send(command)

      const successfulMessageIds: string[] =
        Successful?.map((result) => result.MessageId).filter(
          (messageId: string | undefined) => messageId !== undefined
        ) || []

      const failedEvents =
        Failed?.map((failure) => {
          const failedEntry = entries.find((entry) => entry.Id === failure.Id)
          const failedIndex = entries.indexOf(failedEntry!)
          return batch[failedIndex]
        }) || []

      return { successfulMessageIds, failedEvents }
    })

    const results = await Promise.all(publishBatchPromises)

    const successfulMessageIds = results.flatMap((result) => result.successfulMessageIds)
    const failedEvents = results.flatMap((result) => result.failedEvents)

    return { successfulMessageIds, failedEvents }
  }

  return { publishMessage, publishMessages }
}
