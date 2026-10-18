---
title: Install
description: Run stacky on a Docker host with a single compose file.
sidebar:
  order: 1
---

## Quick install

On any Linux host with Docker:

```sh
curl -fsSL https://stacky.lgtm.page/install.sh | sh
```

The script:

1. checks that Docker and the compose plugin are available
2. writes `/opt/stacks/stacky/compose.yaml`
3. starts stacky and prints the URL to open

Running it again updates stacky. It never overwrites your compose file. [Read the script](https://stacky.lgtm.page/install.sh) before running it if you like.

Options can be set as environment variables or flags:

```sh
curl -fsSL https://stacky.lgtm.page/install.sh | sh -s -- --port 8080 --stacks-dir /srv/stacks
```

| Variable / flag                              | Default                            |
| -------------------------------------------- | ---------------------------------- |
| `STACKY_STACKS_DIR` / `--stacks-dir`         | `/opt/stacks`                      |
| `STACKY_PORT` / `--port`                     | `5005`                             |
| `STACKY_IMAGE` / `--image`                   | `ghcr.io/patsissons/stacky:latest` |
| `STACKY_ADMIN_USER`, `STACKY_ADMIN_PASSWORD` | create the admin up front          |

If your user can't use Docker or write to the stacks directory, the script uses `sudo` for those steps. You can also pipe it to `sudo sh`.

## Manual install

Stacky runs as a single container next to your other stacks. It needs:

- access to the Docker socket, so it can run `docker compose` and watch containers
- your stacks directory, mounted at **the same path** it has on the host
- a small data directory for its database and state

## 1. Create stacky's own stack

Stacky manages itself as a regular stack, so put its compose file in your stacks directory:

```yaml title="/opt/stacks/stacky/compose.yaml"
services:
  stacky:
    image: ghcr.io/patsissons/stacky:latest # also published as docker.io/patsissons/stacky
    restart: unless-stopped
    ports:
      - 5005:5005
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      - /opt/stacks:/opt/stacks
    environment:
      STACKY_STACKS_DIR: /opt/stacks
```

## 2. Start it once by hand

```sh
cd /opt/stacks/stacky
docker compose up -d
```

This is the only time you run `docker compose` for stacky yourself. From now on stacky can update itself from the UI.

## 3. Create the admin account

Open `http://<your-host>:5005`. The first visit asks you to create the admin account. To skip that step, set `STACKY_ADMIN_USER` and `STACKY_ADMIN_PASSWORD` in the compose file instead.

## Why the stacks path must match

`docker compose` resolves relative paths like `./data:/data` on the **client** side, which is inside the stacky container. It then sends the resulting absolute path to the Docker daemon, which interprets it on the **host**. If `/opt/stacks` on the host were mounted at `/stacks` inside the container, a stack's `./data` would resolve to `/stacks/app/data`, and the daemon would create that directory on the host instead of using `/opt/stacks/app/data`.

Mounting the directory at the identical path (`/opt/stacks:/opt/stacks`) makes both sides agree. Stacky checks this at startup and shows a clear warning if the paths don't match.

## Image tags

| Tag      | Meaning                                      |
| -------- | -------------------------------------------- |
| `latest` | Most recent release                          |
| `X.Y.Z`  | A specific release                           |
| `X.Y`    | Latest patch of a minor release              |
| `edge`   | Built from every commit to `main` (unstable) |
