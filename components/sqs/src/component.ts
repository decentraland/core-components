import { IConfigComponent } from '@well-known-components/interfaces'
import {
  ChangeMessageVisibilityBatchCommand,
  ChangeMessageVisibilityCommand,
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand
} from '@aws-sdk/client-sqs'

import type { IQueueComponent, QueueStatus, ReceiveMessagesOptions } from '@dcl/core-commons'

// Helper function to chunk arrays for batch operations
function chunks<T>(array: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

export async function createSqsComponent(config: IConfigComponent): Promise<IQueueComponent> {
  const queueUrl = await config.requireString('AWS_SQS_QUEUE_URL')
  const endpoint = await config.getString?.('AWS_SQS_ENDPOINT')

  const clientConfig: { endpoint?: string } = {}
  if (endpoint) {
    clientConfig.endpoint = endpoint
  }
  const client = new SQSClient(clientConfig)

  async function sendMessage(message: any): Promise<void> {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ Message: JSON.stringify(message) }),
      DelaySeconds: 10
    })
    await client.send(sendCommand)
  }

  async function receiveMessages(amount: number = 1, options?: ReceiveMessagesOptions): Promise<Message[]> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: amount,
      VisibilityTimeout: options?.visibilityTimeout ?? 60,
      WaitTimeSeconds: options?.waitTimeSeconds ?? 20
    })
    const { Messages = [] } = await client.send(receiveCommand, {
      abortSignal: options?.abortSignal
    })

    return Messages
  }

  async function deleteMessage(receiptHandle: string): Promise<void> {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    })
    await client.send(deleteCommand)
  }

  async function deleteMessages(receiptHandles: string[]): Promise<void> {
    const batchSize = 10
    const batches = chunks(receiptHandles, batchSize)

    for (const batch of batches) {
      const deleteCommand = new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((receiptHandle, index) => ({
          Id: `msg_${index}`,
          ReceiptHandle: receiptHandle
        }))
      })
      await client.send(deleteCommand)
    }
  }

  async function changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout
    })
    await client.send(command)
  }

  async function changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void> {
    const batchSize = 10
    const batches = chunks(receiptHandles, batchSize)

    for (const batch of batches) {
      const command = new ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((receiptHandle, index) => ({
          Id: `msg_${index}`,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: visibilityTimeout
        }))
      })
      await client.send(command)
    }
  }

  async function getStatus(): Promise<QueueStatus> {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed'
      ]
    })
    const response = await client.send(command)
    return {
      ApproximateNumberOfMessages: response.Attributes?.ApproximateNumberOfMessages ?? '0',
      ApproximateNumberOfMessagesNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0',
      ApproximateNumberOfMessagesDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed ?? '0'
    }
  }

  return {
    sendMessage,
    receiveMessages,
    deleteMessage,
    deleteMessages,
    changeMessageVisibility,
    changeMessagesVisibility,
    getStatus
  }
}
