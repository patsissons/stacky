---
title: Configuration
description: Environment variables that configure stacky.
---

| Variable                 | Default       | Description                                                                                       |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `STACKY_PORT`            | `5005`        | HTTP port to listen on                                                                            |
| `STACKY_HOSTNAME`        | all addresses | Address to bind to                                                                                |
| `STACKY_STACKS_DIR`      | `/opt/stacks` | Directory containing one sub-directory per stack. Must be mounted at the same path as on the host |
| `STACKY_DATA_DIR`        | `/app/data`   | Stacky's database and state                                                                       |
| `STACKY_AUTH_DISABLED`   | `false`       | Turn off built-in authentication. Only use this behind a reverse proxy that authenticates for you |
| `STACKY_TRUSTED_PROXIES` | (none)        | Comma-separated proxy addresses or CIDRs whose `X-Forwarded-*` headers are trusted                |
| `STACKY_ADMIN_USER`      | (none)        | Seed the admin username (set together with `STACKY_ADMIN_PASSWORD`)                               |
| `STACKY_ADMIN_PASSWORD`  | (none)        | Seed the admin password                                                                           |
| `STACKY_BASE_URL`        | (none)        | Public URL of stacky, used for links and OIDC callbacks                                           |
| `STACKY_CONTAINER_ID`    | autodetected  | Override detection of stacky's own container (used by self-update)                                |
| `STACKY_LOG_LEVEL`       | `info`        | `debug`, `info`, `warn` or `error`                                                                |
