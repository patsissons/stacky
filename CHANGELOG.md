# Changelog

## [0.12.0](https://github.com/patsissons/stacky/compare/v0.11.0...v0.12.0) (2026-10-24)


### Features

* choose which stacks and containers send notifications ([614d2cd](https://github.com/patsissons/stacky/commit/614d2cd29c1643864595ab280926bee271e63136))
* read registry credentials from environment variables ([d206bed](https://github.com/patsissons/stacky/commit/d206bed4cc571bf3cf09678ba5d7cd6671a9576e))


### Bug Fixes

* re-check stacky's own image after a release or a recreate ([ea23478](https://github.com/patsissons/stacky/commit/ea23478c854827c5b35e79bbbdf818c12bb752bc))

## [0.11.0](https://github.com/patsissons/stacky/compare/v0.10.1...v0.11.0) (2026-10-24)


### Features

* filter version tags and link release notes with container labels ([#27](https://github.com/patsissons/stacky/issues/27)) ([482d58a](https://github.com/patsissons/stacky/commit/482d58a9719cd361bb1ef8f7955eddc7f8740df8))

## [0.10.1](https://github.com/patsissons/stacky/compare/v0.10.0...v0.10.1) (2026-10-23)


### Bug Fixes

* don't let a running image check outlive shutdown ([#24](https://github.com/patsissons/stacky/issues/24)) ([8d174da](https://github.com/patsissons/stacky/commit/8d174da2a26e0acd93f8468c6e4e6da2cd024b6e))

## [0.10.0](https://github.com/patsissons/stacky/compare/v0.9.0...v0.10.0) (2026-10-23)


### Features

* preview what a deploy will change before it runs ([#22](https://github.com/patsissons/stacky/issues/22)) ([26737ef](https://github.com/patsissons/stacky/commit/26737ef00186021067ae7fbc1bcf837d403667f9))

## [0.9.0](https://github.com/patsissons/stacky/compare/v0.8.0...v0.9.0) (2026-10-21)


### Features

* Pushover notifications and links back to stacky ([#19](https://github.com/patsissons/stacky/issues/19)) ([0faac0d](https://github.com/patsissons/stacky/commit/0faac0dd481970481524d68b06df012c87789237))
* update check schedules, globally and per container ([#21](https://github.com/patsissons/stacky/issues/21)) ([97d03a2](https://github.com/patsissons/stacky/commit/97d03a252c958c7ec8c662ff4f8dad2b43eabdea))

## [0.8.0](https://github.com/patsissons/stacky/compare/v0.7.0...v0.8.0) (2026-10-19)


### Features

* STACKY_DOCKER_HOST for published-port links ([#17](https://github.com/patsissons/stacky/issues/17)) ([30e32bb](https://github.com/patsissons/stacky/commit/30e32bbe7b020a85ac418e5301c107553f5d7956))

## [0.7.0](https://github.com/patsissons/stacky/compare/v0.6.0...v0.7.0) (2026-10-19)


### Features

* AI integrations — MCP server, public REST API, llms.txt ([#15](https://github.com/patsissons/stacky/issues/15)) ([f279ada](https://github.com/patsissons/stacky/commit/f279ada52c77b8c5c0b1bf8294815571087528ca))

## [0.6.0](https://github.com/patsissons/stacky/compare/v0.5.0...v0.6.0) (2026-10-19)


### Features

* clear a stack's history ([16ee6c4](https://github.com/patsissons/stacky/commit/16ee6c4df483262d0d987b2768620dcfd989cbb0))
* read-only file browser for the stacks and data directories ([16ee6c4](https://github.com/patsissons/stacky/commit/16ee6c4df483262d0d987b2768620dcfd989cbb0))
* stacky.display.icon label with icon sets and URLs, built-in stacky icon ([16ee6c4](https://github.com/patsissons/stacky/commit/16ee6c4df483262d0d987b2768620dcfd989cbb0))
* **web:** group by stack by default, link the version to its release, disable Update with no updates ([16ee6c4](https://github.com/patsissons/stacky/commit/16ee6c4df483262d0d987b2768620dcfd989cbb0))
* **web:** inspect and edit a container's service in a bottom sheet ([16ee6c4](https://github.com/patsissons/stacky/commit/16ee6c4df483262d0d987b2768620dcfd989cbb0))

## [0.5.0](https://github.com/patsissons/stacky/compare/v0.4.1...v0.5.0) (2026-10-19)


### Features

* **web:** group phone cards by stack, steady stats row, per-image update check ([#9](https://github.com/patsissons/stacky/issues/9)) ([fba4bd0](https://github.com/patsissons/stacky/commit/fba4bd0b1a7d19ee709ab39ce88612625d179724))

## [0.4.1](https://github.com/patsissons/stacky/compare/v0.4.0...v0.4.1) (2026-10-19)


### Bug Fixes

* **web:** no word suggestions in .env editor, retry-safe e2e setup ([#8](https://github.com/patsissons/stacky/issues/8)) ([bf5d8dc](https://github.com/patsissons/stacky/commit/bf5d8dc3855683cb3232fc20fe07160261e19caa))

## [0.4.0](https://github.com/patsissons/stacky/compare/v0.3.0...v0.4.0) (2026-10-19)


### Features

* **web:** UX sweep — editor fixes, un-ignore updates, phone and tablet layouts ([#6](https://github.com/patsissons/stacky/issues/6)) ([09d07d1](https://github.com/patsissons/stacky/commit/09d07d143330d2267404c5082eb38d073bdde803))

## [0.3.0](https://github.com/patsissons/stacky/compare/v0.2.0...v0.3.0) (2026-10-19)


### Features

* add "Pull updates" and "Pull updates & deploy" stack operations ([#4](https://github.com/patsissons/stacky/issues/4)) ([93299f6](https://github.com/patsissons/stacky/commit/93299f61c2b697a26b5e882a59aa87229990dcfb))

## [0.2.0](https://github.com/patsissons/stacky/compare/v0.1.0...v0.2.0) (2026-10-19)


### Features

* **web:** add "Update all" to the containers page ([a679775](https://github.com/patsissons/stacky/commit/a679775c67b064bcaab5fb27b8ca5492b27bb981))
* **web:** add a help modal that explains every operation ([2eef80c](https://github.com/patsissons/stacky/commit/2eef80c7560d7af3799407855d91bb9d078b87b5))
* **web:** let the auth-disabled banner be dismissed ([32ec034](https://github.com/patsissons/stacky/commit/32ec0348e1be4e8a540acadfce86865c1c2213b4))


### Bug Fixes

* **web:** disable "Update stacky" when there is nothing newer ([2862e08](https://github.com/patsissons/stacky/commit/2862e0882a0c61fec66e99de0bc145525191458b))
* **web:** tidy layout glitches in the shell, tabs and buttons ([414bc84](https://github.com/patsissons/stacky/commit/414bc84497a1f963f07d5ba8296cb244082703f7))

## 0.1.0 (2026-10-18)


### Features

* one-line installer at stacky.lgtm.page/install.sh ([59cef2e](https://github.com/patsissons/stacky/commit/59cef2ee1521f483414f7c876cf8a059691960cf))
* **server:** add Dockge-compatible stack discovery and live state ([ae6d83f](https://github.com/patsissons/stacky/commit/ae6d83f2f85455407bc5035625c8e9350a5a0406))
* **server:** add Hono server skeleton with config and /healthz ([7f9e3a0](https://github.com/patsissons/stacky/commit/7f9e3a0b39662f14607091cf82ee1c9c15861896))
* **server:** add operation engine, compose planner, error classifier and database ([16d5c47](https://github.com/patsissons/stacky/commit/16d5c47fb2b2679869dcb15064d4f7781acf803a))
* **server:** add REST API, websocket hub, logs/stats/exec streaming and validation ([fbd0bf0](https://github.com/patsissons/stacky/commit/fbd0bf07c0acd91592a809d7fedc7605780a58b7))
* **server:** add single-admin auth with better-auth ([957dab2](https://github.com/patsissons/stacky/commit/957dab21d2f98986f3ce60b2928bc841b006a621))
* **server:** convert docker run commands to compose ([9ce3488](https://github.com/patsissons/stacky/commit/9ce3488cfa86eb22dcc5d317bb3c3e1e72255b35))
* **server:** detect image updates natively, with optional WUD ([118e8bd](https://github.com/patsissons/stacky/commit/118e8bd1a70067775e011f2d44535a6028ff7f74))
* **server:** detect stacky's own container and run startup preflight checks ([c8d5a71](https://github.com/patsissons/stacky/commit/c8d5a71ba0048874e27ff8bdc54d05d1deef5902))
* **server:** git-backed stacks with push backups and GitOps pulls ([3b1688f](https://github.com/patsissons/stacky/commit/3b1688f70f3e2e56b1626aa8befec67f875eceb0))
* **server:** keep deployed revisions of stack files and restore them ([15d33e9](https://github.com/patsissons/stacky/commit/15d33e90962a43228a509622a0c27542f8ad98ca))
* **server:** let stacky update, redeploy and restart itself ([0bb344d](https://github.com/patsissons/stacky/commit/0bb344d6205fd214669f7202b01fe246c94e07b1))
* **server:** notifications via ntfy, Gotify, Discord, Apprise and webhooks ([3c372f1](https://github.com/patsissons/stacky/commit/3c372f134ad279249decaf94f9eec5b878ddfc8a))
* **server:** serve app icons from a local cache of the selfh.st set ([dfa9a45](https://github.com/patsissons/stacky/commit/dfa9a45b9024cffc2d064c7164af4f78dea9e513))
* **server:** serve the built web UI with SPA fallback ([d53897b](https://github.com/patsissons/stacky/commit/d53897b32dbeff51db4f7a819eb8df802b474f60))
* **server:** TOTP two-factor, OIDC single sign-on, API tokens and an audit log ([e4cb02c](https://github.com/patsissons/stacky/commit/e4cb02c05ff328d6e3577e92840864c3913ad6e3))
* **shared:** add stack, operation and websocket types plus status rules ([36f0f13](https://github.com/patsissons/stacky/commit/36f0f13783082dd67be4645f143754fb5ef36c45))
* **web:** add the stacky UI ([f29b5a4](https://github.com/patsissons/stacky/commit/f29b5a4a44e5227e6a642df271a2acdc179b286d))
* **web:** add Vite + React + Tailwind + shadcn/ui skeleton with vitest setup ([8affd36](https://github.com/patsissons/stacky/commit/8affd364850a41ee8a20230b2ffb302e7072c3b5))
* **web:** compare and restore deployed versions in the History tab ([35a49a5](https://github.com/patsissons/stacky/commit/35a49a54c631594a5dedc37bc9ecdfbf9552d7bc))
* **web:** git settings ([449427a](https://github.com/patsissons/stacky/commit/449427a991bdec1b0176c93ff383705c3c691304))
* **web:** notification channel settings ([37215e8](https://github.com/patsissons/stacky/commit/37215e8c4f3f4207f83d3a1c887ed4b0fd0f03f9))
* **web:** self-update banner, actions and restart overlay ([ae66ec0](https://github.com/patsissons/stacky/commit/ae66ec0bda329754e99873667cda22720d549ab3))
* **web:** show app icons for containers and services ([8272c97](https://github.com/patsissons/stacky/commit/8272c97d14be39a6053bb9ad19df198b6668ccd9))
* **web:** two-factor setup, SSO sign-in, API tokens and activity log ([d4104bc](https://github.com/patsissons/stacky/commit/d4104bcbbb750c95efacbbce2b79bb261a6962c8))
* **web:** update badges, update dialog and WUD settings ([f99f59a](https://github.com/patsissons/stacky/commit/f99f59acd0027272ac6da4582a5716a831eac1c0))


### Bug Fixes

* **installer:** satisfy shellcheck ([5649bd0](https://github.com/patsissons/stacky/commit/5649bd05fac0be987cfbacaff518547e7e250f0f))
* **server:** never leave a stack marked busy after a fast operation ([bbdbbbe](https://github.com/patsissons/stacky/commit/bbdbbbe5a3846b49d40f414d390a02837f1a649c))
* **site:** give the "How it works" cards equal heights ([83053a9](https://github.com/patsissons/stacky/commit/83053a92da3edea508aca5d06f319461038afd73))
