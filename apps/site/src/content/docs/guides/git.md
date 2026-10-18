---
title: Git-backed stacks
description: Version your stacks directory in git, back it up to a remote, or deploy from git (GitOps).
sidebar:
  order: 6
---

Under **Settings → Git**, stacky can keep the stacks directory in a git repository. Three levels build on each other:

## 1. Local history

Turn on **Track stacks in git**. Stacky runs `git init` in the stacks directory (or uses the repository that is already there) and commits the compose files. From then on, every change made in stacky is a commit: saving, creating or deleting a stack, version bumps from the update dialog, and edits to other files.

- Only compose files and files you edit in stacky are committed. Data directories inside your stacks are never added.
- `.env` files and `global.env` usually contain secrets, so they are left out unless you turn on **Also commit .env files**.
- Stacky commits only the paths it changed, so anything you stage by hand is left alone.

## 2. Backup to a remote (push)

Add a remote and turn on **Push every commit**:

- **HTTPS:** add a personal access token with write access to the repository. The token is stored in stacky's database and sent as an HTTP header; it's never written into `.git/config`.
- **SSH:** use a `git@…` URL and mount a deploy key into the container:

  ```yaml
  volumes:
    - ./ssh:/root/.ssh:ro # id_ed25519 + known_hosts
  ```

## 3. Deploy from git (GitOps)

Turn on **Pull from the remote**. Stacky fetches the branch every few minutes, fast-forwards the stacks directory, and (with **Deploy stacks whose files changed**) redeploys every stack whose files changed. This includes stacky itself, through the [self-update](/guides/self-update/) flow.

To deploy as soon as you push, add the **webhook URL** shown in the settings as a push webhook in GitHub, Gitea, Forgejo or GitLab. The secret part of the URL is the credential; you can regenerate it any time.

You can start with an empty stacks directory: the first pull checks out the repository.

### When local and remote disagree

Stacky only fast-forwards. If stacks were changed in stacky (and committed) but not pushed, or someone edited files on the host, the pull stops with an explanation instead of merging or overwriting anything. Push the local commits, or reset the stacks directory to the remote, then pull again.
