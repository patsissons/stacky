---
title: Notifications
description: Get notified when deploys fail, updates appear or containers stay unhealthy.
sidebar:
  order: 4
---

Add channels under **Settings → Notifications**. Each channel picks the events it wants:

| Event                       | Sent when                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| A deploy or operation fails | Any operation fails; the message includes the explained error and the suggested fix         |
| New image updates are found | An update check finds updates you haven't been told about yet (once per new version)        |
| A container stays unhealthy | A container is unhealthy, crashing or restarting for more than a minute (once per incident) |
| stacky updates itself       | A self-update finishes, or is rolled back                                                   |

## Channel types

| Type        | URL                                                   | Token                 |
| ----------- | ----------------------------------------------------- | --------------------- |
| ntfy        | The full topic URL, e.g. `https://ntfy.sh/my-topic`   | Optional access token |
| Gotify      | Your Gotify server, e.g. `https://gotify.example.com` | The application token |
| Discord     | A channel webhook URL                                 | —                     |
| Apprise API | The notify endpoint of an Apprise API container       | Optional bearer token |
| Webhook     | Any URL; receives a JSON body                         | Optional bearer token |

Generic webhooks receive:

```json
{
  "event": "operation_failed",
  "title": "deploy media failed",
  "body": "Port 8096 is already in use\n\nContainer \"jellyfin\" (stack \"old-media\") already publishes port 8096 ...",
  "level": "error",
  "stack": "media",
  "source": "stacky",
  "timestamp": "2026-10-18T21:30:00.000Z"
}
```

Use **Send test** to check a channel before saving it. Tokens are stored in stacky's database and are never sent back to the browser.
