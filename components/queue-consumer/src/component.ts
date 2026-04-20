import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent } from '@well-known-components/interfaces'
import { isErrorWithMessage, sleep } from '@dcl/core-commons'
import type { BaseEvent, Event } from '@dcl/schemas'
import { IQueueComponent } from '@dcl/sqs-component'
import type { IQueueConsumerComponent, MessageHandler, IQueueConsumerOptions } from './types'

/**
 * Computes an exponential-backoff delay with equal jitter.
 *
 * The result falls in [exp/2, exp), which keeps a lower floor so a streak of
 * small randoms cannot produce a tight zero-delay retry loop. Exported so
 * tests can pin it without driving the process loop through fake timers.
 */
export function computeRetryDelayMs(
  consecutiveFailures: number,
  baseRetryDelayMs: number,
  maxRetryDelayMs: number,
  random: number = Math.random()
): number {
  if (consecutiveFailures <= 0) {
    return 0
  }
  const exponentialDelay = Math.min(baseRetryDelayMs * 2 ** (consecutiveFailures - 1), maxRetryDelayMs)
  const half = exponentialDelay / 2
  return Math.floor(half + random * half)
}

/**
 * Creates the Queue Consumer component
 *
 * Orchestrates message consumption from a queue and handler execution:
 * 1. Polls messages from the SQS queue
 * 2. Parses and validates incoming events
 * 3. Executes registered handlers for each event type
 * 4. Handles errors with exponential backoff retry strategy
 *
 * @param components Required components: sqs, logs
 * @param options Optional configuration options
 * @returns IQueueConsumerComponent implementation
 */
export const createQueueConsumerComponent = (
  components: {
    sqs: IQueueComponent
    logs: ILoggerComponent
  },
  options?: IQueueConsumerOptions
): IQueueConsumerComponent => {
  const { sqs, logs } = components
  const releaseVisibilityTimeoutSeconds = options?.releaseVisibilityTimeoutSeconds ?? 0
  const batchSize = options?.batchSize ?? 10

  let isRunning = false
  let processLoopPromise: Promise<void> | null = null
  let receiveAbortController: AbortController | null = null
  const logger = logs.getLogger('messages-handler')

  // Map to store handlers by composite key (type:subType), allowing multiple handlers per type/subType
  const handlers = new Map<string, Set<MessageHandler>>()

  /**
   * Builds a composite key from message type and subType
   */
  function buildHandlerKey(messageType: BaseEvent['type'], subType: BaseEvent['subType']): string {
    return `${messageType}:${subType}`
  }

  /**
   * Releases remaining unprocessed messages by changing their visibility timeout.
   * This makes messages available for other consumers to process.
   *
   * @param messages - Array of messages to release
   */
  async function tearDown(messages: { ReceiptHandle?: string }[]): Promise<void> {
    const receiptHandles = messages
      .map((msg) => msg.ReceiptHandle)
      .filter((handle): handle is string => handle !== undefined)

    if (receiptHandles.length === 0) {
      return
    }

    try {
      await sqs.changeMessagesVisibility(receiptHandles, releaseVisibilityTimeoutSeconds)
      logger.info('Released remaining messages on shutdown', {
        count: receiptHandles.length,
        visibilityTimeoutSeconds: releaseVisibilityTimeoutSeconds
      })
    } catch (releaseError) {
      const errorMessage = isErrorWithMessage(releaseError) ? releaseError.message : 'Unexpected failure'
      logger.error('Failed to release remaining messages on shutdown', {
        count: receiptHandles.length,
        error: errorMessage
      })
    }
  }

  async function processLoop() {
    logger.info('Starting to listen messages from queue')
    isRunning = true
    let consecutiveFailures = 0
    const baseRetryDelayMs = 1000
    const maxRetryDelayMs = 30_000

    while (isRunning) {
      try {
        receiveAbortController = new AbortController()
        const messages = await sqs.receiveMessages(batchSize, {
          abortSignal: receiveAbortController.signal
        })

        if (consecutiveFailures > 0) {
          logger.info('Queue connection recovered', {
            previousFailures: consecutiveFailures
          })
          consecutiveFailures = 0
        }

        // Process each message in the queue sequentially
        for (let i = 0; i < messages.length; i++) {
          // Check if we should stop between messages
          if (!isRunning) {
            await tearDown(messages.slice(i))
            break
          }

          const message = messages[i]
          const { Body, ReceiptHandle } = message
          let parsedMessage: Event | undefined

          try {
            parsedMessage = JSON.parse(Body)

            if (!parsedMessage) {
              throw new Error('Message is not a valid event or could not be parsed')
            }

            // Execute all handlers registered for this event type and subType
            const { type: eventType, subType: eventSubType } = parsedMessage
            const handlerKey = buildHandlerKey(eventType, eventSubType)
            const eventHandlers = handlers.get(handlerKey)

            if (eventHandlers && eventHandlers.size > 0) {
              const messageToHandle = parsedMessage
              // Execute all handlers registered for this event type/subType concurrently
              await Promise.allSettled(
                Array.from(eventHandlers).map(async (handler) => {
                  try {
                    await handler(messageToHandle)
                  } catch (handlerError) {
                    const errorMessage = isErrorWithMessage(handlerError) ? handlerError.message : 'Unexpected failure'
                    logger.error('Handler failed processing message', {
                      eventType,
                      eventSubType,
                      messageHandle: ReceiptHandle,
                      error: errorMessage
                    })
                  }
                })
              )
            }
          } catch (error) {
            const errorMessage = isErrorWithMessage(error) ? error.message : 'Unexpected failure'
            logger.error('Failed processing message from queue', {
              messageHandle: ReceiptHandle,
              error: errorMessage
            })
          } finally {
            if (ReceiptHandle) {
              // Swallow delete failures: bubbling them to the outer catch
              // would misclassify a post-receive delete error as a receive
              // failure and trigger backoff.
              try {
                await sqs.deleteMessage(ReceiptHandle)
              } catch (deleteError) {
                const errorMessage = isErrorWithMessage(deleteError) ? deleteError.message : 'Unexpected failure'
                logger.error('Failed to delete message after processing', {
                  messageHandle: ReceiptHandle,
                  error: errorMessage
                })
              }
            } else {
              logger.warn('Skipping delete for message without ReceiptHandle')
            }
          }
        }
      } catch (error) {
        // Don't retry if we're stopping — the receive was aborted on purpose.
        if (!isRunning) break

        logger.error(`Error receiving messages from queue: ${error}`)
        consecutiveFailures++
        const delay = computeRetryDelayMs(consecutiveFailures, baseRetryDelayMs, maxRetryDelayMs)

        // Interruptible sleep - check isRunning periodically
        const sleepInterval = 100
        for (let elapsed = 0; elapsed < delay && isRunning; elapsed += sleepInterval) {
          await sleep(Math.min(sleepInterval, delay - elapsed))
        }
      } finally {
        receiveAbortController = null
      }
    }
  }

  /**
   * Registers a handler for a specific event type and subType
   *
   * Multiple handlers can be registered for the same type/subType combination.
   * All registered handlers will be executed in parallel when a matching event is received.
   *
   * @param messageType - The event type to handle
   * @param subType - The event subtype to handle
   * @param handler - The handler function to execute for events of this type/subType
   */
  function addMessageHandler<T extends Event>(
    messageType: BaseEvent['type'],
    subType: BaseEvent['subType'],
    handler: MessageHandler<T>
  ): void {
    const handlerKey = buildHandlerKey(messageType, subType)
    const eventHandlers = handlers.get(handlerKey)
    if (eventHandlers) {
      eventHandlers.add(handler as MessageHandler)
    } else {
      handlers.set(handlerKey, new Set([handler as MessageHandler]))
    }
    logger.debug('Handler registered', { messageType, subType })
  }

  /**
   * Removes a previously registered handler for a specific event type and subType
   *
   * @param messageType - The event type the handler was registered for
   * @param subType - The event subtype the handler was registered for
   * @param handler - The handler function to remove (must be the same reference)
   */
  function removeMessageHandler<T extends Event>(
    messageType: BaseEvent['type'],
    subType: BaseEvent['subType'],
    handler: MessageHandler<T>
  ): void {
    const handlerKey = buildHandlerKey(messageType, subType)
    const eventHandlers = handlers.get(handlerKey)
    if (eventHandlers) {
      eventHandlers.delete(handler as MessageHandler)
      logger.debug('Handler removed', { messageType, subType })

      // Clean up empty sets
      if (eventHandlers.size === 0) {
        handlers.delete(handlerKey)
      }
    }
  }

  async function start() {
    logger.info('Starting messages consumer component')
    isRunning = true
    processLoopPromise = processLoop()

    return Promise.resolve()
  }

  async function stop() {
    logger.info('Stopping messages consumer component')
    isRunning = false

    // Abort any in-flight long-poll so shutdown does not wait up to
    // WaitTimeSeconds for the current receiveMessages call to return.
    if (receiveAbortController) {
      receiveAbortController.abort()
    }

    if (processLoopPromise) {
      await processLoopPromise
      processLoopPromise = null
    }
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    addMessageHandler,
    removeMessageHandler
  }
}
