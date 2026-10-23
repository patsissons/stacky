---
title: Migrating from Dockge
description: Point stacky at your existing Dockge stacks directory.
sidebar:
  order: 2
---

Stacky reads Dockge's stack layout unchanged, so there is nothing to convert:

- one directory per stack in `/opt/stacks` (or wherever `DOCKGE_STACKS_DIR` pointed)
- a compose file named `compose.yaml`, `docker-compose.yaml`, `docker-compose.yml` or `compose.yml`
- an optional `.env` per stack, plus an optional `global.env` at the root of the stacks directory
- `x-dockge.urls` entries, which stacky shows as links

## Steps

1. [Install stacky](/getting-started/install/) using the **same** stacks directory Dockge uses. Both can run side by side because stacky uses port 5005 and Dockge uses 5001.
2. Open stacky. Every Dockge stack is listed with its live status. Dockge itself shows up too, either as a stack (if its compose file is in the stacks directory) or as an **external** project.
3. Deploy a non-critical stack from stacky to confirm everything works.
4. Stop Dockge from stacky and remove its stack when you're ready.

## The first deploy recreates every container

The first time stacky deploys a stack that Dockge started, compose recreates **all** of its containers, even if you changed only one service or nothing at all. Compose labels each container with a hash of its configuration and recreates any container whose hash doesn't match. Containers created by Dockge's (older) Docker Compose carry hashes that stacky's compose computes differently. The way stacky layers `global.env` and `.env` can also change interpolated values. This happens once per stack. After that, deploys only recreate the services you change.

When you edit a stack, **Review & deploy** previews the deploy and names the Docker Compose version that created the containers. Plan the first deploy of a busy stack for a quiet moment.

Compose projects outside the stacks directory (Dockge called them "not managed by Dockge") appear in stacky as **external** projects. Stacky shows their status, logs and shells, but doesn't edit or deploy them. To manage one from stacky:

1. Stop it where it lives: `docker compose down` in its directory.
2. Move its directory into the stacks directory, e.g. `mv ~/apps/media /opt/stacks/media`. Fix any absolute paths in the compose file.
3. Deploy it from stacky.
