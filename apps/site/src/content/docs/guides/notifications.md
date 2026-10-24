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

## Choosing what notifies

Each channel picks the events it receives. On top of that, stacky decides which stacks and containers send failures, image updates and unhealthy-container alerts. Self-update results only depend on the channel.

**Send by default** under **Settings → Notifications** has a switch for each of the three events. All of them are on until you turn them off. Labels override a default for a whole stack or a single container. Each label takes `true` or `false` (`on`/`off`, `yes`/`no` and `1`/`0` work too) and names the event by a short alias:

| Event                       | Alias       | Container label           | Stack label (on stacky's own service)   |
| --------------------------- | ----------- | ------------------------- | --------------------------------------- |
| A deploy or operation fails | `failures`  | —                         | `stacky.notify.stack.<stack>.failures`  |
| New image updates are found | `updates`   | `stacky.notify.updates`   | `stacky.notify.stack.<stack>.updates`   |
| A container stays unhealthy | `unhealthy` | `stacky.notify.unhealthy` | `stacky.notify.stack.<stack>.unhealthy` |
| Every event above           | —           | `stacky.notify`           | `stacky.notify.stack.<stack>`           |

Stacky picks the most specific setting for each event:

1. The container's label for that event, e.g. `stacky.notify.updates`.
2. The container's `stacky.notify` label.
3. The stack's label for that event on stacky, e.g. `stacky.notify.stack.media.updates`.
4. The stack's `stacky.notify.stack.<stack>` label on stacky.
5. The event's default under **Send by default**.

Operations act on a whole stack, so failures skip the container labels and only follow steps 3–5.

For example, to hear about every failure and unhealthy container but only a few image updates, turn off **New image updates are found** under **Send by default**, then opt in the containers you care about:

```yaml
# the media stack
services:
  plex:
    image: plexinc/pms-docker
    labels:
      stacky.notify.updates: true # updates for Plex only
```

To quiet a whole stack except for one event, label stacky's own service:

```yaml
# stacky's own compose file
services:
  stacky:
    image: ghcr.io/patsissons/stacky:latest
    labels:
      stacky.notify.stack.sandbox: false # nothing from the sandbox stack...
      stacky.notify.stack.sandbox.failures: true # ...except failed deploys
```

An image update is reported if any container running that image sends updates. Updates you weren't told about because notifications were off are reported once you turn them back on. Labels on stacky apply once stacky is redeployed, and the Settings card lists the stack overrides it found. An invalid value or an unknown event is ignored (with a warning in stacky's log), and the next setting down applies.

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
