# @dcl/livekit-component

A LiveKit component for managing real-time communication, rooms, participants, and streaming in the Decentraland ecosystem.

## Installation

```bash
npm install @dcl/livekit-component
# or
pnpm add @dcl/livekit-component
```

## Features

- **Credentials Management**: Generate JWT tokens for participant authentication
- **Room Management**: Create, list, delete, and update room metadata
- **Participant Management**: List, update, mute, and remove participants
- **Ingress Management**: Create and manage RTMP/WHIP ingresses for streaming
- **Webhook Handling**: Verify and parse LiveKit webhook events

## Usage

### Basic Setup

```typescript
import { createLivekitComponent } from '@dcl/livekit-component'

const livekit = await createLivekitComponent(
  { logs: logsComponent },
  {
    settings: {
      host: 'wss://livekit.example.com',
      apiKey: 'your-api-key',
      secret: 'your-api-secret'
    }
  }
)
```

### Generate Credentials

```typescript
const credentials = await livekit.generateCredentials({
  identity: 'user-123',
  roomName: 'my-room',
  permissions: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  },
  metadata: { displayName: 'John Doe' },
  ttlSeconds: 300
})

console.log(credentials.url)   // wss://livekit.example.com
console.log(credentials.token) // JWT token
```

### Room Management

```typescript
// Get or create a room
const room = await livekit.getOrCreateRoom({ name: 'my-room' })

// List all rooms
const rooms = await livekit.listRooms()

// Update room metadata
await livekit.updateRoomMetadata('my-room', { description: 'A test room' })

// Delete a room
await livekit.deleteRoom('my-room')
```

### Participant Management

```typescript
// List participants in a room
const participants = await livekit.listParticipants('my-room')

// Get a specific participant
const participant = await livekit.getParticipant('my-room', 'user-123')

// Update participant metadata
await livekit.updateParticipant('my-room', 'user-123', {
  metadata: { role: 'moderator' }
})

// Mute a participant
await livekit.muteParticipant('my-room', 'user-123')

// Remove a participant
await livekit.removeParticipant('my-room', 'user-123')
```

### Ingress (Streaming) Management

```typescript
import { IngressInput } from '@dcl/livekit-component'

// Create an RTMP ingress for streaming
const ingress = await livekit.createIngress({
  inputType: IngressInput.RTMP_INPUT,
  name: 'my-stream',
  roomName: 'my-room',
  participantIdentity: 'streamer-1'
})

// Get or create ingress (returns existing if one exists)
const ingress = await livekit.getOrCreateIngress('my-room', 'streamer-1')

// List ingresses for a room
const ingresses = await livekit.listIngresses('my-room')

// Delete an ingress
await livekit.deleteIngress(ingress.ingressId)
```

### Webhook Handling

```typescript
// In your webhook handler
app.post('/webhooks/livekit', async (req, res) => {
  try {
    const event = await livekit.receiveWebhookEvent(
      req.body,
      req.headers.authorization
    )

    switch (event.event) {
      case 'participant_joined':
        console.log(`${event.participant?.identity} joined ${event.room?.name}`)
        break
      case 'participant_left':
        console.log(`${event.participant?.identity} left ${event.room?.name}`)
        break
      // ... handle other events
    }

    res.status(200).send('OK')
  } catch (error) {
    if (error instanceof LivekitWebhookVerificationError) {
      res.status(401).send('Unauthorized')
    } else {
      res.status(500).send('Internal error')
    }
  }
})
```

## API Reference

### `createLivekitComponent(components, options)`

Creates a new LiveKit component instance.

#### Parameters

- `components.logs` - Logger component (from `@well-known-components/interfaces`)
- `options.settings` - LiveKit server settings
  - `host` - LiveKit server URL (e.g., `wss://livekit.example.com`)
  - `apiKey` - API key for authentication
  - `secret` - API secret for signing tokens

### Interface: `ILivekitComponent`

See the TypeScript definitions in `src/types.ts` for the complete interface documentation.

## Error Handling

The component exports several error classes:

- `LivekitRoomNotFoundError` - Thrown when a room is not found
- `LivekitParticipantNotFoundError` - Thrown when a participant is not found
- `LivekitIngressNotFoundError` - Thrown when an ingress is not found
- `LivekitWebhookVerificationError` - Thrown when webhook verification fails

## License

Apache-2.0

