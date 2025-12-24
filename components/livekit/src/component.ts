import { ILoggerComponent } from '@well-known-components/interfaces'
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
  ILivekitComponent,
  LivekitComponentOptions,
  LivekitCredentials,
  UpdateParticipantOptions
} from './types'
import { LivekitIngressNotFoundError, LivekitWebhookVerificationError } from './errors'

/**
 * Creates a LiveKit component for managing rooms, participants, and credentials
 *
 * @example
 * ```typescript
 * const livekit = await createLivekitComponent(
 *   { logs },
 *   {
 *     settings: {
 *       host: 'wss://livekit.example.com',
 *       apiKey: 'your-api-key',
 *       secret: 'your-api-secret'
 *     }
 *   }
 * )
 *
 * // Generate credentials for a participant
 * const credentials = await livekit.generateCredentials({
 *   identity: 'user-123',
 *   roomName: 'my-room',
 *   permissions: { canPublish: true, canSubscribe: true }
 * })
 * ```
 */
export async function createLivekitComponent(
  components: { logs: ILoggerComponent },
  options: LivekitComponentOptions
): Promise<ILivekitComponent> {
  const { logs } = components
  const { settings } = options

  const logger = logs.getLogger('livekit-component')

  // Normalize host URL to ensure it starts with wss://
  const normalizedHost = settings.host.startsWith('wss://') ? settings.host : `wss://${settings.host}`

  // Initialize LiveKit clients
  const roomClient = new RoomServiceClient(normalizedHost, settings.apiKey, settings.secret)
  const ingressClient = new IngressClient(normalizedHost, settings.apiKey, settings.secret)
  const webhookReceiver = new WebhookReceiver(settings.apiKey, settings.secret)

  // ============= CREDENTIALS =============

  async function generateCredentials(opts: GenerateCredentialsOptions): Promise<LivekitCredentials> {
    const { identity, roomName, permissions = {}, metadata, ttlSeconds = 300 } = opts

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
      url: normalizedHost,
      token: await token.toJwt()
    }
  }

  function buildConnectionUrl(url: string, token: string): string {
    return `livekit:${url}?access_token=${token}`
  }

  // ============= ROOM MANAGEMENT =============

  async function listRooms(names?: string[]): Promise<Room[]> {
    try {
      return await roomClient.listRooms(names)
    } catch (error) {
      logger.warn(`Error listing rooms: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return []
    }
  }

  async function getRoom(roomName: string): Promise<Room | null> {
    try {
      const rooms = await roomClient.listRooms([roomName])
      return rooms.length > 0 ? rooms[0] : null
    } catch (error) {
      logger.warn(`Error getting room ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return null
    }
  }

  async function createRoom(opts: CreateRoomOptions): Promise<Room> {
    const metadata =
      typeof opts.metadata === 'object' && opts.metadata !== null ? JSON.stringify(opts.metadata) : opts.metadata

    return roomClient.createRoom({
      name: opts.name,
      maxParticipants: opts.maxParticipants,
      emptyTimeout: opts.emptyTimeout,
      metadata
    })
  }

  async function getOrCreateRoom(opts: CreateRoomOptions): Promise<Room> {
    const existingRoom = await getRoom(opts.name)
    if (existingRoom) {
      return existingRoom
    }
    return createRoom(opts)
  }

  async function deleteRoom(roomName: string): Promise<void> {
    logger.info(`Deleting room ${roomName}`)
    try {
      await roomClient.deleteRoom(roomName)
    } catch (error) {
      logger.warn(`Error deleting room ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
    }
  }

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

  async function getParticipant(roomName: string, identity: string): Promise<ParticipantInfo | null> {
    try {
      const participants = await roomClient.listParticipants(roomName)
      return participants.find((p) => p.identity === identity) || null
    } catch (error) {
      logger.warn(
        `Error getting participant ${identity} in ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      )
      return null
    }
  }

  async function removeParticipant(roomName: string, identity: string): Promise<void> {
    await roomClient.removeParticipant(roomName, identity)
  }

  async function updateParticipant(
    roomName: string,
    identity: string,
    opts: UpdateParticipantOptions
  ): Promise<void> {
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
        `Error updating participant ${identity} in ${roomName}: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      )
      throw error
    }
  }

  async function muteParticipant(roomName: string, identity: string): Promise<void> {
    await roomClient.updateParticipant(roomName, identity, undefined, {
      canPublishSources: []
    })
  }

  // ============= INGRESS MANAGEMENT =============

  async function listIngresses(roomName?: string): Promise<IngressInfo[]> {
    try {
      return await ingressClient.listIngress({ roomName })
    } catch (error) {
      logger.warn(`Error listing ingresses: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      return []
    }
  }

  async function createIngress(opts: CreateIngressOptions): Promise<IngressInfo> {
    return ingressClient.createIngress(opts.inputType, {
      name: opts.name,
      roomName: opts.roomName,
      participantIdentity: opts.participantIdentity,
      participantName: opts.participantName
    })
  }

  async function deleteIngress(ingressId: string): Promise<void> {
    try {
      await ingressClient.deleteIngress(ingressId)
    } catch (error) {
      logger.debug(`Error removing ingress ${ingressId}:`, { error: JSON.stringify(error) })
      throw new LivekitIngressNotFoundError(ingressId)
    }
  }

  async function getOrCreateIngress(roomName: string, participantIdentity: string): Promise<IngressInfo> {
    const ingresses = await listIngresses(roomName)

    if (ingresses.length > 0) {
      return ingresses[0]
    }

    const ingress = await createIngress({
      inputType: IngressInput.RTMP_INPUT,
      name: `${roomName}-ingress`,
      roomName,
      participantIdentity
    })

    logger.info(`Ingress created for room ${roomName}`, { ingress: JSON.stringify(ingress) })
    return ingress
  }

  // ============= WEBHOOKS =============

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

