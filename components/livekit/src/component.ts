import { ILoggerComponent, IConfigComponent } from '@well-known-components/interfaces'
import {
  AccessToken,
  IngressClient,
  IngressInfo,
  IngressInput,
  ParticipantInfo,
  Room,
  RoomServiceClient,
  WebhookReceiver
} from 'livekit-server-sdk'
import { isErrorWithMessage } from '@dcl/core-commons'

import {
  CreateIngressOptions,
  CreateRoomOptions,
  GenerateCredentialsOptions,
  GetRoomNameParams,
  ILivekitComponent,
  LivekitCredentials,
  LivekitSettings,
  RoomMetadata,
  RoomType,
  UpdateParticipantOptions
} from './types'
import { LivekitIngressNotFoundError, LivekitParticipantNotFoundError, LivekitWebhookVerificationError } from './errors'

/**
 * Normalizes a host URL to ensure it starts with wss://
 */
function normalizeHost(host: string): string {
  return host.startsWith('wss://') ? host : `wss://${host}`
}

/**
 * Creates a LiveKit component for managing rooms, participants, and credentials.
 * Supports multiple environments (production and preview) with separate configurations.
 *
 * Required configuration keys:
 * - LIVEKIT_HOST: Production LiveKit server host
 * - LIVEKIT_API_KEY: Production API key
 * - LIVEKIT_API_SECRET: Production API secret
 *
 * Optional configuration keys:
 * - LIVEKIT_PREVIEW_HOST: Preview LiveKit server host (defaults to LIVEKIT_HOST)
 * - LIVEKIT_PREVIEW_API_KEY: Preview API key (defaults to LIVEKIT_API_KEY)
 * - LIVEKIT_PREVIEW_API_SECRET: Preview API secret (defaults to LIVEKIT_API_SECRET)
 * - LIVEKIT_WORLD_ROOM_PREFIX: Prefix for world room names (default: 'world-')
 * - LIVEKIT_SCENE_ROOM_PREFIX: Prefix for scene room names (default: 'scene-')
 *
 * @example
 * ```typescript
 * const livekit = await createLivekitComponent({ config, logs })
 *
 * // Generate credentials for a participant (production)
 * const credentials = await livekit.generateCredentials('user-123', 'my-room', {
 *   permissions: { canPublish: true, canSubscribe: true }
 * })
 *
 * // Generate credentials for preview environment
 * const previewCredentials = await livekit.generateCredentials('user-123', 'my-room', {
 *   forPreview: true
 * })
 *
 * // Get a room name for a world
 * const worldRoom = livekit.getWorldRoomName('my-world')
 *
 * // Get a room name for a scene
 * const sceneRoom = livekit.getSceneRoomName('realm-1', 'scene-abc')
 * ```
 */
export async function createLivekitComponent(components: {
  config: IConfigComponent
  logs: ILoggerComponent
}): Promise<ILivekitComponent> {
  const { config, logs } = components

  const logger = logs.getLogger('livekit-component')

  // Load configuration
  const [
    prodHost,
    prodApiKey,
    prodSecret,
    previewHost,
    previewApiKey,
    previewSecret,
    worldRoomPrefix,
    sceneRoomPrefix,
    islandRoomPrefix
  ] = await Promise.all([
    config.requireString('LIVEKIT_HOST'),
    config.requireString('LIVEKIT_API_KEY'),
    config.requireString('LIVEKIT_API_SECRET'),
    config.getString('LIVEKIT_PREVIEW_HOST'),
    config.getString('LIVEKIT_PREVIEW_API_KEY'),
    config.getString('LIVEKIT_PREVIEW_API_SECRET'),
    config.getString('LIVEKIT_WORLD_ROOM_PREFIX'),
    config.getString('LIVEKIT_SCENE_ROOM_PREFIX'),
    config.getString('LIVEKIT_ISLAND_ROOM_PREFIX')
  ])

  // Normalize hosts
  const normalizedProdHost = normalizeHost(prodHost)
  const normalizedPreviewHost = normalizeHost(previewHost || prodHost)

  // Build settings objects
  const prodSettings: LivekitSettings = {
    host: normalizedProdHost,
    apiKey: prodApiKey,
    secret: prodSecret
  }

  const previewSettings: LivekitSettings = {
    host: normalizedPreviewHost,
    apiKey: previewApiKey || prodApiKey,
    secret: previewSecret || prodSecret
  }

  // Room prefixes with defaults
  const worldPrefix = worldRoomPrefix || 'world-'
  const scenePrefix = sceneRoomPrefix || 'scene-'
  const islandPrefix = islandRoomPrefix || 'island-'

  // Initialize LiveKit clients (for production - used for room/ingress management)
  const roomClient = new RoomServiceClient(normalizedProdHost, prodApiKey, prodSecret)
  const ingressClient = new IngressClient(normalizedProdHost, prodApiKey, prodSecret)
  const webhookReceiver = new WebhookReceiver(prodApiKey, prodSecret)

  // ============= CREDENTIALS =============

  /**
   * Generates access credentials (JWT token) for a participant to join a room
   *
   * @param identity - Unique identifier for the participant
   * @param roomName - Name of the room to join
   * @param opts - Optional configuration for permissions, metadata, TTL, and environment
   * @returns LiveKit credentials containing the server URL and JWT token
   *
   * @example
   * ```typescript
   * const credentials = await livekit.generateCredentials('user-123', 'my-room', {
   *   permissions: { canPublish: true, canSubscribe: true },
   *   metadata: { displayName: 'John Doe' },
   *   ttlSeconds: 600,
   *   forPreview: false
   * })
   * ```
   */
  async function generateCredentials(
    identity: string,
    roomName: string,
    opts: GenerateCredentialsOptions = {}
  ): Promise<LivekitCredentials> {
    const { permissions = {}, metadata, ttlSeconds = 300, forPreview = false } = opts

    const settings = forPreview ? previewSettings : prodSettings

    const token = new AccessToken(settings.apiKey, settings.secret, {
      identity,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      ttl: ttlSeconds
    })

    token.addGrant({
      roomJoin: true,
      room: roomName,
      roomList: false,
      canPublish: permissions.canPublish ?? true,
      canSubscribe: permissions.canSubscribe ?? true,
      canPublishData: permissions.canPublishData ?? true,
      canUpdateOwnMetadata: permissions.canUpdateOwnMetadata ?? true,
      canPublishSources: permissions.canPublishSources,
      hidden: permissions.hidden ?? false
    })

    return {
      url: settings.host,
      token: await token.toJwt()
    }
  }

  /**
   * Builds a connection URL string from the LiveKit server URL and access token
   *
   * @param url - The LiveKit server URL (e.g., wss://livekit.example.com)
   * @param token - The JWT access token
   * @returns A formatted connection URL string
   *
   * @example
   * ```typescript
   * const connectionUrl = livekit.buildConnectionUrl('wss://livekit.example.com', 'jwt-token')
   * // Returns: 'livekit:wss://livekit.example.com?access_token=jwt-token'
   * ```
   */
  function buildConnectionUrl(url: string, token: string): string {
    return `livekit:${url}?access_token=${token}`
  }

  // ============= ROOM NAMING =============

  /**
   * Gets a world room name from a world name
   *
   * @param worldName - The name of the world
   * @returns The prefixed world room name
   *
   * @example
   * ```typescript
   * const roomName = livekit.getWorldRoomName('my-world')
   * // Returns: 'world-my-world'
   * ```
   */
  function getWorldRoomName(worldName: string): string {
    return `${worldPrefix}${worldName}`
  }

  /**
   * Gets a scene room name from realm name and scene ID
   *
   * @param realmName - The name of the realm
   * @param sceneId - The scene identifier
   * @returns The prefixed scene room name
   *
   * @example
   * ```typescript
   * const roomName = livekit.getSceneRoomName('realm-1', 'scene-abc')
   * // Returns: 'scene-realm-1:scene-abc'
   * ```
   */
  function getSceneRoomName(realmName: string, sceneId: string): string {
    return `${scenePrefix}${realmName}:${sceneId}`
  }

  /**
   * Gets an island room name from an island name
   *
   * @param islandName - The name of the island
   * @returns The prefixed island room name
   *
   * @example
   * ```typescript
   * const roomName = livekit.getIslandRoomName('island-123')
   * // Returns: 'island-island-123'
   * ```
   */
  function getIslandRoomName(islandName: string): string {
    return `${islandPrefix}${islandName}`
  }

  /**
   * Gets a room name based on realm and parameters
   *
   * @param realmName - The name of the realm (or world/island name for those types)
   * @param params - Parameters specifying the room type and optional scene ID
   * @returns The appropriate room name
   * @throws Error if sceneId is not provided for a scene room
   *
   * @example
   * ```typescript
   * // For a world room
   * const worldRoom = livekit.getRoomName('my-world', { type: 'world' })
   *
   * // For a scene room
   * const sceneRoom = livekit.getRoomName('realm-1', { type: 'scene', sceneId: 'scene-abc' })
   *
   * // For an island room
   * const islandRoom = livekit.getRoomName('island-123', { type: 'island' })
   * ```
   */
  function getRoomName(realmName: string, params: GetRoomNameParams): string {
    const { type, sceneId } = params
    switch (type) {
      case 'world':
        return getWorldRoomName(realmName)
      case 'island':
        return getIslandRoomName(realmName)
      case 'scene':
        if (!sceneId) {
          throw new Error('No sceneId provided for scene room')
        }
        return getSceneRoomName(realmName, sceneId)
      default:
        throw new Error(`Unknown room type: ${type}`)
    }
  }

  /**
   * Extracts metadata from a room name
   *
   * @param roomName - The room name to parse
   * @returns Extracted metadata including realmName, sceneId, worldName, and islandName
   *
   * @example
   * ```typescript
   * const sceneMetadata = livekit.getRoomMetadataFromRoomName('scene-realm-1:scene-abc')
   * // Returns: { realmName: 'realm-1', sceneId: 'scene-abc', worldName: undefined, islandName: undefined }
   *
   * const worldMetadata = livekit.getRoomMetadataFromRoomName('world-my-world')
   * // Returns: { realmName: undefined, sceneId: undefined, worldName: 'my-world', islandName: undefined }
   *
   * const islandMetadata = livekit.getRoomMetadataFromRoomName('island-island-123')
   * // Returns: { realmName: undefined, sceneId: undefined, worldName: undefined, islandName: 'island-123' }
   * ```
   */
  function getRoomMetadataFromRoomName(roomName: string): RoomMetadata {
    const [realmName, sceneId] = roomName.startsWith(scenePrefix) ? roomName.replace(scenePrefix, '').split(':') : []
    const worldName = roomName.startsWith(worldPrefix) ? roomName.replace(worldPrefix, '') : undefined
    const islandName = roomName.startsWith(islandPrefix) ? roomName.replace(islandPrefix, '') : undefined
    return { realmName, sceneId, worldName, islandName }
  }

  /**
   * Lists active rooms filtered by type (world, scene, or island)
   *
   * @param type - The type of rooms to list
   * @returns Array of Room objects matching the specified type
   *
   * @example
   * ```typescript
   * const worldRooms = await livekit.listRoomsByType('world')
   * const sceneRooms = await livekit.listRoomsByType('scene')
   * const islandRooms = await livekit.listRoomsByType('island')
   * ```
   */
  async function listRoomsByType(type: RoomType): Promise<Room[]> {
    const allRooms = await listRooms()
    const prefix = type === 'world' ? worldPrefix : type === 'scene' ? scenePrefix : islandPrefix
    return allRooms.filter((room) => room.name.startsWith(prefix))
  }

  // ============= ROOM MANAGEMENT =============

  /**
   * Lists all rooms, optionally filtered by room names
   *
   * @param names - Optional array of room names to filter by
   * @returns Array of Room objects, or empty array if an error occurs
   *
   * @example
   * ```typescript
   * // List all rooms
   * const allRooms = await livekit.listRooms()
   *
   * // List specific rooms
   * const specificRooms = await livekit.listRooms(['room-1', 'room-2'])
   * ```
   */
  async function listRooms(names?: string[]): Promise<Room[]> {
    try {
      return await roomClient.listRooms(names)
    } catch (error) {
      logger.warn(`Error listing rooms: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return []
    }
  }

  /**
   * Gets a room by name
   *
   * @param roomName - The name of the room to retrieve
   * @returns The Room object if found, null otherwise
   *
   * @example
   * ```typescript
   * const room = await livekit.getRoom('my-room')
   * if (room) {
   *   console.log(`Room has ${room.numParticipants} participants`)
   * }
   * ```
   */
  async function getRoom(roomName: string): Promise<Room | null> {
    try {
      const rooms = await roomClient.listRooms([roomName])
      return rooms.length > 0 ? rooms[0] : null
    } catch (error) {
      logger.warn(`Error getting room ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return null
    }
  }

  /**
   * Creates a new room with the specified name and options
   *
   * @param name - The name of the room to create
   * @param opts - Optional room configuration (maxParticipants, emptyTimeout, metadata)
   * @returns The created Room object
   *
   * @example
   * ```typescript
   * const room = await livekit.createRoom('my-room', {
   *   maxParticipants: 100,
   *   emptyTimeout: 300,
   *   metadata: { description: 'A test room' }
   * })
   * ```
   */
  async function createRoom(name: string, opts: CreateRoomOptions = {}): Promise<Room> {
    const metadata =
      typeof opts.metadata === 'object' && opts.metadata !== null ? JSON.stringify(opts.metadata) : opts.metadata

    return roomClient.createRoom({
      name,
      maxParticipants: opts.maxParticipants,
      emptyTimeout: opts.emptyTimeout,
      metadata
    })
  }

  /**
   * Gets an existing room or creates a new one if it doesn't exist
   *
   * @param name - The name of the room to get or create
   * @param opts - Optional room configuration for creation
   * @returns The existing or newly created Room object
   *
   * @example
   * ```typescript
   * const room = await livekit.getOrCreateRoom('my-room', {
   *   maxParticipants: 50
   * })
   * ```
   */
  async function getOrCreateRoom(name: string, opts: CreateRoomOptions = {}): Promise<Room> {
    const existingRoom = await getRoom(name)
    if (existingRoom) {
      return existingRoom
    }
    return createRoom(name, opts)
  }

  /**
   * Deletes a room by name. Logs a warning but does not throw if the room doesn't exist.
   *
   * @param roomName - The name of the room to delete
   *
   * @example
   * ```typescript
   * await livekit.deleteRoom('my-room')
   * ```
   */
  async function deleteRoom(roomName: string): Promise<void> {
    logger.info(`Deleting room ${roomName}`)
    try {
      await roomClient.deleteRoom(roomName)
    } catch (error) {
      logger.warn(`Error deleting room ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Updates room metadata by merging with existing metadata
   *
   * @param roomName - The name of the room to update
   * @param metadata - The metadata to merge with existing room metadata
   * @throws Error if the update fails
   *
   * @example
   * ```typescript
   * await livekit.updateRoomMetadata('my-room', {
   *   description: 'Updated description',
   *   customField: 'value'
   * })
   * ```
   */
  async function updateRoomMetadata(roomName: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      // Get existing room metadata to merge
      const room = await getRoom(roomName)
      let existingMetadata: Record<string, unknown> = {}

      if (room?.metadata) {
        try {
          existingMetadata = JSON.parse(room.metadata)
        } catch {
          logger.warn(`Error parsing existing room metadata for ${roomName}`)
          existingMetadata = {}
        }
      }

      const mergedMetadata = { ...existingMetadata, ...metadata }
      await roomClient.updateRoomMetadata(roomName, JSON.stringify(mergedMetadata))
    } catch (error) {
      logger.error(
        `Error updating room metadata for ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      )
      throw error
    }
  }

  // ============= PARTICIPANT MANAGEMENT =============

  /**
   * Lists all participants in a room
   *
   * @param roomName - The name of the room
   * @returns Array of ParticipantInfo objects, or empty array if an error occurs
   *
   * @example
   * ```typescript
   * const participants = await livekit.listParticipants('my-room')
   * participants.forEach(p => console.log(p.identity))
   * ```
   */
  async function listParticipants(roomName: string): Promise<ParticipantInfo[]> {
    try {
      return await roomClient.listParticipants(roomName)
    } catch (error) {
      logger.warn(
        `Error listing participants in ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      )
      return []
    }
  }

  /**
   * Gets a specific participant by identity from a room
   *
   * @param roomName - The name of the room
   * @param identity - The unique identifier of the participant
   * @returns The ParticipantInfo object if found, null otherwise
   *
   * @example
   * ```typescript
   * const participant = await livekit.getParticipant('my-room', 'user-123')
   * if (participant) {
   *   console.log(`Found participant: ${participant.name}`)
   * }
   * ```
   */
  async function getParticipant(roomName: string, identity: string): Promise<ParticipantInfo | null> {
    try {
      const participants = await roomClient.listParticipants(roomName)
      return participants.find((p) => p.identity === identity) || null
    } catch (error) {
      logger.warn(
        `Error getting participant ${identity} in ${roomName}: ${
          isErrorWithMessage(error) ? error.message : 'Unknown error'
        }`
      )
      return null
    }
  }

  /**
   * Removes a participant from a room
   *
   * @param roomName - The name of the room
   * @param identity - The unique identifier of the participant to remove
   * @throws LivekitParticipantNotFoundError if the participant cannot be removed
   *
   * @example
   * ```typescript
   * await livekit.removeParticipant('my-room', 'user-123')
   * ```
   */
  async function removeParticipant(roomName: string, identity: string): Promise<void> {
    try {
      await roomClient.removeParticipant(roomName, identity)
    } catch (error) {
      logger.warn(
        `Error removing participant ${identity} from ${roomName}: ${
          isErrorWithMessage(error) ? error.message : 'Unknown error'
        }`
      )
      throw new LivekitParticipantNotFoundError(roomName, identity)
    }
  }

  /**
   * Updates a participant's metadata and/or permissions. Metadata is merged with existing metadata.
   *
   * @param roomName - The name of the room
   * @param identity - The unique identifier of the participant
   * @param opts - Update options containing metadata and/or permissions
   * @throws Error if the update fails
   *
   * @example
   * ```typescript
   * await livekit.updateParticipant('my-room', 'user-123', {
   *   metadata: { role: 'moderator' },
   *   permissions: { canPublish: false }
   * })
   * ```
   */
  async function updateParticipant(roomName: string, identity: string, opts: UpdateParticipantOptions): Promise<void> {
    try {
      let metadataStr: string | undefined

      if (opts.metadata) {
        // Get existing metadata and merge
        const participant = await getParticipant(roomName, identity)
        let existingMetadata: Record<string, unknown> = {}

        if (participant?.metadata) {
          try {
            existingMetadata = JSON.parse(participant.metadata)
          } catch {
            logger.warn(`Error parsing existing metadata for participant ${identity}`)
            existingMetadata = {}
          }
        }

        metadataStr = JSON.stringify({ ...existingMetadata, ...opts.metadata })
      }

      await roomClient.updateParticipant(roomName, identity, metadataStr, opts.permissions)
    } catch (error) {
      logger.error(
        `Error updating participant ${identity} in ${roomName}: ${
          isErrorWithMessage(error) ? error.message : 'Unknown error'
        }`
      )
      throw error
    }
  }

  /**
   * Mutes a participant by removing all publish sources
   *
   * @param roomName - The name of the room
   * @param identity - The unique identifier of the participant to mute
   *
   * @example
   * ```typescript
   * await livekit.muteParticipant('my-room', 'user-123')
   * ```
   */
  async function muteParticipant(roomName: string, identity: string): Promise<void> {
    await roomClient.updateParticipant(roomName, identity, undefined, {
      canPublishSources: []
    })
  }

  // ============= INGRESS MANAGEMENT =============

  /**
   * Lists all ingresses, optionally filtered by room name
   *
   * @param roomName - Optional room name to filter ingresses by
   * @returns Array of IngressInfo objects, or empty array if an error occurs
   *
   * @example
   * ```typescript
   * // List all ingresses
   * const allIngresses = await livekit.listIngresses()
   *
   * // List ingresses for a specific room
   * const roomIngresses = await livekit.listIngresses('my-room')
   * ```
   */
  async function listIngresses(roomName?: string): Promise<IngressInfo[]> {
    try {
      return await ingressClient.listIngress({ roomName })
    } catch (error) {
      logger.warn(`Error listing ingresses: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return []
    }
  }

  /**
   * Creates a new ingress for streaming into a room
   *
   * @param inputType - The type of ingress input (RTMP, WHIP, or URL)
   * @param name - A name for the ingress
   * @param roomName - The room to stream into
   * @param participantIdentity - The identity for the ingress participant
   * @param opts - Optional configuration (participantName)
   * @returns The created IngressInfo object
   *
   * @example
   * ```typescript
   * const ingress = await livekit.createIngress(
   *   IngressInput.RTMP_INPUT,
   *   'my-stream',
   *   'my-room',
   *   'streamer-1',
   *   { participantName: 'Live Stream' }
   * )
   * console.log(`Stream URL: ${ingress.url}`)
   * ```
   */
  async function createIngress(
    inputType: IngressInput,
    name: string,
    roomName: string,
    participantIdentity: string,
    opts: CreateIngressOptions = {}
  ): Promise<IngressInfo> {
    return ingressClient.createIngress(inputType, {
      name,
      roomName,
      participantIdentity,
      participantName: opts.participantName
    })
  }

  /**
   * Deletes an ingress by ID
   *
   * @param ingressId - The ID of the ingress to delete
   * @throws LivekitIngressNotFoundError if the ingress cannot be deleted
   *
   * @example
   * ```typescript
   * await livekit.deleteIngress('ingress-123')
   * ```
   */
  async function deleteIngress(ingressId: string): Promise<void> {
    try {
      await ingressClient.deleteIngress(ingressId)
    } catch (error) {
      logger.debug(`Error removing ingress ${ingressId}:`, { error: JSON.stringify(error) })
      throw new LivekitIngressNotFoundError(ingressId)
    }
  }

  /**
   * Gets an existing ingress for a room or creates a new RTMP ingress if none exists
   *
   * @param roomName - The name of the room
   * @param participantIdentity - The identity for the ingress participant (used when creating)
   * @returns The existing or newly created IngressInfo object
   *
   * @example
   * ```typescript
   * const ingress = await livekit.getOrCreateIngress('my-room', 'streamer-1')
   * console.log(`Stream to: ${ingress.url}`)
   * ```
   */
  async function getOrCreateIngress(roomName: string, participantIdentity: string): Promise<IngressInfo> {
    const ingresses = await listIngresses(roomName)

    if (ingresses.length > 0) {
      return ingresses[0]
    }

    const ingress = await createIngress(IngressInput.RTMP_INPUT, `${roomName}-ingress`, roomName, participantIdentity)

    logger.info(`Ingress created for room ${roomName}`, { ingress: JSON.stringify(ingress) })
    return ingress
  }

  // ============= WEBHOOKS =============

  /**
   * Verifies and parses a webhook event from LiveKit
   *
   * @param body - The raw webhook request body
   * @param authorization - The authorization header from the webhook request
   * @returns The parsed WebhookEvent object
   * @throws LivekitWebhookVerificationError if verification fails
   *
   * @example
   * ```typescript
   * // In an HTTP handler
   * const event = await livekit.receiveWebhookEvent(
   *   request.body,
   *   request.headers.authorization
   * )
   * console.log(`Received event: ${event.event}`)
   * ```
   */
  async function receiveWebhookEvent(body: string, authorization: string) {
    try {
      return await webhookReceiver.receive(body, authorization)
    } catch (error) {
      throw new LivekitWebhookVerificationError(isErrorWithMessage(error) ? error.message : 'Unknown error')
    }
  }

  return {
    // Credentials
    generateCredentials,
    buildConnectionUrl,

    // Room naming
    getWorldRoomName,
    getSceneRoomName,
    getIslandRoomName,
    getRoomName,
    getRoomMetadataFromRoomName,
    listRoomsByType,

    // Room management
    listRooms,
    getRoom,
    getOrCreateRoom,
    createRoom,
    deleteRoom,
    updateRoomMetadata,

    // Participant management
    listParticipants,
    getParticipant,
    removeParticipant,
    updateParticipant,
    muteParticipant,

    // Ingress management
    listIngresses,
    createIngress,
    deleteIngress,
    getOrCreateIngress,

    // Webhooks
    receiveWebhookEvent
  }
}
