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
| Pushover    | — (always `api.pushover.net`)                         | The application token |
| Discord     | A channel webhook URL                                 | —                     |
| Apprise API | The notify endpoint of an Apprise API container       | Optional bearer token |
| Webhook     | Any URL; receives a JSON body                         | Optional bearer token |

### Pushover

1. Sign in at [pushover.net](https://pushover.net) and copy **Your User Key** (or a group key, to notify several people).
2. Under **Your Applications**, choose **Create an Application/API Token**, name it `stacky`, and copy its API token.
3. In stacky, add a **Pushover** channel and paste the API token and the user key.

Failures are sent with high priority, so they come through during quiet hours; everything else uses normal priority.

## Links back to stacky

When [`STACKY_BASE_URL`](/reference/configuration/) is set, each message links to the stack it's about (or to the containers page for image updates and self-updates). The link shows up as **Open in stacky** in Pushover, opens when you tap an ntfy or Gotify notification, and is the title link of a Discord embed.

## Webhooks

Generic webhooks receive:

```json
{
  "event": "operation_failed",
  "title": "deploy media failed",
  "body": "Port 8096 is already in use\n\nContainer \"jellyfin\" (stack \"old-media\") already publishes port 8096 ...",
  "level": "error",
  "stack": "media",
  "url": "https://stacky.example.com/stacks/media",
  "source": "stacky",
  "timestamp": "2026-10-18T21:30:00.000Z"
}
```

`url` is only included when `STACKY_BASE_URL` is set.

Use **Send test** to check a channel before saving it. If the service rejects the message, the error it gave (such as an invalid Pushover user key) is shown. Tokens are stored in stacky's database and are never sent back to the browser.
