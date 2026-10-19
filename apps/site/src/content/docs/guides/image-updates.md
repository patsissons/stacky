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
- **Ignore this update:** hides this specific version or digest. The next newer one shows up again.

Use **Updates available** in the status filter, or the **N updates** button, to list everything with an update.

## Applying updates to a whole stack

A stack's plain **Update** (and **Pull images only**) pulls the tags already in its compose file. That helps for moving tags like `latest`, but does nothing for a pinned version such as `nginx:1.27.3`. The arrow next to **Update** on a stack page shows how many updates the stack has, and offers two actions that use the newer versions found by the check:

- **Pull updates:** downloads the newer images ahead of time (`docker pull <image>:<new tag>`, and `docker compose pull` for services with only a new digest). The compose file and the running containers are left alone, so nothing changes yet.
- **Pull updates & deploy:** writes each newer tag into the service's `image:` line (comments and formatting stay), then pulls and recreates the services that have an update, and removes dangling images. It is recorded in the stack's history like a deploy.

A service is left out (and the operation output says why) when its update is ignored, when its image comes from a variable such as `${TAG}`, or when its `image:` line changed after the check ran.

**Update all** on the containers page runs **Pull updates & deploy** for every stack with an update, after a confirmation that lists each change. Its arrow menu has **Pull all updates**, which runs **Pull updates** for every stack instead. Either way each stack runs as one operation. Ignored updates, external stacks and stacky itself are left out; update stacky from its own stack page.

## When checks run

Checks run a minute after stacky starts, then every 6 hours (with some random jitter), whenever you click **Check for updates**, and after you deploy or update a stack. Set `STACKY_UPDATE_INTERVAL` (in hours) to change the schedule; `0` turns off scheduled checks.

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

If you already run [What's Up Docker](https://getwud.app) (WUD), add its URL and a personal API token (WUD → My Profile) under **Settings → What's Up Docker**. Stacky asks WUD to re-check, then uses WUD's answer for any image its own check couldn't handle, such as a private registry it has no credentials for. Results that came from WUD are marked in the update dialog.

If you use WUD only for notifications, leave its `dockercompose` trigger off and apply updates from stacky. Stacky also picks up changes WUD makes to compose files on disk.
