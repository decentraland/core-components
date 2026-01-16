# Core Components

A monorepo containing reusable core components and utilities for the DCL WKC ecosystem.

## 📦 Project Structure

This repository is organized as a monorepo using pnpm workspaces with the following structure:

```
core-components/
├── components/          # Reusable components
│   ├── analytics/        # Analytics component for event tracking
│   ├── job/              # Job scheduling and execution component
│   ├── memory-cache/     # In-memory LRU cache component
│   ├── queue-consumer/   # Queue message consumer and handler component
│   ├── redis/            # Redis cache component
│   ├── s3/               # AWS S3 storage component
│   ├── schema-validator/ # JSON schema validation component
│   ├── slack/            # Slack messaging component
│   ├── sns/              # AWS SNS publisher component
│   ├── sqs/              # AWS SQS queue component
│   ├── traced-fetch/     # Traced fetch component with distributed tracing
│   ├── metrics/          # Prometheus metrics component handler
|   └── http-server/      # HTTP server component
└── shared/             # Shared utilities and types
    └── commons/          # Common utilities, types, and constants
```

## 🚀 Components

### Infrastructure

- **HTTP Server Component** (`@dcl/http-server`) - HTTP server with routing, middleware, CORS, and WebSocket support

### Observability

- **Metrics Component** (`@dcl/metrics`) - Prometheus metrics collection and instrumentation

### Communication & Messaging

- **Analytics Component** (`@dcl/analytics-component`) - Event tracking and analytics integration
- **Slack Component** (`@dcl/slack-component`) - Slack messaging and notifications
- **SNS Component** (`@dcl/sns-component`) - AWS SNS message publishing

### Queue & Cache

- **SQS Component** (`@dcl/sqs-component`) - AWS SQS queue management
- **Queue Consumer Component** (`@dcl/queue-consumer-component`) - Event-based message consumer with handler routing
- **Redis Component** (`@dcl/redis-component`) - Redis distributed caching
- **Memory Cache Component** (`@dcl/memory-cache-component`) - In-memory LRU caching

### Storage

- **S3 Component** (`@dcl/s3-component`) - AWS S3 object storage operations

### Utilities

- **Job Component** (`@dcl/job-component`) - Job scheduling and execution
- **Schema Validator Component** (`@dcl/schema-validator-component`) - JSON schema validation middleware
- **Traced Fetch Component** (`@dcl/traced-fetch-component`) - HTTP requests with distributed tracing
- **Core Commons** (`@dcl/core-commons`) - Shared utilities, types, and constants

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

This project uses [Changesets](https://github.com/changesets/changesets) for automated version management and publishing to npm. All packages are published under the `@dcl` scope:

- `@dcl/analytics-component`
- `@dcl/job-component`
- `@dcl/memory-cache-component`
- `@dcl/queue-consumer-component`
- `@dcl/redis-component`
- `@dcl/s3-component`
- `@dcl/schema-validator-component`
- `@dcl/slack-component`
- `@dcl/sns-component`
- `@dcl/sqs-component`
- `@dcl/memory-queue-component`
- `@dcl/traced-fetch-component`
- `@dcl/livekit-component`
- `@dcl/core-commons`
- `@dcl/metrics`
- `@dcl/http-server`

### Publishing Workflow

Every pull request that introduces changes to any package **must** include a changeset file that describes the changes and their semantic versioning impact.

#### Step 1: Create a Changeset

When making changes to any package, run the changeset command to create a changeset file:

```bash
pnpm changeset
```

This interactive command will:

- Ask you to select which packages have changed
- Prompt you to choose the version bump type (major, minor, or patch)
- Request a summary of the changes for the changelog

The command creates a new file in the `.changeset/` directory with your change description.

#### Step 2: Commit and Submit PR

Include the generated changeset file in your PR:

```bash
git add .changeset/
git commit -m "chore: Add changeset for [your changes]"
```

#### Step 3: Merge PR

After peer review and approval, merge your PR. The changeset CI will automatically:

- Detect the merged changeset
- Create a new "Version Packages" PR with:
  - Updated version numbers in `package.json` files
  - Generated changelogs for each affected package
  - Consumed changeset files (they'll be deleted)

#### Step 4: Release

Merge the "Version Packages" PR to trigger the automated publishing process:

- Packages are built and published to npm
- Git tags are created for the new versions
- GitHub releases are generated

## 🔗 Related

- [Well-Known Components](https://github.com/well-known-components/interfaces) - Component interfaces used by this project
- [Changesets](https://github.com/changesets/changesets) - Version management tool
