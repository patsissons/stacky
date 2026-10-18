---
title: Updating stacky itself
description: How stacky updates, redeploys and restarts its own container, and how it rolls back.
sidebar:
  order: 2
---

Stacky can manage the stack it runs in. Open that stack (marked **SELF** in the sidebar), or use the update banner that appears when a new release is out:

| Action       | What happens                                                                         |
| ------------ | ------------------------------------------------------------------------------------ |
| **Update**   | Pulls the newest image for your tag and replaces stacky with it                      |
| **Redeploy** | Applies your edits to stacky's compose file, e.g. a new environment variable or port |
| **Restart**  | Recreates stacky's container with the same configuration                             |

**Stop**, **Down** and **Delete** aren't offered for stacky's own stack, because they would leave you without the UI. Do those on the host with `docker compose`.

## How it works

A process can't replace the container it's running in: the moment `docker compose` stops the old container, the command doing the work is killed with it. That's why Dockge's update button leaves it stopped. Stacky hands the swap to a separate, short-lived container instead:

1. **Pull, while stacky keeps running.** The pull streams in the UI like any other operation. If the image hasn't changed, stacky stops here and tells you it's already up to date.
2. **Record the job.** Stacky writes the job to its data directory. The job holds the current image, the target, and the compose files as they were the last time stacky started successfully.
3. **Start the updater.** Stacky starts a `stacky-updater-…` container from its _current_, known-good image. It mounts the Docker socket, the data directory and the stacks directory at the same paths as stacky itself.
4. **Replace stacky.** The updater runs `docker compose up --detach --no-deps --force-recreate --wait` for stacky's service only, in stacky's original compose project. `--wait` blocks until the new container passes its health check.
5. **Roll back on failure.** If the new version doesn't become healthy, the updater restores the compose files and points the image tag back at the old image. It then starts the previous version again and records **rolled back** with the error.
6. **Confirm.** The new instance reads the job when it starts, marks it **succeeded**, and removes finished updater containers. The page reloads into the new version on its own.

## Pinned tags and moving tags

- **Moving tag** (`latest`, `edge`, `1`): **Update** pulls the same tag again.
- **Pinned release** (`0.3.1`): **Update to 0.4.0** rewrites only the `image:` line in your compose file, then pulls. Your comments and formatting are kept.

## Requirements

Self-update is available when stacky was started with `docker compose`, with:

- the Docker socket mounted read-write
- the stacks directory mounted at the same path as on the host
- the compose file in the stacks directory, as in the [install guide](/getting-started/install/)

The **System** section in Settings tells you whether self-update is available, and why not if it isn't.

## Troubleshooting

- **Inspecting the updater:** it logs to `docker logs stacky-updater-<timestamp>` and is kept until the next successful start.
- **Job records:** stored in the data directory under `self-update/`.
- **Turning off release checks:** stacky looks up the latest release on GitHub every few hours. Set `STACKY_UPDATE_CHECK=false` to disable this.
