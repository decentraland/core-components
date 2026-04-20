import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent, IBaseComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { IQueueComponent } from '@dcl/sqs-component'
import { createQueueConsumerComponent } from '../src/component'
import { IQueueConsumerComponent } from '../src/types'
import { Events } from '@dcl/schemas'
import { createMockSqsComponent } from './mocks/sqs-mock-component'
import { TestEvent, createTestMessage, createSqsMessage } from './mocks/sqs-messages'

const mockStartOptions: IBaseComponent.ComponentStartOptions = {
  started: () => true,
  live: () => true,
  getComponents: () => ({})
}

describe('when processing messages', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IQueueConsumerComponent

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
      component = createQueueConsumerComponent({ sqs, logs })

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
      component = createQueueConsumerComponent({ sqs, logs })

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
      component = createQueueConsumerComponent({ sqs, logs })

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

      component = createQueueConsumerComponent({ sqs, logs })
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

      component = createQueueConsumerComponent({ sqs, logs })
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
  let component: IQueueConsumerComponent

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

      component = createQueueConsumerComponent({ sqs, logs })
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

      component = createQueueConsumerComponent({ sqs, logs }, { releaseVisibilityTimeoutSeconds: 30 })
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

      component = createQueueConsumerComponent({ sqs, logs })
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

// A receiveMessages mock that blocks until the caller's AbortSignal fires,
// mirroring how the real AWS SDK behaves during long-poll.
function createAbortableReceiveMock(options: { onReceiveCalled?: (signal?: AbortSignal) => void } = {}) {
  return jest.fn().mockImplementation(async (_amount?: number, opts?: { abortSignal?: AbortSignal }) => {
    options.onReceiveCalled?.(opts?.abortSignal)
    return new Promise((_, reject) => {
      if (!opts?.abortSignal) {
        return
      }
      const onAbort = () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      }
      if (opts.abortSignal.aborted) {
        onAbort()
        return
      }
      opts.abortSignal.addEventListener('abort', onAbort, { once: true })
    })
  })
}

describe('when configuring the poll batch size', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IQueueConsumerComponent
  let receiveCalled: Promise<void>

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    jest.resetAllMocks()
  })

  describe('and a custom batchSize is provided', () => {
    beforeEach(async () => {
      let resolveReceiveCalled!: () => void
      receiveCalled = new Promise((resolve) => {
        resolveReceiveCalled = resolve
      })

      sqs = createMockSqsComponent({
        receiveMessages: createAbortableReceiveMock({ onReceiveCalled: () => resolveReceiveCalled() })
      })
      logs = createLoggerMockedComponent()

      component = createQueueConsumerComponent({ sqs, logs }, { batchSize: 3 })
      await component[START_COMPONENT]!(mockStartOptions)
      await receiveCalled
    })

    it('should forward it to sqs.receiveMessages', () => {
      expect(sqs.receiveMessages).toHaveBeenCalledWith(3, expect.anything())
    })
  })

  describe('and no batchSize is provided', () => {
    beforeEach(async () => {
      let resolveReceiveCalled!: () => void
      receiveCalled = new Promise((resolve) => {
        resolveReceiveCalled = resolve
      })

      sqs = createMockSqsComponent({
        receiveMessages: createAbortableReceiveMock({ onReceiveCalled: () => resolveReceiveCalled() })
      })
      logs = createLoggerMockedComponent()

      component = createQueueConsumerComponent({ sqs, logs })
      await component[START_COMPONENT]!(mockStartOptions)
      await receiveCalled
    })

    it('should default to 10', () => {
      expect(sqs.receiveMessages).toHaveBeenCalledWith(10, expect.anything())
    })
  })
})

describe('when stopping during a long-poll', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IQueueConsumerComponent
  let receiveCalled: Promise<void>
  let capturedSignal: AbortSignal | undefined

  beforeEach(async () => {
    let resolveReceiveCalled!: () => void
    receiveCalled = new Promise((resolve) => {
      resolveReceiveCalled = resolve
    })
    capturedSignal = undefined

    sqs = createMockSqsComponent({
      receiveMessages: createAbortableReceiveMock({
        onReceiveCalled: (signal) => {
          capturedSignal = signal
          resolveReceiveCalled()
        }
      })
    })
    logs = createLoggerMockedComponent()

    component = createQueueConsumerComponent({ sqs, logs })
    await component[START_COMPONENT]!(mockStartOptions)
    await receiveCalled
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should forward an AbortSignal to sqs.receiveMessages', () => {
    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
  })

  it('should abort the in-flight receive and resolve stop quickly', async () => {
    const stopStartedAt = Date.now()
    await component[STOP_COMPONENT]!()

    expect(capturedSignal!.aborted).toBe(true)
    // Without the abort plumbing, stop would only return when the receive
    // promise settled (which in our mock is never). A generous 500ms bound
    // is still tight enough to prove the abort path is in play.
    expect(Date.now() - stopStartedAt).toBeLessThan(500)
  })
})

describe('when a message is missing a ReceiptHandle', () => {
  let sqs: jest.Mocked<IQueueComponent>
  let logs: jest.Mocked<ILoggerComponent>
  let component: IQueueConsumerComponent
  let mockLogger: jest.Mocked<ILoggerComponent.ILogger>
  let warnCalled: Promise<void>
  let resolveWarnCalled: () => void

  beforeEach(async () => {
    warnCalled = new Promise((resolve) => {
      resolveWarnCalled = resolve
    })

    sqs = createMockSqsComponent({
      receiveMessages: jest
        .fn()
        .mockResolvedValueOnce([
          {
            MessageId: 'msg-1',
            Body: JSON.stringify(createTestMessage())
            // no ReceiptHandle
          }
        ])
        .mockResolvedValue([])
    })

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn().mockImplementation(() => {
        resolveWarnCalled()
      }),
      error: jest.fn(),
      log: jest.fn()
    }
    logs = {
      getLogger: jest.fn().mockReturnValue(mockLogger)
    }

    component = createQueueConsumerComponent({ sqs, logs })
    await component[START_COMPONENT]!(mockStartOptions)
    await warnCalled
  })

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    jest.resetAllMocks()
  })

  it('should skip the delete call instead of passing undefined to sqs.deleteMessage', () => {
    expect(sqs.deleteMessage).not.toHaveBeenCalled()
  })

  it('should log a warning', () => {
    expect(mockLogger.warn).toHaveBeenCalledWith('Skipping delete for message without ReceiptHandle')
  })
})
