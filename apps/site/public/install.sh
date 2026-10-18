#!/bin/sh
# stacky installer: https://stacky.lgtm.page
#
#   curl -fsSL https://stacky.lgtm.page/install.sh | sh
#
# Options (environment variables, or flags after `sh -s --`):
#   STACKY_STACKS_DIR  --stacks-dir   where your stacks live          (default: /opt/stacks)
#   STACKY_PORT        --port         port for the web UI             (default: 5005)
#   STACKY_IMAGE       --image        image to run                    (default: ghcr.io/patsissons/stacky:latest)
#   STACKY_ADMIN_USER / STACKY_ADMIN_PASSWORD   create the admin account up front
#
# Example: curl -fsSL https://stacky.lgtm.page/install.sh | sh -s -- --port 8080 --stacks-dir /srv/stacks
#
# Running it again updates stacky. It never overwrites an existing compose file.

# Everything lives in a function, so nothing runs unless the whole script downloaded.
main() {
  set -eu

  STACKS_DIR="${STACKY_STACKS_DIR:-/opt/stacks}"
  PORT="${STACKY_PORT:-5005}"
  IMAGE="${STACKY_IMAGE:-ghcr.io/patsissons/stacky:latest}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --stacks-dir) STACKS_DIR="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --image) IMAGE="$2"; shift 2 ;;
      -h | --help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
      *) fail "unknown option: $1" ;;
    esac
  done

  case "$STACKS_DIR" in
    /*) ;;
    *) fail "--stacks-dir must be an absolute path (got $STACKS_DIR)" ;;
  esac
  case "$PORT" in
    '' | *[!0-9]*) fail "--port must be a number (got $PORT)" ;;
  esac

  DIR="$STACKS_DIR/stacky"
  COMPOSE="$DIR/compose.yaml"

  say "Installing stacky"

  # ---- requirements ----
  command -v docker >/dev/null 2>&1 ||
    fail "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"

  SUDO=""
  if ! docker info >/dev/null 2>&1; then
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
      SUDO="sudo"
      note "using sudo for docker (your user is not in the docker group)"
    else
      fail "Cannot reach the Docker engine. Is Docker running, and can this user use it? (try: curl -fsSL https://stacky.lgtm.page/install.sh | sudo sh)"
    fi
  fi

  $SUDO docker compose version >/dev/null 2>&1 ||
    fail "The docker compose plugin is missing. Install it: https://docs.docker.com/compose/install/linux/"

  # ---- files ----
  # escalate only if the nearest existing parent of the stacks dir isn't writable
  probe="$STACKS_DIR"
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  if [ ! -w "$probe" ] && [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || fail "$probe is not writable; run the installer as root"
    SUDO_FS="sudo"
    note "using sudo to write to $probe"
  fi
  run_fs() { ${SUDO_FS:-} "$@"; }

  run_fs mkdir -p "$DIR"

  existing=$(find "$STACKS_DIR" -mindepth 2 -maxdepth 2 \( -name compose.yaml -o -name docker-compose.yaml -o -name docker-compose.yml -o -name compose.yml \) 2>/dev/null | grep -v "^$DIR/" | wc -l | tr -d ' ')
  if [ "${existing:-0}" -gt 0 ]; then
    note "found $existing existing stack(s) in $STACKS_DIR; stacky will show them as they are (Dockge layout is supported)"
  fi

  if [ -f "$COMPOSE" ]; then
    note "$COMPOSE already exists; keeping it and updating stacky"
  else
    port_in_use "$PORT" && fail "port $PORT is already in use; pick another with STACKY_PORT=8080 (or --port 8080)"
    say "Writing $COMPOSE"
    tmp=$(mktemp)
    {
      echo "# stacky manages itself from this file: https://stacky.lgtm.page/guides/self-update/"
      echo "services:"
      echo "  stacky:"
      echo "    image: $IMAGE"
      echo "    restart: unless-stopped"
      echo "    ports:"
      echo "      - $PORT:5005"
      echo "    volumes:"
      echo "      - /var/run/docker.sock:/var/run/docker.sock"
      echo "      - ./data:/app/data"
      echo "      # the stacks directory must have the same path inside and outside the container"
      echo "      - $STACKS_DIR:$STACKS_DIR"
      echo "    environment:"
      echo "      STACKY_STACKS_DIR: $STACKS_DIR"
      if [ -n "${STACKY_ADMIN_USER:-}" ] && [ -n "${STACKY_ADMIN_PASSWORD:-}" ]; then
        echo "      STACKY_ADMIN_USER: \${STACKY_ADMIN_USER}"
        echo "      STACKY_ADMIN_PASSWORD: \${STACKY_ADMIN_PASSWORD}"
      fi
    } >"$tmp"
    run_fs cp "$tmp" "$COMPOSE"
    run_fs chmod 644 "$COMPOSE"
    rm -f "$tmp"
    if [ -n "${STACKY_ADMIN_USER:-}" ] && [ -n "${STACKY_ADMIN_PASSWORD:-}" ]; then
      tmp=$(mktemp)
      printf 'STACKY_ADMIN_USER=%s\nSTACKY_ADMIN_PASSWORD=%s\n' "$STACKY_ADMIN_USER" "$STACKY_ADMIN_PASSWORD" >"$tmp"
      run_fs cp "$tmp" "$DIR/.env"
      run_fs chmod 600 "$DIR/.env"
      rm -f "$tmp"
    fi
  fi

  # ---- start ----
  # if the files needed root, docker compose (which reads them) does too
  if [ -n "${SUDO_FS:-}" ] && [ -z "$SUDO" ]; then SUDO="sudo"; fi

  say "Pulling the image"
  (cd "$DIR" && $SUDO docker compose pull --quiet) || note "pull failed; using the local image if there is one"

  say "Starting stacky"
  if ! (cd "$DIR" && $SUDO docker compose up -d --wait --wait-timeout 120 2>/dev/null); then
    (cd "$DIR" && $SUDO docker compose up -d) || fail "docker compose up failed; see the output above"
  fi

  host_port=$(sed -n 's/^ *- \([0-9][0-9]*\):5005.*/\1/p' "$COMPOSE" | head -n1)
  url="http://$(host_address):${host_port:-$PORT}"

  printf '\n\033[1;32m✔ stacky is running\033[0m\n\n'
  printf '  Open      %s\n' "$url"
  printf '  Stack     %s\n' "$COMPOSE"
  printf '  Docs      https://stacky.lgtm.page\n\n'
  if [ -z "${STACKY_ADMIN_USER:-}" ]; then
    printf '  The first visit asks you to create the admin account.\n'
  fi
  printf '  From now on, update stacky from its own UI (or run this installer again).\n\n'
}

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else
    return 1
  fi
}

host_address() {
  addr=""
  if command -v hostname >/dev/null 2>&1; then
    addr=$(hostname -I 2>/dev/null | awk '{print $1}') || addr=""
  fi
  if [ -z "$addr" ] && command -v ip >/dev/null 2>&1; then
    addr=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}' | head -n1)
  fi
  echo "${addr:-localhost}"
}

main "$@"
