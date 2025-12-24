import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createLivekitComponent } from '../src/component'
import { ILivekitComponent, LivekitSettings, IngressInput } from '../src/types'
import { LivekitIngressNotFoundError, LivekitWebhookVerificationError } from '../src/errors'

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
let component: ILivekitComponent
let settings: LivekitSettings
let mockRoomClient: any
let mockIngressClient: any
let mockWebhookReceiver: any

beforeEach(async () => {
  logs = createLoggerMockedComponent()
  settings = {
    host: 'wss://livekit.example.com',
    apiKey: 'test-api-key',
    secret: 'test-api-secret'
  }

  // Get the mock instances
  const { RoomServiceClient, IngressClient, WebhookReceiver } = require('livekit-server-sdk')

  component = await createLivekitComponent({ logs }, { settings })

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
    it('should normalize the host URL by adding wss:// prefix', async () => {
      const settingsWithoutProtocol = {
        ...settings,
        host: 'livekit.example.com'
      }

      const comp = await createLivekitComponent({ logs }, { settings: settingsWithoutProtocol })
      const credentials = await comp.generateCredentials({
        identity: 'test',
        roomName: 'test-room'
      })

      expect(credentials.url).toBe('wss://livekit.example.com')
    })
  })

  describe('and the host URL already has wss:// prefix', () => {
    it('should keep the host URL as-is', async () => {
      const credentials = await component.generateCredentials({
        identity: 'test',
        roomName: 'test-room'
      })

      expect(credentials.url).toBe('wss://livekit.example.com')
    })
  })
})

describe('when generating credentials', () => {
  describe('and using default permissions', () => {
    it('should generate credentials with url and token', async () => {
      const credentials = await component.generateCredentials({
        identity: 'user-123',
        roomName: 'my-room'
      })

      expect(credentials).toEqual({
        url: 'wss://livekit.example.com',
        token: 'mock-jwt-token'
      })
    })
  })

  describe('and using custom permissions', () => {
    it('should generate credentials with the provided permissions', async () => {
      const credentials = await component.generateCredentials({
        identity: 'user-123',
        roomName: 'my-room',
        permissions: {
          canPublish: false,
          canSubscribe: true,
          canPublishData: false
        }
      })

      expect(credentials.token).toBe('mock-jwt-token')
    })
  })

  describe('and providing metadata', () => {
    it('should generate credentials with the provided metadata', async () => {
      const credentials = await component.generateCredentials({
        identity: 'user-123',
        roomName: 'my-room',
        metadata: { displayName: 'John Doe', role: 'moderator' }
      })

      expect(credentials.token).toBe('mock-jwt-token')
    })
  })

  describe('and providing a custom TTL', () => {
    it('should generate credentials with the provided TTL', async () => {
      const credentials = await component.generateCredentials({
        identity: 'user-123',
        roomName: 'my-room',
        ttlSeconds: 600
      })

      expect(credentials.token).toBe('mock-jwt-token')
    })
  })
})

describe('when building connection URL', () => {
  it('should build a connection URL from host and token', () => {
    const url = component.buildConnectionUrl('wss://livekit.example.com', 'my-token')
    expect(url).toBe('livekit:wss://livekit.example.com?access_token=my-token')
  })
})

describe('when listing rooms', () => {
  describe('and no filter is provided', () => {
    it('should list all rooms', async () => {
      const mockRooms = [{ name: 'room-1' }, { name: 'room-2' }]
      mockRoomClient.listRooms.mockResolvedValue(mockRooms)

      const rooms = await component.listRooms()

      expect(rooms).toEqual(mockRooms)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(undefined)
    })
  })

  describe('and a filter by names is provided', () => {
    it('should list rooms filtered by the provided names', async () => {
      const mockRooms = [{ name: 'room-1' }]
      mockRoomClient.listRooms.mockResolvedValue(mockRooms)

      const rooms = await component.listRooms(['room-1'])

      expect(rooms).toEqual(mockRooms)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(['room-1'])
    })
  })

  describe('and an error occurs', () => {
    it('should return an empty array', async () => {
      mockRoomClient.listRooms.mockRejectedValue(new Error('Connection failed'))

      const rooms = await component.listRooms()

      expect(rooms).toEqual([])
    })
  })
})

describe('when getting a room', () => {
  describe('and the room exists', () => {
    it('should return the room', async () => {
      const mockRoom = { name: 'my-room', numParticipants: 5 }
      mockRoomClient.listRooms.mockResolvedValue([mockRoom])

      const room = await component.getRoom('my-room')

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.listRooms).toHaveBeenCalledWith(['my-room'])
    })
  })

  describe('and the room does not exist', () => {
    it('should return null', async () => {
      mockRoomClient.listRooms.mockResolvedValue([])

      const room = await component.getRoom('non-existent')

      expect(room).toBeNull()
    })
  })

  describe('and an error occurs', () => {
    it('should return null', async () => {
      mockRoomClient.listRooms.mockRejectedValue(new Error('Connection failed'))

      const room = await component.getRoom('my-room')

      expect(room).toBeNull()
    })
  })
})

describe('when creating a room', () => {
  describe('and only the name is provided', () => {
    it('should create a room with the provided name', async () => {
      const mockRoom = { name: 'new-room' }
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)

      const room = await component.createRoom({ name: 'new-room' })

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
    it('should create a room with all the provided options', async () => {
      const mockRoom = { name: 'new-room' }
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)

      const room = await component.createRoom({
        name: 'new-room',
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
    it('should return the existing room without creating a new one', async () => {
      const mockRoom = { name: 'existing-room' }
      mockRoomClient.listRooms.mockResolvedValue([mockRoom])

      const room = await component.getOrCreateRoom({ name: 'existing-room' })

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).not.toHaveBeenCalled()
    })
  })

  describe('and the room does not exist', () => {
    it('should create and return a new room', async () => {
      const mockRoom = { name: 'new-room' }
      mockRoomClient.listRooms.mockResolvedValue([])
      mockRoomClient.createRoom.mockResolvedValue(mockRoom)

      const room = await component.getOrCreateRoom({ name: 'new-room' })

      expect(room).toEqual(mockRoom)
      expect(mockRoomClient.createRoom).toHaveBeenCalled()
    })
  })
})

describe('when deleting a room', () => {
  describe('and the deletion succeeds', () => {
    it('should delete the room successfully', async () => {
      mockRoomClient.deleteRoom.mockResolvedValue(undefined)

      await component.deleteRoom('my-room')

      expect(mockRoomClient.deleteRoom).toHaveBeenCalledWith('my-room')
    })
  })

  describe('and an error occurs', () => {
    it('should not throw an error', async () => {
      mockRoomClient.deleteRoom.mockRejectedValue(new Error('Room not found'))

      await expect(component.deleteRoom('non-existent')).resolves.not.toThrow()
    })
  })
})

describe('when updating room metadata', () => {
  describe('and the room has empty metadata', () => {
    it('should update with the new metadata', async () => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{}' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)

      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"key":"value"}')
    })
  })

  describe('and the room has existing metadata', () => {
    it('should merge with the existing metadata', async () => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: '{"existing":"data"}' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)

      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"existing":"data","key":"value"}')
    })
  })

  describe('and the room has invalid JSON metadata', () => {
    it('should replace the invalid metadata with the new metadata', async () => {
      mockRoomClient.listRooms.mockResolvedValue([{ name: 'my-room', metadata: 'invalid-json' }])
      mockRoomClient.updateRoomMetadata.mockResolvedValue(undefined)

      await component.updateRoomMetadata('my-room', { key: 'value' })

      expect(mockRoomClient.updateRoomMetadata).toHaveBeenCalledWith('my-room', '{"key":"value"}')
    })
  })
})

describe('when listing participants', () => {
  describe('and the room has participants', () => {
    it('should return the list of participants', async () => {
      const mockParticipants = [
        { identity: 'user-1', name: 'User 1' },
        { identity: 'user-2', name: 'User 2' }
      ]
      mockRoomClient.listParticipants.mockResolvedValue(mockParticipants)

      const participants = await component.listParticipants('my-room')

      expect(participants).toEqual(mockParticipants)
      expect(mockRoomClient.listParticipants).toHaveBeenCalledWith('my-room')
    })
  })

  describe('and an error occurs', () => {
    it('should return an empty array', async () => {
      mockRoomClient.listParticipants.mockRejectedValue(new Error('Room not found'))

      const participants = await component.listParticipants('my-room')

      expect(participants).toEqual([])
    })
  })
})

describe('when getting a participant', () => {
  describe('and the participant exists', () => {
    it('should return the participant', async () => {
      const mockParticipant = { identity: 'user-1', name: 'User 1' }
      mockRoomClient.listParticipants.mockResolvedValue([mockParticipant])

      const participant = await component.getParticipant('my-room', 'user-1')

      expect(participant).toEqual(mockParticipant)
    })
  })

  describe('and the participant does not exist', () => {
    it('should return null', async () => {
      mockRoomClient.listParticipants.mockResolvedValue([])

      const participant = await component.getParticipant('my-room', 'non-existent')

      expect(participant).toBeNull()
    })
  })

  describe('and an error occurs', () => {
    it('should return null', async () => {
      mockRoomClient.listParticipants.mockRejectedValue(new Error('Room not found'))

      const participant = await component.getParticipant('my-room', 'user-1')

      expect(participant).toBeNull()
    })
  })
})

describe('when removing a participant', () => {
  it('should remove the participant from the room', async () => {
    mockRoomClient.removeParticipant.mockResolvedValue(undefined)

    await component.removeParticipant('my-room', 'user-1')

    expect(mockRoomClient.removeParticipant).toHaveBeenCalledWith('my-room', 'user-1')
  })
})

describe('when updating a participant', () => {
  describe('and updating metadata only', () => {
    it('should update the participant metadata', async () => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{}' }])
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)

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
    it('should update the participant permissions', async () => {
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)

      await component.updateParticipant('my-room', 'user-1', {
        permissions: { canPublish: false }
      })

      expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith('my-room', 'user-1', undefined, {
        canPublish: false
      })
    })
  })

  describe('and the participant has existing metadata', () => {
    it('should merge with the existing metadata', async () => {
      mockRoomClient.listParticipants.mockResolvedValue([{ identity: 'user-1', metadata: '{"existing":"data"}' }])
      mockRoomClient.updateParticipant.mockResolvedValue(undefined)

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
})

describe('when muting a participant', () => {
  it('should mute the participant by removing publish sources', async () => {
    mockRoomClient.updateParticipant.mockResolvedValue(undefined)

    await component.muteParticipant('my-room', 'user-1')

    expect(mockRoomClient.updateParticipant).toHaveBeenCalledWith('my-room', 'user-1', undefined, {
      canPublishSources: []
    })
  })
})

describe('when listing ingresses', () => {
  describe('and no room filter is provided', () => {
    it('should list all ingresses', async () => {
      const mockIngresses = [{ ingressId: 'ing-1' }, { ingressId: 'ing-2' }]
      mockIngressClient.listIngress.mockResolvedValue(mockIngresses)

      const ingresses = await component.listIngresses()

      expect(ingresses).toEqual(mockIngresses)
      expect(mockIngressClient.listIngress).toHaveBeenCalledWith({ roomName: undefined })
    })
  })

  describe('and a room filter is provided', () => {
    it('should list ingresses filtered by the provided room', async () => {
      const mockIngresses = [{ ingressId: 'ing-1' }]
      mockIngressClient.listIngress.mockResolvedValue(mockIngresses)

      const ingresses = await component.listIngresses('my-room')

      expect(ingresses).toEqual(mockIngresses)
      expect(mockIngressClient.listIngress).toHaveBeenCalledWith({ roomName: 'my-room' })
    })
  })

  describe('and an error occurs', () => {
    it('should return an empty array', async () => {
      mockIngressClient.listIngress.mockRejectedValue(new Error('Connection failed'))

      const ingresses = await component.listIngresses()

      expect(ingresses).toEqual([])
    })
  })
})

describe('when creating an ingress', () => {
  it('should create an ingress with the provided options', async () => {
    const mockIngress = { ingressId: 'ing-1', url: 'rtmp://...' }
    mockIngressClient.createIngress.mockResolvedValue(mockIngress)

    const ingress = await component.createIngress({
      inputType: IngressInput.RTMP_INPUT,
      name: 'my-stream',
      roomName: 'my-room',
      participantIdentity: 'streamer-1'
    })

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
    it('should delete the ingress successfully', async () => {
      mockIngressClient.deleteIngress.mockResolvedValue(undefined)

      await component.deleteIngress('ing-1')

      expect(mockIngressClient.deleteIngress).toHaveBeenCalledWith('ing-1')
    })
  })

  describe('and an error occurs', () => {
    it('should throw LivekitIngressNotFoundError', async () => {
      mockIngressClient.deleteIngress.mockRejectedValue(new Error('Not found'))

      await expect(component.deleteIngress('non-existent')).rejects.toThrow(LivekitIngressNotFoundError)
    })
  })
})

describe('when getting or creating an ingress', () => {
  describe('and the ingress already exists', () => {
    it('should return the existing ingress without creating a new one', async () => {
      const mockIngress = { ingressId: 'ing-1' }
      mockIngressClient.listIngress.mockResolvedValue([mockIngress])

      const ingress = await component.getOrCreateIngress('my-room', 'streamer-1')

      expect(ingress).toEqual(mockIngress)
      expect(mockIngressClient.createIngress).not.toHaveBeenCalled()
    })
  })

  describe('and the ingress does not exist', () => {
    it('should create and return a new ingress', async () => {
      const mockIngress = { ingressId: 'ing-new' }
      mockIngressClient.listIngress.mockResolvedValue([])
      mockIngressClient.createIngress.mockResolvedValue(mockIngress)

      const ingress = await component.getOrCreateIngress('my-room', 'streamer-1')

      expect(ingress).toEqual(mockIngress)
      expect(mockIngressClient.createIngress).toHaveBeenCalled()
    })
  })
})

describe('when receiving a webhook event', () => {
  describe('and the webhook is valid', () => {
    it('should parse and return the webhook event', async () => {
      const mockEvent = { event: 'participant_joined', room: { name: 'my-room' } }
      mockWebhookReceiver.receive.mockResolvedValue(mockEvent)

      const event = await component.receiveWebhookEvent('body', 'auth-header')

      expect(event).toEqual(mockEvent)
      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith('body', 'auth-header')
    })
  })

  describe('and the webhook is invalid', () => {
    it('should throw LivekitWebhookVerificationError', async () => {
      mockWebhookReceiver.receive.mockRejectedValue(new Error('Invalid signature'))

      await expect(component.receiveWebhookEvent('body', 'invalid-auth')).rejects.toThrow(
        LivekitWebhookVerificationError
      )
    })
  })
})

describe('when creating error instances', () => {
  describe('and creating a LivekitIngressNotFoundError', () => {
    it('should create the error with the correct message and name', () => {
      const error = new LivekitIngressNotFoundError('ing-123')
      expect(error.message).toBe('LiveKit ingress not found: ing-123')
      expect(error.name).toBe('LivekitIngressNotFoundError')
    })
  })

  describe('and creating a LivekitWebhookVerificationError', () => {
    it('should create the error with the correct message and name', () => {
      const error = new LivekitWebhookVerificationError('Invalid signature')
      expect(error.message).toBe('LiveKit webhook verification failed: Invalid signature')
      expect(error.name).toBe('LivekitWebhookVerificationError')
    })
  })
})
