# Core Components

A monorepo containing reusable core components and utilities for the DCL WKC ecosystem.

## 📦 Project Structure

This repository is organized as a monorepo using pnpm workspaces with the following structure:

```
core-components/
├── components/          # Reusable components
│   ├── analytics/      # Analytics component for event tracking
│   ├── job/           # Job scheduling and execution component
│   └── slack/         # Slack messaging component
└── shared/             # Shared utilities and types
    └── commons/       # Common utilities, types, and constants
```

## 🚀 Components

### Analytics Component (`@dcl/analytics-component`)

A component for sending analytics events to an external API.

**Features:**

- Send analytics events with environment context
- Error handling and logging
- Configurable API endpoint and authentication

**Usage:**

```typescript
import { createAnalyticsComponent } from '@dcl/analytics-component'

const analytics = await createAnalyticsComponent(
  { fetch, logs },
  'service-name',
  'prd',
  'https://api.analytics.com/events',
  'your-api-token'
)

await analytics.sendEvent({
  event: 'user_action',
  body: { userId: '123', action: 'click' }
})
```

### Job Component (`@dcl/job-component`)

A component for scheduling and executing recurring jobs with configurable timing and error handling.

**Features:**

- Recurring job execution with configurable intervals
- Startup delay support
- Error handling and completion callbacks
- Graceful shutdown capabilities

**Usage:**

```typescript
import { createJobComponent } from '@dcl/job-component'

const job = createJobComponent(
  { logs },
  async () => {
    // Your job logic here
    console.log('Executing job...')
  },
  5000, // Run every 5 seconds
  {
    repeat: true,
    startupDelay: 1000,
    onError: (error) => console.error('Job error:', error),
    onFinish: () => console.log('Job finished')
  }
)

await job.start()
// ... later
await job.stop()
```

### Slack Component (`@dcl/slack-component`)

A component for sending messages to Slack using bot tokens.

**Features:**

- Send messages to Slack using bot tokens
- Support for simple and complex messages (blocks, attachments)
- Error handling and logging
- Flexible channel and message options configuration
- Lifecycle methods for start/stop

**Usage:**

```typescript
import { createSlackComponent } from '@dcl/slack-component'

// Send to specific channel with custom username and icon (requires bot token)
const slackWithToken = createSlackComponent({ logs }, { token: 'xoxb-your-bot-token' })
await slackWithToken.sendMessage({
  channel: '#alerts',
  text: 'Important alert!',
  username: 'My Bot',
  icon_emoji: ':rocket:',
  icon_url: 'https://example.com/icon.png'
})

// Send complex message with blocks
await slack.sendMessage({
  text: 'Backup message',
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Important message*\nThis is a formatted message'
      }
    }
  ]
})
```

### Core Commons (`@dcl/core-commons`)

Shared utilities, types, constants, and mocks used across all components.

**Includes:**

- Common TypeScript types
- Utility functions
- Constants
- Mock implementations for testing

## 🛠️ Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Install dependencies
pnpm install
```

### Available Scripts

```bash
# Build all packages
pnpm build

# Run tests for all packages
pnpm test

# Start development mode (watch mode)
pnpm dev

# Clean build artifacts
pnpm clean

# Lint all packages
pnpm lint
```

### Package Management

This project uses [Changesets](https://github.com/changesets/changesets) for version management:

```bash
# Create a new changeset
pnpm changeset

# Version packages based on changesets
pnpm version-packages

# Build and publish packages
pnpm release
```

## 📚 Testing

Each component includes comprehensive test suites using Jest. Run tests with:

```bash
# Run all tests
pnpm test

# Run tests for a specific component
cd components/analytics && pnpm test
```

## 🔧 Configuration

### TypeScript

All packages use TypeScript with strict configuration. TypeScript configuration is inherited from the root `tsconfig.json` and can be extended in individual packages.

### Jest

Testing is configured with Jest and `ts-jest` for TypeScript support. The configuration is centralized in the root `jest.config.js`.

## 📦 Publishing

Packages are published to npm with the following scope:

- `@dcl/analytics-component`
- `@dcl/job-component`
- `@dcl/slack-component`

## 🔗 Related

- [Well-Known Components](https://github.com/well-known-components/interfaces) - Component interfaces used by this project
- [Changesets](https://github.com/changesets/changesets) - Version management tool
