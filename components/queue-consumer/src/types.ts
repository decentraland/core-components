import type { IBaseComponent } from '@well-known-components/interfaces'
import type { BaseEvent, Event } from '@dcl/schemas'

export type MessageHandler<T extends Event = Event> = (message: T) => Promise<void>

/**
 * Configuration options for the Messages Handler component
 */
export interface IQueueConsumerOptions {
  /**
   * Visibility timeout (in seconds) to set for remaining unprocessed messages when the component stops.
   * Setting this to 0 makes messages immediately available for other consumers.
   * @default 0
   */
  releaseVisibilityTimeoutSeconds?: number
}

export interface IQueueConsumerComponent extends IBaseComponent {
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

  addMessageHandler: <T extends Event>(
    messageType: BaseEvent['type'],
    subType: BaseEvent['subType'],
    handler: MessageHandler<T>
  ) => void

  /**
   * Removes a previously registered handler for a specific event type and subType
   *
   * @param messageType - The event type the handler was registered for
   * @param subType - The event subtype the handler was registered for
   * @param handler - The handler function to remove (must be the same reference)
   */
  removeMessageHandler: <T extends Event>(
    messageType: BaseEvent['type'],
    subType: BaseEvent['subType'],
    handler: MessageHandler<T>
  ) => void
}
