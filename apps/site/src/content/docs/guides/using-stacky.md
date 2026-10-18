---
title: Using stacky
description: The containers view, stack pages, the editor, logs and shells.
sidebar:
  order: 1
---

## Containers

The home page lists every container from every compose project on the host, much like [What's Up Docker](https://github.com/getwud/wud):

- **Status:** running, healthy, unhealthy, completed (one-shot jobs that finished), exited or error
- **Container, stack and registry:** stacks outside the stacks directory are marked **external**
- **Image and version:** the tag the container runs
- **Ports:** published ports as links that open the service
- **Actions:** logs, a shell, restart, stop or start

Search, the stack and status filters, sorting, **Group by stack** and pagination are all stored in the URL, so you can bookmark a view. On a phone the table turns into cards.

## Stack pages

Each stack page has an action bar:

- **Deploy:** `docker compose up -d`. The arrow menu adds options: pull images first, rebuild Dockerfile-based services (`--build`), or recreate every container.
- **Update:** pulls new images. If the stack is running, it then recreates changed containers and removes dangling images.
- **Restart**, **Stop** / **Start**
- **More:** pull only, **Down** (remove containers, optionally named volumes), and **Delete** (removes the stack directory; you type the name to confirm)

Every action streams its output in a drawer at the bottom of the screen. When it finishes, a notification tells you whether it worked. If it failed, you get a plain explanation and a suggested fix (see [Errors](/how-it-works/errors/)).

The tabs:

| Tab      | What it does                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Overview | Service cards with state, image, ports, live CPU and memory, and per-service actions                  |
| Editor   | Edit `compose.yaml`, `.env` and any other file in the stack directory                                 |
| Logs     | Live logs for the whole stack or one service, with search, history depth, timestamps and download     |
| Shell    | An interactive shell in any running container (bash if available, otherwise sh)                       |
| History  | Every deployed version of the files (compare or restore one) and every operation with its full output |

## Rolling back

Each successful deploy or update saves the compose file and `.env` it used, keeping the last 50 per stack. The **History** tab lists them. **Compare** shows a diff against the files on disk now. **Restore** validates the old files, writes them back and deploys them.

## The editor

- **Schema-aware:** completion and hover documentation come from the official Compose specification.
- **Validated as you type:** your unsaved text goes through `docker compose config` (with your `.env` and `global.env`), and problems are highlighted on the right line.
- **Diff before deploy:** with unsaved changes, **Review & deploy** shows a side-by-side diff of what will change. Invalid files are never saved by a deploy.
- **Your text is kept exactly:** comments, anchors, `!reset` and your formatting are never rewritten.
- **Secrets are masked:** values in `.env` whose names look secret (`PASSWORD`, `TOKEN`, `KEY`, ...) are hidden until you click **Reveal**.
- **Shortcuts:** <kbd>⌘/Ctrl</kbd>+<kbd>S</kbd> saves; <kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> deploys from inside the editor.

## Creating stacks

**New stack** starts from a template, or converts a `docker run` command into a compose file. **Create & deploy** validates the file, creates the directory and starts it in one step.

## Command palette

Press <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> anywhere to jump to a stack, or to update, restart, start or stop one.
