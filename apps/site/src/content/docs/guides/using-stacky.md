---
title: Using stacky
description: The containers view, stack pages, the editor, logs and shells.
sidebar:
  order: 1
---

## Containers

The home page lists every container from every compose project on the host, much like [What's Up Docker](https://github.com/getwud/wud):

- **Status:** running, healthy, unhealthy, starting, restarting, paused, completed (one-shot jobs that finished), exited, created or error
- **Container, stack and registry:** stacks outside the stacks directory are marked **external**
- **Image and version:** the tag the container runs
- **Ports:** published ports as links that open the service (on the host you opened stacky from, or `STACKY_DOCKER_HOST` when stacky sits behind a reverse proxy on another hostname)
- **Actions:** logs, a shell, restart, stop or start, and a check for updates of that one image

### Inspecting one container

Click a container (a table row, a card on a phone, or a service card on a stack page) to open its service's definition from the compose file in a panel at the bottom. That is the quickest way to check one container's settings without opening the whole file.

Turn on **Edit** to change it there. The edit is checked live against the whole compose file. **Save** writes it into the compose file, changing only that service's lines, so comments and formatting elsewhere stay as they were. **Review & deploy** shows the change first, then saves and deploys the stack, just like the editor. If the compose file changed on disk while you were editing, stacky stops and offers to load the new version instead. Containers of external stacks and of stacky itself are view-only here.

**Check for updates** looks for newer images now, and **Update all** applies every available update after you confirm. Its arrow menu has **Pull all updates**, which only downloads the newer images (see [Image updates](/guides/image-updates/)).

Icons come from the [selfh.st icon set](https://selfh.st/icons/), matched by image name. Stacky shows its own logo for its container without any label. Stacky downloads each icon once and serves it from its own cache, so your browser never calls a CDN.

To pick a different icon, add a `stacky.display.icon` label to the service. It takes the same values as What's Up Docker's `wud.display.icon`, which stacky also reads:

| Value                                     | Icon                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `jellyfin` or `sh:jellyfin`               | [selfh.st](https://selfh.st/icons/) (`selfhst:` works too)                     |
| `hl:jellyfin`                             | [homarr-labs dashboard icons](https://dashboardicons.com)                      |
| `si:jellyfin`                             | [Simple Icons](https://simpleicons.org)                                        |
| `mdi:docker`                              | [Material Design Icons](https://pictogrammers.com/library/mdi/)                |
| `fa:server`, `fas:`, `far:`, `fab:docker` | [Font Awesome](https://fontawesome.com/icons) solid, regular or brands         |
| `https://example.com/logo.svg`            | Any PNG, SVG, WebP, JPEG, GIF or ICO URL (fetched once by stacky, then cached) |

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin
    labels:
      stacky.display.icon: https://example.com/jellyfin.svg
```

When several labels are set, `stacky.display.icon` wins over the older `dev.stacky.icon`, which wins over `wud.display.icon`. Single-color sets (Material Design, Font Awesome, Simple Icons) are inverted in dark mode.

Containers are grouped under a heading per stack by default; turn **Group by stack** off for one flat, paginated list. Search, the stack and status filters, sorting, grouping and pagination are all stored in the URL, so you can bookmark a view. On a phone the table turns into cards, grouped the same way.

## Stack pages

Each stack page has an action bar:

- **Deploy:** `docker compose up -d`. The arrow menu adds options: pull images first, rebuild Dockerfile-based services (`--build`), or recreate every container. While the editor has unsaved changes, every one of these opens the review diff first, so you never deploy an older file by accident.
- **Update:** applies the newer versions found by the update check, after a confirmation that lists them; the number on the button is how many there are (see [Image updates](/guides/image-updates/#applying-updates-to-a-whole-stack)). The button is disabled while none are known. The arrow menu stays available and has **Pull updates only** (download the newer images, change nothing) and **Re-pull current tags**. Re-pull pulls the tags in the compose file again and, if the stack is running, recreates changed containers and removes dangling images, even when newer versions are waiting.
- **Restart**, **Stop** / **Start**
- **More:** pull only, **Down** (remove containers, optionally named volumes), and **Delete** (removes the stack directory; you type the name to confirm)

Not sure what an action does? The **?** button at the end of the action bar (also in the top bar, and **Help** in the command palette) opens a short explanation of every operation and the `docker compose` command behind it, with links back to these docs.

Every action streams its output in a drawer at the bottom of the screen. When it finishes, a notification tells you whether it worked. If it failed, you get a plain explanation and a suggested fix (see [Errors](/how-it-works/errors/)).

The tabs:

| Tab      | What it does                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Overview | Service cards with state, image, ports, live CPU and memory, and per-service actions (restart, stop, recreate, pull, check for updates) |
| Editor   | Edit `compose.yaml`, `.env` and any other file in the stack directory (create and delete files too)                                     |
| Logs     | Live logs for the whole stack or one service, with search, history depth, timestamps and download                                       |
| Shell    | An interactive shell in any running container (bash if available, otherwise sh)                                                         |
| History  | Every deployed version of the files (compare or restore one) and every operation with its full output                                   |

## Rolling back

Each successful deploy or update saves the compose file and `.env` it used, keeping the last 50 per stack. The **History** tab lists them. **Compare** shows a diff against the files on disk now. **Restore** validates the old files, writes them back and deploys them. **Clear history** removes the saved versions and the activity log of that stack after a confirmation. An operation that is still running is kept, and the files and containers are not touched.

## The editor

- **Schema-aware:** completion and hover documentation come from the official Compose specification.
- **Validated as you type:** your unsaved text goes through `docker compose config` (with your `.env` and `global.env`), and problems are highlighted on the right line.
- **Diff before deploy:** with unsaved changes, **Review & deploy** shows a side-by-side diff of what will change. Invalid files are never saved by a deploy.
- **Your text is kept exactly:** comments, anchors, `!reset` and your formatting are never rewritten.
- **Secrets are masked:** values in `.env` whose names look secret (`PASSWORD`, `TOKEN`, `KEY`, ...) are hidden until you click **Reveal**.
- **Shortcuts:** <kbd>⌘/Ctrl</kbd>+<kbd>S</kbd> saves; <kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> deploys from inside the editor.

## File browser

**Files** in the sidebar (or the command palette) is a read-only view of two directories. The **Stacks directory** tab shows `STACKY_STACKS_DIR`, with every stack's folder. The **Data directory** tab shows stacky's own data (`/app/data` in the container), such as the database and the icon cache.

Folders open as you expand them, and choosing a file shows it on the right:

- **Text files** open in a read-only editor with syntax highlighting. Secret-looking values in `.env` files are masked until you click **Reveal**.
- **Images** (PNG, JPEG, GIF, WebP, AVIF, SVG, ICO, BMP) are shown as pictures.
- **Other files** show their size, for example _Binary data (176 KB)_. Text files over 1 MB are not shown either.

Nothing can be changed from here; use a stack's **Editor** tab to edit its files. Git internals (`.git`) and the session signing secret (`auth-secret`) are never shown, and paths cannot leave the two directories, symlinks included.

## Creating stacks

**New stack** starts from a template, or converts a `docker run` command into a compose file. **Create & deploy** validates the file, creates the directory and starts it in one step.

## Command palette

Press <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> anywhere to jump to a stack, or to deploy, update, restart, start or stop one.

The stacky logo in the top left always takes you back to the containers page.
