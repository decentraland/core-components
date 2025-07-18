# Analytics Component (`@dcl/analytics-component`)

A component for sending analytics events to an external API.

## Features

- Send analytics events with environment context
- Error handling and logging
- Configurable API endpoint and authentication

## Usage

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
