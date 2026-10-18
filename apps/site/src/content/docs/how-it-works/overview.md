---
title: Overview
description: How stacky discovers stacks, computes status and runs operations.
sidebar:
  order: 1
---

## Compose files are the source of truth

Stacky never keeps a private copy of your stacks. A stack is a directory in the stacks directory that contains a compose file. When you edit a stack in the UI, stacky writes your **exact text** back to disk. It never re-serializes the YAML from a parsed model, so comments, anchors, custom tags like `!reset`, and your formatting survive untouched.

Edits made outside stacky (in vim, through git, or by another tool) are picked up automatically by a file watcher.

## Status from the Docker engine

Stacky reads container state directly from the Docker engine and listens to its event stream, grouping containers by the labels compose puts on them. Each service gets a precise status:

| Status      | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| running     | Container is up (and healthy, if it has a healthcheck)               |
| unhealthy   | Container is up but its healthcheck is failing                       |
| completed   | A one-shot container (restart `no`/`on-failure`) exited successfully |
| exited      | Container stopped with an error, or was stopped                      |
| not created | Service is defined in the compose file but has no container          |

A one-shot init container that finished successfully does **not** make its stack look broken.

## Operations

Deploy, update, stop, restart and the other actions run the real `docker compose` CLI, one operation per stack at a time. Output streams live to the browser, and every operation is recorded in a history. If an operation fails, stacky classifies the error (port already in use, image not found, invalid variable, and so on) and tells you how to fix it.
