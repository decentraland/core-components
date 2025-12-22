import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent, IBaseComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { IQueueComponent } from '@dcl/sqs-component'
import { createMessagesHandlerComponent } from '../src/component'
import { IMessagesHandlerComponent, MessageHandler } from '../src/types'
import { Events, type Event } from '@dcl/schemas'

const mockStartOptions: IBaseComponent.ComponentStartOptions = {
  started: () => true,
  live: () => true,
  getComponents: () => ({})
}

type TestEvent = Event & {
  type: Events.Type.CLIENT
  subType: Events.SubType.Client.LOGGED_IN
  metadata: {
    userId: string
  }
}

function createMockSqsComponent(overrides?: Partial<jest.Mocked<IQueueComponent>>): jest.Mocked<IQueueComponent> {
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

function createTestMessage(overrides?: { data?: string }): TestEvent {
  return {
    type: Events.Type.CLIENT,
    subType: Events.SubType.Client.LOGGED_IN,
    key: 'test-key',
    timestamp: Date.now(),
    metadata: {
      userId: overrides?.data ?? 'test-user-id'
    }
  } as TestEvent
}

function createSqsMessage(event: Event, receiptHandle: string = 'receipt-handle-1') {
  return {
    MessageId: `msg-${receiptHandle}`,
    Body: JSON.stringify(event),
    ReceiptHandle: receiptHandle
  }
}

describe('when processing messages', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IMessagesHandlerComponent

  describe('and a message matches a registered handler', () => {
    let handler: jest.Mock<Promise<void>, [TestEvent]>
    let testEvent: TestEvent
    let messageProcessed: Promise<void>
    let resolveMessageProcessed: () => void

    beforeEach(async () => {
      messageProcessed = new Promise((resolve) => {
        resolveMessageProcessed = resolve
      })

      handler = jest.fn().mockImplementation(async () => {
        resolveMessageProcessed()
      })
      testEvent = createTestMessage()

      sqs = createMockSqsComponent({
        receiveMessages: jest
          .fn()
          .mockResolvedValueOnce([createSqsMessage(testEvent)])
          .mockResolvedValue([])
      })
      logs = createLoggerMockedComponent()
      component = createMessagesHandlerComponent({ sqs, logs })

      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler)
      await component[START_COMPONENT]!(mockStartOptions)

      // Wait for handler to be called
      await messageProcessed
    })

    afterEach(async () => {
      await component[STOP_COMPONENT]!()
      jest.resetAllMocks()
    })

    it('should call the handler with the parsed message', () => {
      expect(handler).toHaveBeenCalledWith(testEvent)
    })

    it('should delete the message after processing', () => {
      expect(sqs.deleteMessage).toHaveBeenCalledWith('receipt-handle-1')
    })
  })

  describe('and multiple handlers are registered for the same type/subType', () => {
    let handler1: jest.Mock<Promise<void>, [TestEvent]>
    let handler2: jest.Mock<Promise<void>, [TestEvent]>
    let testEvent: TestEvent
    let bothHandlersCalled: Promise<void>
    let handler1Called: () => void
    let handler2Called: () => void

    beforeEach(async () => {
      let callCount = 0
      bothHandlersCalled = new Promise((resolve) => {
        handler1Called = () => {
          callCount++
          if (callCount === 2) resolve()
        }
        handler2Called = () => {
          callCount++
          if (callCount === 2) resolve()
        }
      })

      handler1 = jest.fn().mockImplementation(async () => {
        handler1Called()
      })
      handler2 = jest.fn().mockImplementation(async () => {
        handler2Called()
      })
      testEvent = createTestMessage()

      sqs = createMockSqsComponent({
        receiveMessages: jest
          .fn()
          .mockResolvedValueOnce([createSqsMessage(testEvent)])
          .mockResolvedValue([])
      })
      logs = createLoggerMockedComponent()
      component = createMessagesHandlerComponent({ sqs, logs })

      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler1)
      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler2)
      await component[START_COMPONENT]!(mockStartOptions)

      await bothHandlersCalled
    })

    afterEach(async () => {
      await component[STOP_COMPONENT]!()
      jest.resetAllMocks()
    })

    it('should call all handlers with the parsed message', () => {
      expect(handler1).toHaveBeenCalledWith(testEvent)
      expect(handler2).toHaveBeenCalledWith(testEvent)
    })
  })

  describe('and no handler is registered for the message type', () => {
    let testEvent: TestEvent
    let messageDeleted: Promise<void>
    let resolveMessageDeleted: () => void

    beforeEach(async () => {
      messageDeleted = new Promise((resolve) => {
        resolveMessageDeleted = resolve
      })

      testEvent = createTestMessage()

      sqs = createMockSqsComponent({
        receiveMessages: jest
          .fn()
          .mockResolvedValueOnce([createSqsMessage(testEvent)])
          .mockResolvedValue([]),
        deleteMessage: jest.fn().mockImplementation(async () => {
          resolveMessageDeleted()
        })
      })
      logs = createLoggerMockedComponent()
      component = createMessagesHandlerComponent({ sqs, logs })

      await component[START_COMPONENT]!(mockStartOptions)

      await messageDeleted
    })

    afterEach(async () => {
      await component[STOP_COMPONENT]!()
      jest.resetAllMocks()
    })

    it('should still delete the message', () => {
      expect(sqs.deleteMessage).toHaveBeenCalledWith('receipt-handle-1')
    })
  })

  describe('and a handler throws an error', () => {
    let handler: jest.Mock<Promise<void>, [TestEvent]>
    let testEvent: TestEvent
    let mockLogger: jest.Mocked<ILoggerComponent.ILogger>
    let messageDeleted: Promise<void>
    let resolveMessageDeleted: () => void

    beforeEach(async () => {
      messageDeleted = new Promise((resolve) => {
        resolveMessageDeleted = resolve
      })

      handler = jest.fn().mockRejectedValue(new Error('Handler error'))
      testEvent = createTestMessage()

      sqs = createMockSqsComponent({
        receiveMessages: jest
          .fn()
          .mockResolvedValueOnce([createSqsMessage(testEvent)])
          .mockResolvedValue([]),
        deleteMessage: jest.fn().mockImplementation(async () => {
          resolveMessageDeleted()
        })
      })

      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
      }
      logs = {
        getLogger: jest.fn().mockReturnValue(mockLogger)
      }

      component = createMessagesHandlerComponent({ sqs, logs })
      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler)
      await component[START_COMPONENT]!(mockStartOptions)

      await messageDeleted
    })

    afterEach(async () => {
      await component[STOP_COMPONENT]!()
      jest.resetAllMocks()
    })

    it('should log the error', () => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handler failed processing message',
        expect.objectContaining({
          error: 'Handler error'
        })
      )
    })

    it('should still delete the message after handler failure', () => {
      expect(sqs.deleteMessage).toHaveBeenCalledWith('receipt-handle-1')
    })
  })

  describe('and the message body is invalid JSON', () => {
    let mockLogger: jest.Mocked<ILoggerComponent.ILogger>
    let messageDeleted: Promise<void>
    let resolveMessageDeleted: () => void

    beforeEach(async () => {
      messageDeleted = new Promise((resolve) => {
        resolveMessageDeleted = resolve
      })

      sqs = createMockSqsComponent({
        receiveMessages: jest
          .fn()
          .mockResolvedValueOnce([
            {
              MessageId: 'msg-1',
              Body: 'invalid-json',
              ReceiptHandle: 'receipt-handle-1'
            }
          ])
          .mockResolvedValue([]),
        deleteMessage: jest.fn().mockImplementation(async () => {
          resolveMessageDeleted()
        })
      })

      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
      }
      logs = {
        getLogger: jest.fn().mockReturnValue(mockLogger)
      }

      component = createMessagesHandlerComponent({ sqs, logs })
      await component[START_COMPONENT]!(mockStartOptions)

      await messageDeleted
    })

    afterEach(async () => {
      await component[STOP_COMPONENT]!()
      jest.resetAllMocks()
    })

    it('should log the error', () => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed processing message from queue',
        expect.objectContaining({
          messageHandle: 'receipt-handle-1'
        })
      )
    })

    it('should delete the message even with invalid JSON', () => {
      expect(sqs.deleteMessage).toHaveBeenCalledWith('receipt-handle-1')
    })
  })
})

describe('when stopping the component with remaining messages', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IMessagesHandlerComponent

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and there are unprocessed messages in the batch', () => {
    let handler: jest.Mock<Promise<void>, [TestEvent]>
    let mockLogger: jest.Mocked<ILoggerComponent.ILogger>
    let handlerStarted: Promise<void>
    let resolveHandlerStarted: () => void
    let handlerResolve: () => void

    beforeEach(async () => {
      handlerStarted = new Promise((resolve) => {
        resolveHandlerStarted = resolve
      })

      handler = jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveHandlerStarted()
            handlerResolve = resolve
          })
      )

      const testEvent1 = createTestMessage({ data: 'event-1' })
      const testEvent2 = createTestMessage({ data: 'event-2' })
      const testEvent3 = createTestMessage({ data: 'event-3' })

      let receiveCallCount = 0
      sqs = createMockSqsComponent({
        receiveMessages: jest.fn().mockImplementation(async () => {
          receiveCallCount++
          if (receiveCallCount === 1) {
            return [
              createSqsMessage(testEvent1, 'receipt-1'),
              createSqsMessage(testEvent2, 'receipt-2'),
              createSqsMessage(testEvent3, 'receipt-3')
            ]
          }
          return new Promise(() => {})
        })
      })

      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
      }
      logs = {
        getLogger: jest.fn().mockReturnValue(mockLogger)
      }

      component = createMessagesHandlerComponent({ sqs, logs })
      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler)

      await component[START_COMPONENT]!(mockStartOptions)

      // Wait for the first handler to start
      await handlerStarted

      // Now stop the component while handler is still processing
      const stopPromise = component[STOP_COMPONENT]!()

      // Complete the first handler
      handlerResolve()

      await stopPromise
    })

    it('should change visibility of remaining messages', () => {
      expect(sqs.changeMessagesVisibility).toHaveBeenCalled()
    })

    it('should log the release of remaining messages', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Released remaining messages on shutdown',
        expect.objectContaining({
          visibilityTimeoutSeconds: 0
        })
      )
    })
  })

  describe('and a custom release visibility timeout is configured', () => {
    let handler: jest.Mock<Promise<void>, [TestEvent]>
    let handlerStarted: Promise<void>
    let resolveHandlerStarted: () => void
    let handlerResolve: () => void

    beforeEach(async () => {
      handlerStarted = new Promise((resolve) => {
        resolveHandlerStarted = resolve
      })

      handler = jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveHandlerStarted()
            handlerResolve = resolve
          })
      )

      const testEvent1 = createTestMessage({ data: 'event-1' })
      const testEvent2 = createTestMessage({ data: 'event-2' })

      let receiveCallCount = 0
      sqs = createMockSqsComponent({
        receiveMessages: jest.fn().mockImplementation(async () => {
          receiveCallCount++
          if (receiveCallCount === 1) {
            return [createSqsMessage(testEvent1, 'receipt-1'), createSqsMessage(testEvent2, 'receipt-2')]
          }
          return new Promise(() => {})
        })
      })

      logs = createLoggerMockedComponent()

      component = createMessagesHandlerComponent({ sqs, logs }, { releaseVisibilityTimeoutSeconds: 30 })
      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler)

      await component[START_COMPONENT]!(mockStartOptions)
      await handlerStarted

      const stopPromise = component[STOP_COMPONENT]!()
      handlerResolve()
      await stopPromise
    })

    it('should use the configured visibility timeout', () => {
      expect(sqs.changeMessagesVisibility).toHaveBeenCalledWith(expect.any(Array), 30)
    })
  })

  describe('and changing message visibility fails', () => {
    let handler: jest.Mock<Promise<void>, [TestEvent]>
    let mockLogger: jest.Mocked<ILoggerComponent.ILogger>
    let handlerStarted: Promise<void>
    let resolveHandlerStarted: () => void
    let handlerResolve: () => void

    beforeEach(async () => {
      handlerStarted = new Promise((resolve) => {
        resolveHandlerStarted = resolve
      })

      handler = jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveHandlerStarted()
            handlerResolve = resolve
          })
      )

      const testEvent1 = createTestMessage({ data: 'event-1' })
      const testEvent2 = createTestMessage({ data: 'event-2' })

      let receiveCallCount = 0
      sqs = createMockSqsComponent({
        receiveMessages: jest.fn().mockImplementation(async () => {
          receiveCallCount++
          if (receiveCallCount === 1) {
            return [createSqsMessage(testEvent1, 'receipt-1'), createSqsMessage(testEvent2, 'receipt-2')]
          }
          return new Promise(() => {})
        }),
        changeMessagesVisibility: jest.fn().mockRejectedValue(new Error('Visibility change failed'))
      })

      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
      }
      logs = {
        getLogger: jest.fn().mockReturnValue(mockLogger)
      }

      component = createMessagesHandlerComponent({ sqs, logs })
      component.addMessageHandler<TestEvent>(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, handler)

      await component[START_COMPONENT]!(mockStartOptions)
      await handlerStarted

      const stopPromise = component[STOP_COMPONENT]!()
      handlerResolve()
      await stopPromise
    })

    it('should log the error', () => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to release remaining messages on shutdown',
        expect.objectContaining({
          error: 'Visibility change failed'
        })
      )
    })
  })
})
