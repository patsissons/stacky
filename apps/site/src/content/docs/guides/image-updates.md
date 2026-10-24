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

The arrow next to **Update** is always available and has three more options:

- **Check for updates:** checks this stack's images now, without waiting for the schedule. A notification reports what it found, and the **Update** button picks up any new results.
- **Pull updates only:** downloads the newer images ahead of time (`docker pull <image>:<new tag>`, and `docker compose pull` for services with only a new digest). The compose file and the running containers are left alone, so nothing changes yet.
- **Re-pull current tags:** the plain pull of the current tags, for when you want the newest build of your current tags without applying the newer versions.

**Update all** on the containers page runs the same thing for every stack with an update, after one confirmation that lists each change. Its arrow menu has **Pull all updates**, which runs **Pull updates only** for every stack instead. Either way each stack runs as one operation. Ignored updates, external stacks and stacky itself are left out; update stacky from its own stack page.

## When checks run

Images are checked a minute after stacky starts if they've never been checked, then on a schedule. They're also checked whenever you click **Check for updates**, after you deploy or update a stack, and whenever one of their containers was recreated since the last check. When a new stacky release comes out, stacky re-checks its own image every 15 minutes until the update shows, since the image reaches the registry a little after the release. To check a single stack, use **Check for updates** in the arrow menu next to its **Update** button; external stacks and stacky's own stack page show a **Check for updates** button instead. To check a single image, use **Check for updates** in that container's menu (on the containers page or a service card), or the telescope button in the update dialog. Either way, a notification reports the result.

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

## Choosing which tags count

The shape rule handles most images. To narrow the candidates further, give a service a `stacky.tag.include` label, a `stacky.tag.exclude` label, or both. Each takes a JavaScript regular expression. A tag counts as a newer version only if it has the same shape as the one you run, matches the include pattern and doesn't match the exclude pattern. The filters narrow the shape rule rather than replace it, so a loose pattern still can't jump to another variant.

```yaml
services:
  nginx:
    image: nginx:1.26.3
    labels:
      # stay on 1.26.x
      stacky.tag.include: '^1\.26\.'
  postgres:
    image: postgres:17.6
    labels:
      # skip the next major version
      stacky.tag.exclude: '^18\.'
```

Compose treats `$` as the start of a variable, so a pattern that ends with `$` has to write it as `$$` (for example `'^\d+\.\d+$$'`).

Stacky also reads What's Up Docker's `wud.tag.include` and `wud.tag.exclude`, so services already labelled for WUD keep their filters. If both are set, the `stacky.*` label wins. When several containers run the same image, they have to agree: if they set different filters, the label is ignored and the update dialog says why, as it does for an invalid pattern. Changing a filter (and recreating the container) makes the image due for a check right away, so the result never reflects an old filter.

## Release links

A `stacky.link.template` label turns each version into a link to its release notes. The update dialog links both tags and shows a **Release notes** link next to the registry's tags page; update notifications and the API include the newer version's link too.

```yaml
services:
  nginx:
    image: nginx:1.26.3
    labels:
      stacky.link.template: https://github.com/nginx/nginx/releases/tag/release-$${major}.$${minor}.$${patch}
```

Write `$${major}` rather than `${major}` in a compose file; otherwise Compose replaces it with an environment variable before stacky sees it. The template uses What's Up Docker's variables, filled in from the tag (here `v2.8.3-ls364`):

| Variable                  | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| `${original}` or `${raw}` | The whole tag: `v2.8.3-ls364`                             |
| `${transformed}`          | The same as `${original}` (stacky doesn't transform tags) |
| `${major}`                | The first number: `2`                                     |
| `${minor}`                | The second number: `8` (`0` if there isn't one)           |
| `${patch}`                | The third number: `3` (`0` if there isn't one)            |
| `${prerelease}`           | Whatever follows the first `-` after the numbers: `ls364` |

Stacky also reads `wud.link.template`, and `stacky.link.template` wins if both are set. The template is only filled in, never run as code, and must give an `http(s)` URL. A tag without numbers, such as `latest`, gets no link from a template that uses `${major}`. An unknown variable, or containers of one image with different templates, give no links, and the update dialog says why.

## Rate limits

Stacky only sends `HEAD` requests for manifests, which Docker Hub doesn't count toward its pull limit. Tag lists are fetched only for version tags. If a registry still rate-limits stacky, the badge shows **check failed** with the reason instead of a misleading "up to date".

## Private registries

Mount a Docker `config.json` that contains `auths` entries (as written by `docker login`) into the container:

```yaml
volumes:
  - /root/.docker/config.json:/root/.docker/config.json:ro
```

Credential helpers (`credsStore`) aren't supported. Use `docker login` with a config file that stores the auth inline.

Or set the credentials with environment variables on the stacky container, using What's Up Docker's naming: `STACKY_REGISTRY_<PROVIDER>_<NAME>_<KEY>`, where `<NAME>` is any label you like (it can be left out). Stacky also reads WUD's own `WUD_REGISTRY_*` variables unchanged, so you can copy them over as they are.

```yaml
environment:
  # LinuxServer images (lscr.io): a GitHub username and a token with read:packages
  STACKY_REGISTRY_LSCR_PRIVATE_USERNAME: me
  STACKY_REGISTRY_LSCR_PRIVATE_TOKEN: ghp_...
```

| Provider                     | Registry                                      | Keys                                                                  |
| ---------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `HUB`                        | Docker Hub                                    | `LOGIN` (or `USERNAME`), and `PASSWORD` or `TOKEN`                    |
| `GHCR`                       | ghcr.io                                       | `USERNAME`, `TOKEN`                                                   |
| `LSCR`                       | lscr.io                                       | `USERNAME`, `TOKEN` (a GitHub token, since lscr.io is served by ghcr) |
| `QUAY`                       | quay.io                                       | `NAMESPACE` and `ACCOUNT` (a robot account), `TOKEN`                  |
| `GITLAB`                     | registry.gitlab.com, or `URL`                 | `TOKEN`, optionally `USERNAME`                                        |
| `CUSTOM`, `GITEA`, `FORGEJO` | the host in `URL` (e.g. `registry.home:5000`) | `URL`, `LOGIN` (or `USERNAME`), and `PASSWORD` or `TOKEN`             |

Any provider also takes `AUTH`, a ready-made base64 `user:password`, in place of the username and secret. Variables win over a mounted `config.json` for the same registry, and `STACKY_` variables win over `WUD_` ones. Cloud registries that use cloud credentials (ECR, GCR, ACR) aren't supported; stacky logs a warning (naming the variables, never their values) and checks those images anonymously.

## What's Up Docker

You don't need [What's Up Docker](https://getwud.app) (WUD) alongside stacky. Stacky checks for updates itself, and [notifications](/guides/notifications/) tell you about new ones on Pushover, ntfy, Gotify, Discord, Apprise or a webhook.

WUD is still useful for images stacky can't check itself, such as a private registry it has no credentials for. To use it as a fallback, add WUD's URL and a personal API token (WUD → My Profile) under **Settings → What's Up Docker**. Stacky asks WUD to re-check, then uses WUD's answer for any image its own check couldn't handle. Results that came from WUD are marked in the update dialog.

If you keep WUD, leave its `dockercompose` trigger off and apply updates from stacky. Stacky also picks up changes WUD makes to compose files on disk.
