import { IBaseComponent } from '@well-known-components/interfaces'
import {
  IngressInfo,
  IngressInput,
  ParticipantInfo,
  Room,
  TrackSource,
  WebhookEvent
} from 'livekit-server-sdk'

// Re-export livekit-server-sdk types for convenience
export { IngressInfo, IngressInput, ParticipantInfo, Room, TrackSource, WebhookEvent }

/**
 * Credentials returned when generating a LiveKit token
 */
export interface LivekitCredentials {
  /** The JWT token to connect to the room */
  token: string
  /** The LiveKit server URL */
  url: string
}

/**
 * Settings for connecting to a LiveKit server
 */
export interface LivekitSettings {
  /** The LiveKit server host URL (e.g., wss://livekit.example.com) */
  host: string
  /** The API key for authentication */
  apiKey: string
  /** The API secret for signing tokens */
  secret: string
}

/**
 * Permissions that can be granted to a participant
 */
export interface ParticipantPermissions {
  /** Whether the participant can publish audio/video tracks */
  canPublish?: boolean
  /** Whether the participant can subscribe to other participants' tracks */
  canSubscribe?: boolean
  /** Whether the participant can publish data messages */
  canPublishData?: boolean
  /** Whether the participant can update their own metadata */
  canUpdateOwnMetadata?: boolean
  /** Specific track sources the participant is allowed to publish */
  canPublishSources?: TrackSource[]
  /** Whether the participant is hidden from other participants */
  hidden?: boolean
}

/**
 * Options for generating access credentials
 */
export interface GenerateCredentialsOptions {
  /** Unique identifier for the participant */
  identity: string
  /** Name of the room to join */
  roomName: string
  /** Permissions to grant to the participant */
  permissions?: ParticipantPermissions
  /** Metadata to attach to the participant (will be JSON stringified) */
  metadata?: Record<string, unknown>
  /** Token time-to-live in seconds (default: 300 = 5 minutes) */
  ttlSeconds?: number
}

/**
 * Options for creating a new room
 */
export interface CreateRoomOptions {
  /** Name of the room to create */
  name: string
  /** Maximum number of participants (0 = unlimited) */
  maxParticipants?: number
  /** Empty timeout in seconds (how long before empty room is destroyed) */
  emptyTimeout?: number
  /** Room metadata (will be JSON stringified if object) */
  metadata?: string | Record<string, unknown>
}

/**
 * Options for updating a participant
 */
export interface UpdateParticipantOptions {
  /** New metadata for the participant (will be merged with existing) */
  metadata?: Record<string, unknown>
  /** New permissions for the participant */
  permissions?: ParticipantPermissions
  /** New display name for the participant */
  name?: string
}

/**
 * Options for creating an ingress (RTMP/WHIP input)
 */
export interface CreateIngressOptions {
  /** Type of ingress input */
  inputType: IngressInput
  /** Name for the ingress */
  name: string
  /** Room to stream into */
  roomName: string
  /** Identity for the ingress participant */
  participantIdentity: string
  /** Display name for the ingress participant */
  participantName?: string
}

/**
 * Options for the LiveKit component factory
 */
export interface LivekitComponentOptions {
  /** LiveKit server settings */
  settings: LivekitSettings
}

/**
 * Core LiveKit component interface
 *
 * Provides methods for managing LiveKit rooms, participants, and credentials.
 * This is a generic component that can be used by various services.
 */
export interface ILivekitComponent extends IBaseComponent {
  // ============= CREDENTIALS =============

  /**
   * Generate access credentials (JWT token) for a participant
   */
  generateCredentials(options: GenerateCredentialsOptions): Promise<LivekitCredentials>

  /**
   * Build a connection URL string from host and token
   */
  buildConnectionUrl(url: string, token: string): string

  // ============= ROOM MANAGEMENT =============

  /**
   * List all rooms, optionally filtered by names
   */
  listRooms(names?: string[]): Promise<Room[]>

  /**
   * Get a room by name, returns null if not found
   */
  getRoom(roomName: string): Promise<Room | null>

  /**
   * Get or create a room by name
   */
  getOrCreateRoom(options: CreateRoomOptions): Promise<Room>

  /**
   * Create a new room
   */
  createRoom(options: CreateRoomOptions): Promise<Room>

  /**
   * Delete a room by name
   */
  deleteRoom(roomName: string): Promise<void>

  /**
   * Update room metadata (merges with existing metadata)
   */
  updateRoomMetadata(roomName: string, metadata: Record<string, unknown>): Promise<void>

  // ============= PARTICIPANT MANAGEMENT =============

  /**
   * List all participants in a room
   */
  listParticipants(roomName: string): Promise<ParticipantInfo[]>

  /**
   * Get a specific participant by identity
   */
  getParticipant(roomName: string, identity: string): Promise<ParticipantInfo | null>

  /**
   * Remove a participant from a room
   */
  removeParticipant(roomName: string, identity: string): Promise<void>

  /**
   * Update a participant's metadata and/or permissions
   */
  updateParticipant(roomName: string, identity: string, options: UpdateParticipantOptions): Promise<void>

  /**
   * Mute a participant (removes all publish sources)
   */
  muteParticipant(roomName: string, identity: string): Promise<void>

  // ============= INGRESS MANAGEMENT =============

  /**
   * List ingresses, optionally filtered by room name
   */
  listIngresses(roomName?: string): Promise<IngressInfo[]>

  /**
   * Create a new ingress for streaming
   */
  createIngress(options: CreateIngressOptions): Promise<IngressInfo>

  /**
   * Delete an ingress by ID
   */
  deleteIngress(ingressId: string): Promise<void>

  /**
   * Get or create an ingress for a room
   */
  getOrCreateIngress(roomName: string, participantIdentity: string): Promise<IngressInfo>

  // ============= WEBHOOKS =============

  /**
   * Verify and parse a webhook event
   */
  receiveWebhookEvent(body: string, authorization: string): Promise<WebhookEvent>
}

