---
title: Image updates
description: How stacky finds newer images, and how What's Up Docker fits in.
sidebar:
  order: 3
---

Stacky checks the image of every running container for two kinds of update:

- **A new image for the same tag.** For example, `nginx:latest` or `postgres:17` was rebuilt. Stacky compares the registry's manifest digest with the digest of the image you're running.
- **A newer version tag.** For example, `traefik:v3.3.3` when `v3.7.15` exists. Only tags with the same _shape_ are compared, so `1.27-alpine` is only compared with other `#.#-alpine` tags and never jumps to a `-debian` variant.

## Reading the badges

The **Update** column on the Containers page (and each service card) shows a badge, colored like What's Up Docker's:

| Badge | Meaning                                                 |
| ----- | ------------------------------------------------------- |
| Red   | Major version (`1.x` → `2.0`)                           |
| Amber | Minor version (`3.3` → `3.7`)                           |
| Green | Patch (`3.24.1` → `3.24.2`)                             |
| Blue  | New build or release number (`v2.8.3-ls364` → `-ls367`) |
| Gray  | New image for the same tag ("new digest")               |

Click a badge to see the details:

- **Pull &lt;tag&gt;:** pulls the rebuilt image and recreates the service.
- **Update to &lt;version&gt;:** changes only the service's `image:` line in your compose file (comments and formatting stay), then pulls and recreates it. If the image comes from a variable such as `${TAG}`, stacky asks you to change the variable instead.
- **Ignore this update:** hides this specific version or digest. The next newer one shows up again. An ignored update stays visible as a dashed, greyed badge; open it and choose **Stop ignoring** to bring it back.

Use **Updates available** in the status filter, or the **N updates** button, to list everything with an update.

## Applying updates to a whole stack

The **Update** button on a stack page uses the results of the check. When the stack has updates, the button shows how many and opens a confirmation that lists each change; confirming does, for the services with an update:

1. writes each newer tag into the service's `image:` line (comments and formatting stay),
2. pulls and recreates those services, and
3. removes dangling images.

It is recorded in the stack's history like a deploy. A service is left out (and the operation output says why) when its update is ignored, when its image comes from a variable such as `${TAG}`, or when its `image:` line changed after the check ran.

When no update is known, the **Update** button is disabled. **Re-pull current tags** in its arrow menu still pulls the tags already in the compose file. That helps for moving tags like `latest`, but does nothing for a pinned version such as `nginx:1.27.3`, which is exactly what the check is for. A stopped stack stays stopped.

The arrow next to **Update** is always available and has two more options:

- **Pull updates only:** downloads the newer images ahead of time (`docker pull <image>:<new tag>`, and `docker compose pull` for services with only a new digest). The compose file and the running containers are left alone, so nothing changes yet.
- **Re-pull current tags:** the plain pull of the current tags, for when you want the newest build of your current tags without applying the newer versions.

**Update all** on the containers page runs the same thing for every stack with an update, after one confirmation that lists each change. Its arrow menu has **Pull all updates**, which runs **Pull updates only** for every stack instead. Either way each stack runs as one operation. Ignored updates, external stacks and stacky itself are left out; update stacky from its own stack page.

## When checks run

Images are checked a minute after stacky starts if they've never been checked, then on a schedule. They're also checked whenever you click **Check for updates**, and after you deploy or update a stack. To check a single image, use **Check for updates** in that container's menu (on the containers page or a service card), or the telescope button in the update dialog; a notification reports the result.

### The global schedule

Set how often images are checked under **Settings → Image update checks**. The default is every 6 hours; set `STACKY_UPDATE_SCHEDULE` to change the default (the older `STACKY_UPDATE_INTERVAL`, in hours, still works). The Settings card shows when the next check is due.

| Schedule                | Checks                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| `hourly`                | At the top of every hour                                              |
| `daily` or `nightly`    | Every day at 3 AM                                                     |
| `weekly`                | Every Sunday at 3 AM                                                  |
| `monthly`               | On the 1st of every month at 3 AM                                     |
| `30m`, `6h`, `2d`, `1w` | That long after the image was last checked (5 minutes at least)       |
| A cron pattern          | Whenever the pattern matches, e.g. `0 4 * * 1-5` for 4 AM on weekdays |
| `never` (or `off`, `0`) | Only when you ask, or after a deploy                                  |

Times use stacky's time zone; set `TZ` on the stacky container (e.g. `TZ: Europe/Berlin`) to change it. The presets and intervals start up to five minutes late, so many stacky instances don't all hit registries at the same moment; cron patterns run on time. If stacky was down when a check was due, the check runs right after it starts.

### Per-container schedules

Give a service a `stacky.update.schedule` label to check its image on its own schedule, using any value from the table above:

```yaml
services:
  postgres:
    image: postgres:17.6
    labels:
      stacky.update.schedule: weekly
  traefik:
    image: traefik:v3.5
    labels:
      stacky.update.schedule: '0 */2 * * *'
  my-app:
    image: ghcr.io/me/my-app:latest
    labels:
      stacky.update.schedule: never
```

Containers without the label use the global schedule. Updates are tracked per image, so when several containers run the same image with different schedules, the soonest one wins. An invalid label is ignored in favour of the global schedule, and the update dialog says why. Labels apply once the container has been recreated (deploy the stack).

## Rate limits

Stacky only sends `HEAD` requests for manifests, which Docker Hub doesn't count toward its pull limit. Tag lists are fetched only for version tags. If a registry still rate-limits stacky, the badge shows **check failed** with the reason instead of a misleading "up to date".

## Private registries

Mount a Docker `config.json` that contains `auths` entries (as written by `docker login`) into the container:

```yaml
volumes:
  - /root/.docker/config.json:/root/.docker/config.json:ro
```

Credential helpers (`credsStore`) aren't supported. Use `docker login` with a config file that stores the auth inline.

## What's Up Docker

You don't need [What's Up Docker](https://getwud.app) (WUD) alongside stacky. Stacky checks for updates itself, and [notifications](/guides/notifications/) tell you about new ones on Pushover, ntfy, Gotify, Discord, Apprise or a webhook.

WUD is still useful for images stacky can't check itself, such as a private registry it has no credentials for. To use it as a fallback, add WUD's URL and a personal API token (WUD → My Profile) under **Settings → What's Up Docker**. Stacky asks WUD to re-check, then uses WUD's answer for any image its own check couldn't handle. Results that came from WUD are marked in the update dialog.

If you keep WUD, leave its `dockercompose` trigger off and apply updates from stacky. Stacky also picks up changes WUD makes to compose files on disk.
