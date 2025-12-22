import { Events, Event, AuthLink } from '@dcl/schemas'

export type TestEvent = Event & {
  type: Events.Type.CLIENT
  subType: Events.SubType.Client.LOGGED_IN
  metadata: {
    userId: string
  }
}

export function createTestMessage(overrides?: { data?: string }): TestEvent {
  return {
    type: Events.Type.CLIENT,
    subType: Events.SubType.Client.LOGGED_IN,
    key: 'test-key',
    timestamp: Date.now(),
    metadata: {
      userId: overrides?.data ?? 'test-user-id',
      authChain: [] as AuthLink[],
      timestamp: Date.now(),
      timestamps: {
        reportedAt: Date.now(),
        receivedAt: Date.now()
      },
      userAddress: '0x0',
      contextRuntime: 'test-runtime',
      realm: 'test-realm',
      sessionId: 'test-session-id',
      anonymousId: 'test-anonymous-id'
    }
  }
}

export function createSqsMessage(event: Event, receiptHandle: string = 'receipt-handle-1') {
  return {
    MessageId: `msg-${receiptHandle}`,
    Body: JSON.stringify(event),
    ReceiptHandle: receiptHandle
  }
}
