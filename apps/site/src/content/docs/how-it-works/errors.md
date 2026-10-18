---
title: Errors
description: How stacky turns docker compose failures into actionable messages.
sidebar:
  order: 2
---

When a `docker compose` command fails, stacky reads its output and matches it against known failures. Instead of only an exit code, you get a short explanation and a suggested fix. The full output is always one click away.

| Code                      | Example message                                   | Suggested fix                                                 |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `port_in_use`             | Port 8080 is already in use                       | Names the container that holds the port, if stacky manages it |
| `registry_rate_limited`   | The registry rate limit was reached               | Wait, or `docker login` on the host                           |
| `image_access_denied`     | Access to image "org/private" was denied          | Check the name, or log in to the registry                     |
| `image_not_found`         | Image "nginx:9.99" was not found                  | Check the image name and tag                                  |
| `env_missing_variable`    | Required variable DB_PASSWORD has no value        | Set it in `.env` or `global.env`                              |
| `env_interpolation`       | Invalid variable substitution in services.web...  | Use `${VAR}` or escape `$` as `$$`                            |
| `env_file_missing`        | Env file ./app.env does not exist                 | Create it or remove it from `env_file`                        |
| `compose_yaml`            | The compose file is not valid YAML (line 4)       | Fix the highlighted line                                      |
| `compose_invalid`         | additional properties 'imagee' not allowed        | Check the key against the Compose specification               |
| `network_not_found`       | External network proxy does not exist             | `docker network create proxy`                                 |
| `volume_not_found`        | External volume data does not exist               | `docker volume create data`                                   |
| `container_name_conflict` | A container named "postgres" already exists       | Rename or remove one of them                                  |
| `dependency_failed`       | Dependency app-db-1 is unhealthy                  | Check that service's logs                                     |
| `build_failed`            | Image build failed                                | Find the failing step in the output                           |
| `disk_full`               | The host is out of disk space                     | Free space, e.g. `docker system prune`                        |
| `docker_api_version`      | The Docker CLI and engine disagree on API version | Upgrade the engine                                            |
| `docker_unavailable`      | Stacky cannot reach the Docker engine             | Mount `/var/run/docker.sock`                                  |

Anything else is reported as `command_failed`, using the last line of the output as the message.

Validation (before saving or deploying) uses the same tools. YAML syntax errors and `docker compose config` errors are mapped back to the line in your file, and a deploy with an invalid file is rejected before anything is written to disk.
