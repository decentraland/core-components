import { ILoggerComponent, IConfigComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent, createConfigMockedComponent } from '@dcl/core-commons'
import { createLivekitComponent } from '../src/component'
import { ILivekitComponent, IngressInput } from '../src/types'
import {
  LivekitIngressNotFoundError,
  LivekitParticipantNotFoundError,
  LivekitWebhookVerificationError
} from '../src/errors'

// Mock livekit-server-sdk
jest.mock('livekit-server-sdk', () => {
  const mockToJwt = jest.fn().mockResolvedValue('mock-jwt-token')
  const mockAddGrant = jest.fn()

  return {
    AccessToken: jest.fn().mockImplementation(() => ({
      addGrant: mockAddGrant,
      toJwt: mockToJwt
    })),
    RoomServiceClient: jest.fn().mockImplementation(() => ({
      listRooms: jest.fn(),
      createRoom: jest.fn(),
      deleteRoom: jest.fn(),
      updateRoomMetadata: jest.fn(),
      listParticipants: jest.fn(),
      removeParticipant: jest.fn(),
      updateParticipant: jest.fn()
    })),
    IngressClient: jest.fn().mockImplementation(() => ({
      listIngress: jest.fn(),
      createIngress: jest.fn(),
      deleteIngress: jest.fn()
    })),
    WebhookReceiver: jest.fn().mockImplementation(() => ({
      receive: jest.fn()
    })),
    IngressInput: {
      RTMP_INPUT: 0,
      WHIP_INPUT: 1,
      URL_INPUT: 2
    },
    TrackSource: {
      CAMERA: 0,
      MICROPHONE: 1,
      SCREEN_SHARE: 2,
      SCREEN_SHARE_AUDIO: 3
    }
  }
})

let logs: ILoggerComponent
let config: IConfigComponent
let component: ILivekitComponent
let mockRoomClient: any
let mockIngressClient: any
let mockWebhookReceiver: any

let livekitHost: string
let livekitApiKey: string
let livekitApiSecret: string
let livekitPreviewHost: string | undefined
let livekitPreviewApiKey: string | undefined
let livekitPreviewApiSecret: string | undefined

beforeEach(async () => {
  logs = createLoggerMockedComponent()

  livekitHost = 'wss://livekit.example.com'
  livekitApiKey = 'test-api-key'
  livekitApiSecret = 'test-api-secret'
  livekitPreviewHost = undefined
  livekitPreviewApiKey = undefined
  livekitPreviewApiSecret = undefined

  config = createConfigMockedComponent({
    requireString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'LIVEKIT_HOST':
          return livekitHost
        case 'LIVEKIT_API_KEY':
          return livekitApiKey
        case 'LIVEKIT_API_SECRET':
          return livekitApiSecret
        default:
          throw new Error(`Unknown required key: ${key}`)
      }
    }),
    getString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'LIVEKIT_PREVIEW_HOST':
          return livekitPreviewHost
        case 'LIVEKIT_PREVIEW_API_KEY':
          return livekitPreviewApiKey
        case 'LIVEKIT_PREVIEW_API_SECRET':
          return livekitPreviewApiSecret
        case 'LIVEKIT_WORLD_ROOM_PREFIX':
          return 'world-'
        case 'LIVEKIT_SCENE_ROOM_PREFIX':
          return 'scene-'
        case 'LIVEKIT_ISLAND_ROOM_PREFIX':
          return 'island-'
        default:
          return undefined
      }
    })
  })

  // Get the mock instances
  const { RoomServiceClient, IngressClient, WebhookReceiver } = require('livekit-server-sdk')

  component = await createLivekitComponent({ config, logs })

  // Get the mock instances that were created
  mockRoomClient = RoomServiceClient.mock.results[0].value
  mockIngressClient = IngressClient.mock.results[0].value
  mockWebhookReceiver = WebhookReceiver.mock.results[0].value
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('when creating the livekit component', () => {
  describe('and the host URL does not have wss:// prefix', () => {
    beforeEach(() => {
      livekitHost = 'livekit.example.com'
    })

    it('should normalize the host URL by adding wss:// prefix', async () => {
      const livekit = await createLivekitComponent({ config, logs })
      const credentials = await livekit.generateCredentials('test', 'test-room')

      expect(credentials.url).toBe('wss://livekit.example.com')
    })
  })

  describe('and the host URL already has wss:// prefix', () => {
    it('should keep the host URL as-is', async () => {
      const credentials = await component.generateCredentials('test', 'test-room')

      expect(credentials.url).toBe('wss://livekit.example.com')
    })
  })

  describe('and preview environment is configured', () => {
    beforeEach(() => {
      livekitPreviewHost = 'preview.livekit.example.com'
      livekitPreviewApiKey = 'preview-api-key'
      livekitPreviewApiSecret = 'preview-api-secret'
    })

    it('should use preview settings when forPreview is true', async () => {
      const livekit = await createLivekitComponent({ config, logs })
      const credentials = await livekit.generateCredentials('test', 'test-room', { forPreview: true })

      expect(credentials.url).toBe('wss://preview.livekit.example.com')
    })

    it('should use production settings when forPreview is false', async () => {
      const livekit = await createLivekitComponent({ config, logs })
      const credentials = await livekit.generateCredentials('test', 'test-room', { forPreview: false })

      expect(credentials.url).toBe('wss://livekit.example.com')
    })
  })

  describe('and room prefixes are not configured', () => {
    beforeEach(() => {
      config = createConfigMockedComponent({
        requireString: jest.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'LIVEKIT_HOST':
              return livekitHost
            case 'LIVEKIT_API_KEY':
              return livekitApiKey
            case 'LIVEKIT_API_SECRET':
              return livekitApiSecret
            default:
              throw new Error(`Unknown required key: ${key}`)
          }
        }),
        getString: jest.fn().mockReturnValue(undefined)
      })
    })

    it('should use default prefixes', async () => {
      const livekit = await createLivekitComponent({ config, logs })

      expect(livekit.getWorldRoomName('test')).toBe('world-test')
      expect(livekit.getSceneRoomName('realm', 'scene')).toBe('scene-realm:scene')
      expect(livekit.getIslandRoomName('island')).toBe('island-island')
    })
  })
})

describe('when generating credentials', () => {
  let mockAccessToken: any
  let mockAddGrant: jest.Mock

  beforeEach(() => {
    const { AccessToken } = require('livekit-server-sdk')
    mockAccessToken = AccessToken
    mockAddGrant = mockAccessToken.mock.results[0]?.value?.addGrant || jest.fn()
  })

  describe('and using default permissions', () => {
    it('should generate credentials with url and token', async () => {
      const credentials = await component.generateCredentials('user-123', 'my-room')

      expect(credentials).toEqual({
        url: 'wss://livekit.example.com',
        token: 'mock-jwt-token'
      })
    })

    it('should create access token with correct identity', async () => {
      await component.generateCredentials('user-123', 'my-room')

      expect(mockAccessToken).toHaveBeenCalledWith(
        'test-api-key',
        'test-api-secret',
        expect.objectContaining({
          identity: 'user-123',
          ttl: 300
        })
      )
    })
  })

  describe('and using custom permissions', () => {
    let permissions: { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean }

    beforeEach(() => {
      permissions = {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false
      }
    })

    it('should generate credentials with the provided permissions', async () => {
      const credentials = await component.generateCredentials('user-123', 'my-room', { permissions })

      expect(credentials.token).toBe('mock-jwt-token')
    })
  })

  describe('and providing metadata', () => {
    let metadata: { displayName: string; role: string }

    beforeEach(() => {
      metadata = { displayName: 'John Doe', role: 'moderator' }
    })

    it('should generate credentials with the provided metadata', async () => {
      const credentials = await component.generateCredentials('user-123', 'my-room', { metadata })

      expect(credentials.token).toBe('mock-jwt-token')
    })

    it('should create access token with stringified metadata', async () => {
      await component.generateCredentials('user-123', 'my-room', { metadata })

      expect(mockAccessToken).toHaveBeenCalledWith(
        'test-api-key',
        'test-api-secret',
        expect.objectContaining({
          metadata: JSON.stringify(metadata)
        })
      )
    })
  })

  describe('and providing a custom TTL', () => {
    let ttlSeconds: number

    beforeEach(() => {
      ttlSeconds = 600
    })

    it('should generate credentials with the provided TTL', async () => {
      const credentials = await component.generateCredentials('user-123', 'my-room', { ttlSeconds })

      expect(credentials.token).toBe('mock-jwt-token')
    })

    it('should create access token with the provided TTL', async () => {
      await component.generateCredentials('user-123', 'my-room', { ttlSeconds })

      expect(mockAccessToken).toHaveBeenCalledWith(
        'test-api-key',
        'test-api-secret',
        expect.objectContaining({
          ttl: ttlSeconds
        })
      )
    })
  })
})

describe('when building connection URL', () => {
  it('should build a connection URL from host and token', () => {
    const url = component.buildConnectionUrl('wss://livekit.example.com', 'my-token')
    expect(url).toBe('livekit:wss://livekit.example.com?access_token=my-token')
  })
})

describe('when using room naming utilities', () => {
  describe('and getting a world room name', () => {
    it('should return the prefixed world room name', () => {
      const roomName = component.getWorldRoomName('my-world')
      expect(roomName).toBe('world-my-world')
    })
  })

  describe('and getting a scene room name', () => {
    it('should return the prefixed scene room name', () => {
      const roomName = component.getSceneRoomName('realm-1', 'scene-abc')
      expect(roomName).toBe('scene-realm-1:scene-abc')
    })
  })

  describe('and getting an island room name', () => {
    it('should return the prefixed island room name', () => {
      const roomName = component.getIslandRoomName('island-123')
      expect(roomName).toBe('island-island-123')
    })
  })

  describe('and getting a room name by type', () => {
    it('should return a world room name for world type', () => {
      const roomName = component.getRoomName('my-world', { type: 'world' })
      expect(roomName).toBe('world-my-world')
    })

    it('should return a scene room name for scene type', () => {
      const roomName = component.getRoomName('realm-1', { type: 'scene', sceneId: 'scene-abc' })
      expect(roomName).toBe('scene-realm-1:scene-abc')
    })

    it('should return an island room name for island type', () => {
      const roomName = component.getRoomName('island-123', { type: 'island' })
      expect(roomName).toBe('island-island-123')
    })

    it('should throw an error if sceneId is not provided for scene type', () => {
      expect(() => component.getRoomName('realm-1', { type: 'scene' })).toThrow('No sceneId provided for scene room')
    })

    it('should throw an error for unknown room type', () => {
      expect(() => component.getRoomName('test', { type: 'unknown' as any })).toThrow('Unknown room type: unknown')
    })
  })

  describe('and extracting metadata from a room name', () => {
    it('should extract metadata from a scene room name', () => {
      const metadata = component.getRoomMetadataFromRoomName('scene-realm-1:scene-abc')
      expect(metadata).toEqual({
        realmName: 'realm-1',
        sceneId: 'scene-abc',
        worldName: undefined,
        islandName: undefined
      })
    })

    it('should extract metadata from a world room name', () => {
      const metadata = component.getRoomMetadataFromRoomName('world-my-world')
      expect(metadata).toEqual({
        realmName: undefined,
        sceneId: undefined,
        worldName: 'my-world',
        islandName: undefined
      })
    })

    it('should extract metadata from an island room name', () => {
      const metadata = component.getRoomMetadataFromRoomName('island-island-123')
      expect(metadata).toEqual({
        realmName: undefined,
        sceneId: undefined,
        worldName: undefined,
        islandName: 'island-123'
      })
    })
  })

  describe('and listing rooms by type', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([
        { name: 'world-world-1' },
        { name: 'world-world-2' },
        { name: 'scene-realm-1:scene-1' },
        { name: 'island-island-1' }
      ])
    })

    it('should list only world rooms', async () => {
      const rooms = await component.listRoomsByType('world')
      expect(rooms).toEqual([{ name: 'world-world-1' }, { name: 'world-world-2' }])
    })

    it('should list only scene rooms', async () => {
      const rooms = await component.listRoomsByType('scene')
      expect(rooms).toEqual([{ name: 'scene-realm-1:scene-1' }])
    })

    it('should list only island rooms', async () => {
      const rooms = await component.listRoomsByType('island')
      expect(rooms).toEqual([{ name: 'island-island-1' }])
    })
  })
})

describe('when listing rooms', () => {
  describe('and no filter is provided', () => {
    let mockRooms: { name: string }[]

    beforeEach(() => {
      mockRooms = [{ name: 'room-1' }, { name: 'room-2' }]
      mockRoomClient.listRooms.mockResolvedValue(mockRooms)
    })

    it('should list all rooms', async () => {
      const rooms = await component.listRooms()

      expect(rooms).toEqual(mockRooms)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(undefined)
    })
  })

  describe('and a filter by names is provided', () => {
    let mockRooms: { name: string }[]

    beforeEach(() => {
      mockRooms = [{ name: 'room-1' }]
      mockRoomClient.listRooms.mockResolvedValue(mockRooms)
    })

    it('should list rooms filtered by the provided names', async () => {
      const rooms = await component.listRooms(['room-1'])

      expect(rooms).toEqual(mockRooms)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(['room-1'])
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockRejectedValue(new Error('Connection failed'))
    })

    it('should return an empty array', async () => {
      const rooms = await component.listRooms()

      expect(rooms).toEqual([])
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should return an empty array', async () => {
      const rooms = await component.listRooms()

      expect(rooms).toEqual([])
    })
  })
})

describe('when getting a room', () => {
  describe('and the room exists', () => {
    let mockRoom: { name: string; numParticipants: number }

    beforeEach(() => {
      mockRoom = { name: 'my-room', numParticipants: 5 }
      mockRoomClient.listRooms.mockResolvedValue([mockRoom])
    })

    it('should return the room', async () => {
      const room = await component.getRoom('my-room')

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(['my-room'])
    })
  })

  describe('and the room does not exist', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([])
    })

    it('should return null', async () => {
      const room = await component.getRoom('non-existent')

      expect(room).toBeNull()
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockRejectedValue(new Error('Connection failed'))
    })

    it('should return null', async () => {
      const room = await component.getRoom('my-room')

      expect(room).toBeNull()
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should return null', async () => {
      const room = await component.getRoom('my-room')

      expect(room).toBeNull()
    })
  })
})

describe('when creating a room', () => {
  describe('and only the name is provided', () => {
    let mockRoom: { name: string }

    beforeEach(() => {
      mockRoom = { name: 'new-room' }
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)
    })

    it('should create a room with the provided name', async () => {
      const room = await component.createRoom('new-room')

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).toHaveBeenCalledWith({
        name: 'new-room',
        maxParticipants: undefined,
        emptyTimeout: undefined,
        metadata: undefined
      })
    })
  })

  describe('and all options are provided', () => {
    let mockRoom: { name: string }

    beforeEach(() => {
      mockRoom = { name: 'new-room' }
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)
    })

    it('should create a room with all the provided options', async () => {
      const room = await component.createRoom('new-room', {
        maxParticipants: 100,
        emptyTimeout: 300,
        metadata: { description: 'Test room' }
      })

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).toHaveBeenCalledWith({
        name: 'new-room',
        maxParticipants: 100,
        emptyTimeout: 300,
        metadata: '{"description":"Test room"}'
      })
    })
  })
})

describe('when getting or creating a room', () => {
  describe('and the room already exists', () => {
    let mockRoom: { name: string }

    beforeEach(() => {
      mockRoom = { name: 'existing-room' }
      mockRoomClient.listRooms.mockResolvedValue([mockRoom])
    })

    it('should return the existing room without creating a new one', async () => {
      const room = await component.getOrCreateRoom('existing-room')

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).not.toHaveBeenCalled()
    })
  })

  describe('and the room does not exist', () => {
    let mockRoom: { name: string }

    beforeEach(() => {
      mockRoom = { name: 'new-room' }
      mockRoomClient.listRooms.mockResolvedValue([])
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)
    })

    it('should create and return a new room', async () => {
      const room = await component.getOrCreateRoom('new-room')

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).toHaveBeenCalled()
    })
  })
})

describe('when deleting a room', () => {
  describe('and the deletion succeeds', () => {
    beforeEach(() => {
      mockRoomClient.deleteRoom.mockResolvedValue(undefined)
    })

    it('should delete the room successfully', async () => {
      await component.deleteRoom('my-room')

      expect(mockRoomClient.deleteRoom).toHaveBeenCalledWith('my-room')
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.deleteRoom.mockRejectedValue(new Error('Room not found'))
    })

    it('should not throw an error', async () => {
      await expect(component.deleteRoom('non-existent')).resolves.not.toThrow()
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.deleteRoom.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should not throw an error', async () => {
      await expect(component.deleteRoom('non-existent')).resolves.not.toThrow()
    })
  })
})

describe('when updating room metadata', () => {
  describe('and the room has empty metadata', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{}' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)
    })

    it('should update with the new metadata', async () => {
      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"key":"value"}')
    })
  })

  describe('and the room has existing metadata', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{"existing":"data"}' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)
    })

    it('should merge with the existing metadata', async () => {
      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"existing":"data","key":"value"}')
    })
  })

  describe('and the room has invalid JSON metadata', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: 'invalid-json' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)
    })

    it('should replace the invalid metadata with the new metadata', async () => {
      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"key":"value"}')
    })
  })

  describe('and the update fails', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{}' }])
      mockRoomClient.updateRoomMetadata.mockRejectedValue(new Error('Update failed'))
    })

    it('should throw the error', async () => {
      await expect(component.updateRoomMetadata('my-room', { key: 'value' })).rejects.toThrow('Update failed')
    })
  })

  describe('and the update fails with an error without message', () => {
    beforeEach(() => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{}' }])
      mockRoomClient.updateRoomMetadata.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should throw the error', async () => {
      await expect(component.updateRoomMetadata('my-room', { key: 'value' })).rejects.toEqual({ code: 'UNKNOWN' })
    })
  })
})

describe('when listing participants', () => {
  describe('and the room has participants', () => {
    let mockParticipants: { identity: string; name: string }[]

    beforeEach(() => {
      mockParticipants = [
        { identity: 'user-1', name: 'User 1' },
        { identity: 'user-2', name: 'User 2' }
      ]
      mockRoomClient.listParticipants.mockResolvedValue(mockParticipants)
    })

    it('should return the list of participants', async () => {
      const participants = await component.listParticipants('my-room')

      expect(participants).toEqual(mockParticipants)
      expect(mockRoomClient.listParticipants).toHaveBeenCalledWith('my-room')
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockRejectedValue(new Error('Room not found'))
    })

    it('should return an empty array', async () => {
      const participants = await component.listParticipants('my-room')

      expect(participants).toEqual([])
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should return an empty array', async () => {
      const participants = await component.listParticipants('my-room')

      expect(participants).toEqual([])
    })
  })
})

describe('when getting a participant', () => {
  describe('and the participant exists', () => {
    let mockParticipant: { identity: string; name: string }

    beforeEach(() => {
      mockParticipant = { identity: 'user-1', name: 'User 1' }
      mockRoomClient.listParticipants.mockResolvedValue([mockParticipant])
    })

    it('should return the participant', async () => {
      const participant = await component.getParticipant('my-room', 'user-1')

      expect(participant).toEqual(mockParticipant)
    })
  })

  describe('and the participant does not exist', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([])
    })

    it('should return null', async () => {
      const participant = await component.getParticipant('my-room', 'non-existent')

      expect(participant).toBeNull()
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockRejectedValue(new Error('Room not found'))
    })

    it('should return null', async () => {
      const participant = await component.getParticipant('my-room', 'user-1')

      expect(participant).toBeNull()
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should return null', async () => {
      const participant = await component.getParticipant('my-room', 'user-1')

      expect(participant).toBeNull()
    })
  })
})

describe('when removing a participant', () => {
  describe('and the removal succeeds', () => {
    beforeEach(() => {
      mockRoomClient.removeParticipant.mockResolvedValue(undefined)
    })

    it('should remove the participant from the room', async () => {
      await component.removeParticipant('my-room', 'user-1')

      expect(mockRoomClient.removeParticipant).toHaveBeenCalledWith('my-room', 'user-1')
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockRoomClient.removeParticipant.mockRejectedValue(new Error('Participant not found'))
    })

    it('should throw LivekitParticipantNotFoundError', async () => {
      await expect(component.removeParticipant('my-room', 'non-existent')).rejects.toThrow(
        LivekitParticipantNotFoundError
      )
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockRoomClient.removeParticipant.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should throw LivekitParticipantNotFoundError', async () => {
      await expect(component.removeParticipant('my-room', 'non-existent')).rejects.toThrow(
        LivekitParticipantNotFoundError
      )
    })
  })
})

describe('when updating a participant', () => {
  describe('and updating metadata only', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{}' }])
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)
    })

    it('should update the participant metadata', async () => {
      await component.updateParticipant('my-room', 'user-1', {
        metadata: { role: 'moderator' }
      })

      expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith(
        'my-room',
        'user-1',
        '{"role":"moderator"}',
        undefined
      )
    })
  })

  describe('and updating permissions only', () => {
    beforeEach(() => {
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)
    })

    it('should update the participant permissions', async () => {
      await component.updateParticipant('my-room', 'user-1', {
        permissions: { canPublish: false }
      })

      expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith('my-room', 'user-1', undefined, {
        canPublish: false
      })
    })
  })

  describe('and the participant has existing metadata', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{"existing":"data"}' }])
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)
    })

    it('should merge with the existing metadata', async () => {
      await component.updateParticipant('my-room', 'user-1', {
        metadata: { newKey: 'newValue' }
      })

      expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith(
        'my-room',
        'user-1',
        '{"existing":"data","newKey":"newValue"}',
        undefined
      )
    })
  })

  describe('and the participant has invalid JSON metadata', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: 'invalid-json' }])
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)
    })

    it('should replace the invalid metadata with the new metadata', async () => {
      await component.updateParticipant('my-room', 'user-1', {
        metadata: { newKey: 'newValue' }
      })

      expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith(
        'my-room',
        'user-1',
        '{"newKey":"newValue"}',
        undefined
      )
    })
  })

  describe('and the update fails', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{}' }])
      mockRoomClient.updateParticipant.mockRejectedValue(new Error('Update failed'))
    })

    it('should throw the error', async () => {
      await expect(
        component.updateParticipant('my-room', 'user-1', { metadata: { role: 'moderator' } })
      ).rejects.toThrow('Update failed')
    })
  })

  describe('and the update fails with an error without message', () => {
    beforeEach(() => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{}' }])
      mockRoomClient.updateParticipant.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should throw the error', async () => {
      await expect(
        component.updateParticipant('my-room', 'user-1', { metadata: { role: 'moderator' } })
      ).rejects.toEqual({ code: 'UNKNOWN' })
    })
  })
})

describe('when muting a participant', () => {
  beforeEach(() => {
    mockRoomClient.updateParticipant.mockResolvedValue(undefined)
  })

  it('should mute the participant by removing publish sources', async () => {
    await component.muteParticipant('my-room', 'user-1')

    expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith('my-room', 'user-1', undefined, {
      canPublishSources: []
    })
  })
})

describe('when listing ingresses', () => {
  describe('and no room filter is provided', () => {
    let mockIngresses: { ingressId: string }[]

    beforeEach(() => {
      mockIngresses = [{ ingressId: 'ing-1' }, { ingressId: 'ing-2' }]
      mockIngressClient.listIngress.mockResolvedValue(mockIngresses)
    })

    it('should list all ingresses', async () => {
      const ingresses = await component.listIngresses()

      expect(ingresses).toEqual(mockIngresses)
      expect(mockIngressClient.listIngress).toHaveBeenCalledWith({ roomName: undefined })
    })
  })

  describe('and a room filter is provided', () => {
    let mockIngresses: { ingressId: string }[]

    beforeEach(() => {
      mockIngresses = [{ ingressId: 'ing-1' }]
      mockIngressClient.listIngress.mockResolvedValue(mockIngresses)
    })

    it('should list ingresses filtered by the provided room', async () => {
      const ingresses = await component.listIngresses('my-room')

      expect(ingresses).toEqual(mockIngresses)
      expect(mockIngressClient.listIngress).toHaveBeenCalledWith({ roomName: 'my-room' })
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockIngressClient.listIngress.mockRejectedValue(new Error('Connection failed'))
    })

    it('should return an empty array', async () => {
      const ingresses = await component.listIngresses()

      expect(ingresses).toEqual([])
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockIngressClient.listIngress.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should return an empty array', async () => {
      const ingresses = await component.listIngresses()

      expect(ingresses).toEqual([])
    })
  })
})

describe('when creating an ingress', () => {
  let mockIngress: { ingressId: string; url: string }

  beforeEach(() => {
    mockIngress = { ingressId: 'ing-1', url: 'rtmp://...' }
    mockIngressClient.createIngress.mockResolvedValue(mockIngress)
  })

  it('should create an ingress with the provided options', async () => {
    const ingress = await component.createIngress(IngressInput.RTMP_INPUT, 'my-stream', 'my-room', 'streamer-1')

    expect(ingress).toEqual(mockIngress)
    expect(mockIngressClient.createIngress).toHaveBeenCalledWith(IngressInput.RTMP_INPUT, {
      name: 'my-stream',
      roomName: 'my-room',
      participantIdentity: 'streamer-1',
      participantName: undefined
    })
  })
})

describe('when deleting an ingress', () => {
  describe('and the deletion succeeds', () => {
    beforeEach(() => {
      mockIngressClient.deleteIngress.mockResolvedValue(undefined)
    })

    it('should delete the ingress successfully', async () => {
      await component.deleteIngress('ing-1')

      expect(mockIngressClient.deleteIngress).toHaveBeenCalledWith('ing-1')
    })
  })

  describe('and an error occurs', () => {
    beforeEach(() => {
      mockIngressClient.deleteIngress.mockRejectedValue(new Error('Not found'))
    })

    it('should throw LivekitIngressNotFoundError', async () => {
      await expect(component.deleteIngress('non-existent')).rejects.toThrow(LivekitIngressNotFoundError)
    })
  })
})

describe('when getting or creating an ingress', () => {
  describe('and the ingress already exists', () => {
    let mockIngress: { ingressId: string }

    beforeEach(() => {
      mockIngress = { ingressId: 'ing-1' }
      mockIngressClient.listIngress.mockResolvedValue([mockIngress])
    })

    it('should return the existing ingress without creating a new one', async () => {
      const ingress = await component.getOrCreateIngress('my-room', 'streamer-1')

      expect(ingress).toEqual(mockIngress)
      expect(mockIngressClient.createIngress).not.toHaveBeenCalled()
    })
  })

  describe('and the ingress does not exist', () => {
    let mockIngress: { ingressId: string }

    beforeEach(() => {
      mockIngress = { ingressId: 'ing-new' }
      mockIngressClient.listIngress.mockResolvedValue([])
      mockIngressClient.createIngress.mockResolvedValue(mockIngress)
    })

    it('should create and return a new ingress', async () => {
      const ingress = await component.getOrCreateIngress('my-room', 'streamer-1')

      expect(ingress).toEqual(mockIngress)
      expect(mockIngressClient.createIngress).toHaveBeenCalled()
    })
  })
})

describe('when receiving a webhook event', () => {
  describe('and the webhook is valid', () => {
    let mockEvent: { event: string; room: { name: string } }

    beforeEach(() => {
      mockEvent = { event: 'participant_joined', room: { name: 'my-room' } }
      mockWebhookReceiver.receive.mockResolvedValue(mockEvent)
    })

    it('should parse and return the webhook event', async () => {
      const event = await component.receiveWebhookEvent('body', 'auth-header')

      expect(event).toEqual(mockEvent)
      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith('body', 'auth-header')
    })
  })

  describe('and the webhook is invalid', () => {
    beforeEach(() => {
      mockWebhookReceiver.receive.mockRejectedValue(new Error('Invalid signature'))
    })

    it('should throw LivekitWebhookVerificationError', async () => {
      await expect(component.receiveWebhookEvent('body', 'invalid-auth')).rejects.toThrow(
        LivekitWebhookVerificationError
      )
    })
  })

  describe('and an error without message occurs', () => {
    beforeEach(() => {
      mockWebhookReceiver.receive.mockRejectedValue({ code: 'UNKNOWN' })
    })

    it('should throw LivekitWebhookVerificationError with Unknown error message', async () => {
      await expect(component.receiveWebhookEvent('body', 'invalid-auth')).rejects.toThrow(
        'LiveKit webhook verification failed: Unknown error'
      )
    })
  })
})
