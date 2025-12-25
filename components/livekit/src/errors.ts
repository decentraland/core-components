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

/**
 * Error thrown when updating room metadata fails
 */
export class LivekitRoomMetadataUpdateError extends Error {
  constructor(roomName: string, message: string) {
    super(`Failed to update metadata for room ${roomName}: ${message}`)
    this.name = 'LivekitRoomMetadataUpdateError'
  }
}

/**
 * Error thrown when updating a participant fails
 */
export class LivekitParticipantUpdateError extends Error {
  constructor(roomName: string, identity: string, message: string) {
    super(`Failed to update participant ${identity} in room ${roomName}: ${message}`)
    this.name = 'LivekitParticipantUpdateError'
  }
}
