---
title: Labels
description: Every compose label and extension field stacky reads.
---

Stacky reads a few labels from your compose files. Set them under a service's `labels:` and deploy the stack so the container is recreated with them. Labels on stacky's own service apply once stacky is redeployed. The **Labels & environment** tab of the in-app help (the **?** button, or **Help: labels and environment variables** in the command palette) lists them too, next to every [environment variable](/reference/configuration/).

## On a service

| Label                                              | Also reads                            | What it does                                                                                                      | Details                                                                       |
| -------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `stacky.display.icon`                              | `dev.stacky.icon`, `wud.display.icon` | The container's icon: a selfh.st name, another icon set (`hl:`, `si:`, `mdi:`, `fa:`…), `stacky`, or an image URL | [Icons](/guides/using-stacky/#containers)                                     |
| `stacky.update.schedule`                           | —                                     | How often the image is checked for updates (`weekly`, `6h`, a cron pattern, `never`…)                             | [Per-container schedules](/guides/image-updates/#per-container-schedules)     |
| `stacky.tag.include`                               | `wud.tag.include`                     | A regex a newer tag must match to count as an update                                                              | [Choosing which tags count](/guides/image-updates/#choosing-which-tags-count) |
| `stacky.tag.exclude`                               | `wud.tag.exclude`                     | A regex that rules tags out                                                                                       | [Choosing which tags count](/guides/image-updates/#choosing-which-tags-count) |
| `stacky.link.template`                             | `wud.link.template`                   | A release-notes URL template, filled in from each version                                                         | [Release links](/guides/image-updates/#release-links)                         |
| `stacky.notify`                                    | —                                     | Turns all of the container's notifications on or off                                                              | [Choosing what notifies](/guides/notifications/#choosing-what-notifies)       |
| `stacky.notify.updates`, `stacky.notify.unhealthy` | —                                     | Turns one event on or off for the container                                                                       | [Choosing what notifies](/guides/notifications/#choosing-what-notifies)       |

When a `stacky.*` label and one of the names it also reads are both set, the `stacky.*` label wins.

## On stacky's own service

| Label                                 | What it does                                                                   | Details                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `stacky.notify.stack.<stack>`         | Turns every notification from one stack on or off                              | [Choosing what notifies](/guides/notifications/#choosing-what-notifies) |
| `stacky.notify.stack.<stack>.<event>` | Turns one event (`failures`, `updates` or `unhealthy`) on or off for one stack | [Choosing what notifies](/guides/notifications/#choosing-what-notifies) |

## In the compose file

A top-level `x-stacky` extension field lists links for the stack, shown on its page and in the stack list. Dockge's `x-dockge.urls` works too.

```yaml
x-stacky:
  urls:
    - https://jellyfin.example.com
services:
  jellyfin:
    image: jellyfin/jellyfin
```
