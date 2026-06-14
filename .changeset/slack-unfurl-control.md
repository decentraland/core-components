---
"@dcl/slack-component": minor
---

add optional `unfurl_links` and `unfurl_media` fields to `SlackMessage`, forwarded to `chat.postMessage`. Lets callers disable Slack link/media preview unfurling (e.g. set both to `false`) without changing existing behavior — when omitted, Slack's defaults apply.
