#!/usr/bin/env bash
# End-to-end test of stacky updating itself, against a real Docker engine:
#   1. pushes three builds of the image to a throwaway local registry
#      (old = 0.0.1, new = 0.0.2, broken = new image whose server exits)
#   2. runs stacky from a compose file, as users do, on the old image
#   3. updates to "new" through the API and checks the new version comes up
#   4. updates to "broken" and checks stacky rolls itself back to "new"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${STACKY_E2E_WORK:-${RUNNER_TEMP:-/tmp}/stacky-self-update-e2e}"
STACKS="$WORK/stacks"
REGISTRY_PORT="${REGISTRY_PORT:-5555}"
PORT="${STACKY_E2E_PORT:-5106}"
REG="localhost:$REGISTRY_PORT/stacky"
BASE="http://localhost:$PORT"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31mFAIL: %s\033[0m\n' "$*"
  docker logs stacky-stacky-1 2>&1 | tail -40 || true
  local op
  op="$(curl -fsS "$BASE/api/operations?limit=1" 2>/dev/null | json 'v[0]?.id' || true)"
  [ -n "$op" ] && curl -fsS "$BASE/api/operations/$op" 2>/dev/null | json 'JSON.stringify(v.error) + "\\n" + v.output' || true
  docker ps -a --filter label=dev.stacky.updater --format '{{.Names}}' | xargs -r -n1 docker logs 2>&1 | tail -40 || true
  exit 1
}

reset_stack() {
  (cd "$STACKS/stacky" 2>/dev/null && docker compose down --remove-orphans >/dev/null 2>&1) || true
  docker ps -aq --filter label=dev.stacky.updater | xargs -r docker rm -f >/dev/null 2>&1 || true
  # files written by the container are root-owned; remove them from a container
  # (only if the dir exists: a bind mount of a missing path would create it as root)
  if [ -d "$WORK" ]; then
    docker run --rm --entrypoint sh -v "$WORK:$WORK" "$REG:new" -c "rm -rf '$WORK'/*" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  reset_stack
  docker rm -f stacky-e2e-registry >/dev/null 2>&1 || true
}
trap cleanup EXIT

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log(String($1))})"; }

wait_for() { # wait_for <description> <timeout-seconds> <command...>
  local what="$1" timeout="$2"; shift 2
  for _ in $(seq 1 "$timeout"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "timed out waiting for $what"
}

healthy_version() { curl -fsS "$BASE/healthz" | json v.version | grep -qx "$1"; }
job_finished() { curl -fsS "$BASE/api/self" | json 'v.lastJob?.state' | grep -qE '^(succeeded|rolled_back|failed)$'; }

mkdir -p "$WORK"
log "local registry on :$REGISTRY_PORT"
docker rm -f stacky-e2e-registry >/dev/null 2>&1 || true
docker run -d --name stacky-e2e-registry --network host -e "REGISTRY_HTTP_ADDR=:$REGISTRY_PORT" \
  ghcr.io/distribution/distribution:3.0.0 >/dev/null

log "build and push old (0.0.1), new (0.0.2) and broken images"
docker build -q -f "$ROOT/docker/Dockerfile" --build-arg STACKY_VERSION=0.0.1 -t "$REG:old" "$ROOT" >/dev/null
docker build -q -f "$ROOT/docker/Dockerfile" --build-arg STACKY_VERSION=0.0.2 -t "$REG:new" "$ROOT" >/dev/null
printf 'FROM %s\nCMD ["node", "-e", "console.error(\\"broken build\\"); process.exit(1)"]\n' "$REG:new" |
  docker build -q -t "$REG:broken" - >/dev/null
for tag in old new broken; do docker push -q "$REG:$tag" >/dev/null; done

# The engine pulls from the registry itself. A Linux engine reaches localhost:$REGISTRY_PORT;
# desktop VMs (Docker Desktop, OrbStack) generally don't, so there we redeploy local images.
MODE="${SELF_E2E_MODE:-$([ "$(uname -s)" = Linux ] && echo registry || echo local)}"
log "mode: $MODE"

log "run stacky (old) from its own compose file in $STACKS/stacky"
reset_stack
mkdir -p "$STACKS/stacky"
cat > "$STACKS/stacky/compose.yaml" <<YAML
# stacky manages itself
services:
  stacky:
    image: $REG:old
    ports:
      - $PORT:5005
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      - $STACKS:$STACKS
    environment:
      STACKY_STACKS_DIR: $STACKS
      STACKY_AUTH_DISABLED: "true"
      STACKY_UPDATE_CHECK: "false"
YAML
(cd "$STACKS/stacky" && docker compose up -d --wait --quiet-pull)
wait_for "stacky 0.0.1" 60 healthy_version 0.0.1
curl -fsS "$BASE/api/self" | json 'v.available' | grep -qx true || fail "self-update not available"

# move stacky to a tag: through the update API (pull + pin) or by editing the file and redeploying
move_to() {
  if [ "$MODE" = registry ]; then
    curl -fsS -X POST -H 'content-type: application/json' -d "{\"targetVersion\":\"$1\"}" "$BASE/api/self/update" >/dev/null
  else
    sed -i.bak "s#image: $REG:.*#image: $REG:$1#" "$STACKS/stacky/compose.yaml" && rm -f "$STACKS/stacky/compose.yaml.bak"
    curl -fsS -X POST "$BASE/api/self/deploy" >/dev/null
  fi
}

log "update to the new version"
move_to new
wait_for "stacky 0.0.2" 180 healthy_version 0.0.2
wait_for "the update job to finish" 30 job_finished
state="$(curl -fsS "$BASE/api/self" | json v.lastJob.state)"
[ "$state" = succeeded ] || fail "expected the update job to succeed, got $state"
grep -q "image: $REG:new" "$STACKS/stacky/compose.yaml" || fail "compose file was not pinned to :new"
grep -q '# stacky manages itself' "$STACKS/stacky/compose.yaml" || fail "compose comments were lost"

log "update to a broken version and expect a rollback"
move_to broken
sleep 3
wait_for "stacky to come back" 240 healthy_version 0.0.2
wait_for "the rollback job to finish" 60 job_finished
state="$(curl -fsS "$BASE/api/self" | json v.lastJob.state)"
[ "$state" = rolled_back ] || fail "expected rolled_back, got $state"
grep -q "image: $REG:new" "$STACKS/stacky/compose.yaml" || fail "compose file was not restored"

log "self-update e2e passed"
