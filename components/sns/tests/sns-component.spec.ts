import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createSnsComponent } from '../src/component'
import { CustomMessageAttributes, IPublisherComponent } from '../src/types'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(),
  PublishCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  PublishBatchCommand: jest.fn().mockImplementation((params) => ({ input: params }))
}))

let config: IConfigComponent
let component: IPublisherComponent
let mockSnsClient: any
let sendMock: jest.Mock
let snsArn: string
let snsEndpoint: string

beforeEach(async () => {
  snsArn = 'arn:aws:sns:us-east-1:123456789012:test-topic'
  snsEndpoint = 'http://localhost:4566'
  sendMock = jest.fn()

  mockSnsClient = {
    send: sendMock
  }

  const { SNSClient } = require('@aws-sdk/client-sns')
  SNSClient.mockImplementation(() => mockSnsClient)

  config = createConfigMockedComponent({
    requireString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_SNS_ARN':
          return snsArn
        default:
          throw new Error(`Unknown key: ${key}`)
      }
    }),
    getString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_SNS_ENDPOINT':
          return snsEndpoint
        default:
          return undefined
      }
    })
  })

  component = await createSnsComponent({ config })
})

describe('when publishing a single message', () => {
  const event = {
    type: 'user_login',
    subType: 'web',
    userId: '123',
    timestamp: new Date().toISOString()
  }

  describe('and the publish succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        MessageId: 'msg-123'
      })
    })

    it('should publish the message successfully', async () => {
      const result = await component.publishMessage(event)
      expect(result.MessageId).toEqual('msg-123')
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('should publish with only default message attributes', async () => {
      await component.publishMessage(event)

      const sentCommand = sendMock.mock.calls[0][0]
      expect(sentCommand.input.MessageAttributes).toEqual({
        type: {
          DataType: 'String',
          StringValue: 'user_login'
        },
        subType: {
          DataType: 'String',
          StringValue: 'web'
        }
      })
    })
  })

  describe('and the publish fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('AWS Error'))
    })

    it('should throw the error', async () => {
      await expect(component.publishMessage(event)).rejects.toThrow('AWS Error')
    })
  })
})

describe('when publishing messages', () => {
  const event = {
    type: 'user_login',
    subType: 'web',
    userId: '123',
    timestamp: new Date().toISOString()
  }

  describe('and the publish succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Successful: [{ MessageId: 'msg-123' }],
        Failed: []
      })
    })

    it('should publish the message successfully', async () => {
      const result = await component.publishMessages([event])

      expect(result.successfulMessageIds).toEqual(['msg-123'])
      expect(result.failedEvents).toEqual([])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('should publish with only default message attributes', async () => {
      await component.publishMessages([event])

      const sentCommand = sendMock.mock.calls[0][0]
      const entries = sentCommand.input.PublishBatchRequestEntries

      expect(entries[0].MessageAttributes).toEqual({
        type: {
          DataType: 'String',
          StringValue: 'user_login'
        },
        subType: {
          DataType: 'String',
          StringValue: 'web'
        }
      })
    })
  })

  describe('and the publish fails', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Successful: [],
        Failed: [{ Id: 'msg_0', Code: 'InvalidParameter' }]
      })
    })

    it('should return failed events', async () => {
      const result = await component.publishMessages([event])

      expect(result.successfulMessageIds).toEqual([])
      expect(result.failedEvents).toEqual([event])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and publishing multiple messages', () => {
    const events = [
      { type: 'user_login', userId: '123' },
      { type: 'user_logout', userId: '123' }
    ]

    beforeEach(() => {
      sendMock.mockResolvedValue({
        Successful: [{ MessageId: 'msg-1' }, { MessageId: 'msg-2' }],
        Failed: []
      })
    })

    it('should publish all messages successfully', async () => {
      const result = await component.publishMessages(events)

      expect(result.successfulMessageIds).toEqual(['msg-1', 'msg-2'])
      expect(result.failedEvents).toEqual([])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and some messages fail', () => {
    const events = [
      { type: 'user_login', userId: '123' },
      { type: 'user_logout', userId: '123' }
    ]

    beforeEach(() => {
      sendMock.mockResolvedValue({
        Successful: [{ MessageId: 'msg-1' }],
        Failed: [{ Id: 'msg_1', Code: 'InvalidParameter' }]
      })
    })

    it('should return both successful and failed results', async () => {
      const result = await component.publishMessages(events)

      expect(result.successfulMessageIds).toEqual(['msg-1'])
      expect(result.failedEvents).toEqual([events[1]]) // Second event failed
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the AWS client throws an error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('AWS Error'))
    })

    it('should throw the error', async () => {
      await expect(component.publishMessages([event])).rejects.toThrow('AWS Error')
    })
  })

  describe('and publishing empty array', () => {
    it('should return empty results', async () => {
      const result = await component.publishMessages([])

      expect(result.successfulMessageIds).toEqual([])
      expect(result.failedEvents).toEqual([])
      expect(sendMock).not.toHaveBeenCalled()
    })
  })
})

describe('when publishing a single message with custom MessageAttributes', () => {
  let event: any
  let customAttributes: CustomMessageAttributes

  beforeEach(() => {
    event = {
      type: 'user_login',
      subType: 'web',
      userId: '123',
      timestamp: new Date().toISOString()
    }
    customAttributes = {
      correlationId: {
        DataType: 'String',
        StringValue: 'abc-123-def'
      },
      priority: {
        DataType: 'String',
        StringValue: 'high'
      }
    }
  })

  afterEach(() => {
    sendMock.mockClear()
  })

  describe('and the publish succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        MessageId: 'msg-123'
      })
    })

    it('should publish the message with custom attributes', async () => {
      const result = await component.publishMessage(event, customAttributes)

      expect(result.MessageId).toEqual('msg-123')
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const sentCommand = sendMock.mock.calls[0][0]
      expect(sentCommand.input.MessageAttributes).toEqual({
        type: {
          DataType: 'String',
          StringValue: 'user_login'
        },
        subType: {
          DataType: 'String',
          StringValue: 'web'
        },
        correlationId: {
          DataType: 'String',
          StringValue: 'abc-123-def'
        },
        priority: {
          DataType: 'String',
          StringValue: 'high'
        }
      })
    })
  })

  describe('and custom attributes attempt to override reserved attributes', () => {
    describe('and type attribute is included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          type: {
            DataType: 'String',
            StringValue: 'malicious_type'
          }
        }
      })

      it('should throw an error indicating type cannot be overridden', async () => {
        await expect(component.publishMessage(event, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes: type'
        )
      })
    })

    describe('and subType attribute is included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          subType: {
            DataType: 'String',
            StringValue: 'malicious_subtype'
          }
        }
      })

      it('should throw an error indicating subType cannot be overridden', async () => {
        await expect(component.publishMessage(event, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes: subType'
        )
      })
    })

    describe('and both type and subType attributes are included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          type: {
            DataType: 'String',
            StringValue: 'malicious_type'
          },
          subType: {
            DataType: 'String',
            StringValue: 'malicious_subtype'
          }
        }
      })

      it('should throw an error indicating both cannot be overridden', async () => {
        await expect(component.publishMessage(event, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes'
        )
      })
    })
  })
})

describe('when publishing multiple messages with custom MessageAttributes', () => {
  let events: any[]
  let customAttributes: CustomMessageAttributes

  beforeEach(() => {
    customAttributes = {
      environment: {
        DataType: 'String',
        StringValue: 'production'
      },
      version: {
        DataType: 'String',
        StringValue: 'v2.0.0'
      }
    }
  })

  afterEach(() => {
    sendMock.mockClear()
  })

  describe('and there are less than 10 messages to be published', () => {
    beforeEach(() => {
      events = [
        { type: 'user_login', subType: 'web', userId: '123' },
        { type: 'user_logout', subType: 'mobile', userId: '456' }
      ]
      sendMock.mockResolvedValue({
        Successful: [{ MessageId: 'msg-1' }, { MessageId: 'msg-2' }],
        Failed: []
      })
    })

    it('should include custom attributes in all batch entries', async () => {
      await component.publishMessages(events, customAttributes)

      const sentCommand = sendMock.mock.calls[0][0]
      const entries = sentCommand.input.PublishBatchRequestEntries

      expect(entries).toHaveLength(2)
      expect(entries[0].MessageAttributes).toEqual({
        type: {
          DataType: 'String',
          StringValue: 'user_login'
        },
        subType: {
          DataType: 'String',
          StringValue: 'web'
        },
        environment: {
          DataType: 'String',
          StringValue: 'production'
        },
        version: {
          DataType: 'String',
          StringValue: 'v2.0.0'
        }
      })
      expect(entries[1].MessageAttributes).toEqual({
        type: {
          DataType: 'String',
          StringValue: 'user_logout'
        },
        subType: {
          DataType: 'String',
          StringValue: 'mobile'
        },
        environment: {
          DataType: 'String',
          StringValue: 'production'
        },
        version: {
          DataType: 'String',
          StringValue: 'v2.0.0'
        }
      })
    })
  })

  describe('and there are more than 10 messages to be published', () => {
    beforeEach(() => {
      events = Array.from({ length: 25 }, (_, i) => ({
        type: 'test_event',
        subType: 'batch',
        index: i
      }))
      sendMock.mockResolvedValue({
        Successful: Array.from({ length: 10 }, (_, i) => ({ MessageId: `msg-${i}` })),
        Failed: []
      })
    })

    it('should apply custom attributes to all batches', async () => {
      await component.publishMessages(events, customAttributes)

      // Should be called 3 times (10 + 10 + 5 messages)
      expect(sendMock).toHaveBeenCalledTimes(3)

      // Check each batch has custom attributes
      sendMock.mock.calls.forEach((call: any) => {
        const command = call[0]
        const entries = command.input.PublishBatchRequestEntries
        entries.forEach((entry: any) => {
          expect(entry.MessageAttributes.environment).toEqual({
            DataType: 'String',
            StringValue: 'production'
          })
          expect(entry.MessageAttributes.version).toEqual({
            DataType: 'String',
            StringValue: 'v2.0.0'
          })
        })
      })
    })
  })

  describe('and custom attributes attempt to override reserved attributes', () => {
    beforeEach(() => {
      events = [{ type: 'user_login', subType: 'web', userId: '123' }]
    })

    describe('and type attribute is included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          type: {
            DataType: 'String',
            StringValue: 'malicious_type'
          }
        }
      })

      it('should throw an error indicating type cannot be overridden', async () => {
        await expect(component.publishMessages(events, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes: type'
        )
      })
    })

    describe('and subType attribute is included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          subType: {
            DataType: 'String',
            StringValue: 'malicious_subtype'
          }
        }
      })

      it('should throw an error indicating subType cannot be overridden', async () => {
        await expect(component.publishMessages(events, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes: subType'
        )
      })
    })

    describe('and both type and subType attributes are included', () => {
      let invalidAttributes: CustomMessageAttributes

      beforeEach(() => {
        invalidAttributes = {
          type: {
            DataType: 'String',
            StringValue: 'malicious_type'
          },
          subType: {
            DataType: 'String',
            StringValue: 'malicious_subtype'
          }
        }
      })

      it('should throw an error indicating both cannot be overridden', async () => {
        await expect(component.publishMessages(events, invalidAttributes)).rejects.toThrow(
          'Cannot override reserved message attributes'
        )
      })
    })
  })
})
