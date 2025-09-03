import { IConfigComponent } from '@well-known-components/interfaces'
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand
} from '@aws-sdk/client-sqs'

import { IQueueComponent } from './types'

export async function createSqsComponent(config: IConfigComponent): Promise<IQueueComponent> {
  const queueUrl = await config.requireString('AWS_SQS_QUEUE_URL')
  const endpoint = await config.getString?.('AWS_SQS_ENDPOINT')
  
  const clientConfig: any = {}
  if (endpoint) {
    clientConfig.endpoint = endpoint
  }
  const client = new SQSClient(clientConfig)

  async function send(message: any): Promise<void> {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ Message: JSON.stringify(message) }),
      DelaySeconds: 10
    })
    await client.send(sendCommand)
  }

  async function receiveMessages(amount: number = 1): Promise<Message[]> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: amount,
      VisibilityTimeout: 60, // 1 minute
      WaitTimeSeconds: 20
    })
    const { Messages = [] } = await client.send(receiveCommand)

    return Messages
  }

  async function deleteMessage(receiptHandle: string): Promise<void> {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    })
    await client.send(deleteCommand)
  }

  return {
    send,
    receiveMessages,
    deleteMessage
  }
}
