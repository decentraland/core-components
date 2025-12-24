/**
 * Error thrown when a LiveKit room is not found
 */
export class LivekitRoomNotFoundError extends Error {
  constructor(roomName: string) {
    super(`LiveKit room not found: ${roomName}`)
    this.name = 'LivekitRoomNotFoundError'
  }
}

/**
 * Error thrown when a LiveKit participant is not found
 */
export class LivekitParticipantNotFoundError extends Error {
  constructor(roomName: string, identity: string) {
    super(`LiveKit participant not found: ${identity} in room ${roomName}`)
    this.name = 'LivekitParticipantNotFoundError'
  }
}

/**
 * Error thrown when a LiveKit ingress is not found
 */
export class LivekitIngressNotFoundError extends Error {
  constructor(ingressId: string) {
    super(`LiveKit ingress not found: ${ingressId}`)
    this.name = 'LivekitIngressNotFoundError'
  }
}

/**
 * Error thrown when webhook verification fails
 */
export class LivekitWebhookVerificationError extends Error {
  constructor(message: string) {
    super(`LiveKit webhook verification failed: ${message}`)
    this.name = 'LivekitWebhookVerificationError'
  }
}

