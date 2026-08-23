#!/usr/bin/env bash
set -euo pipefail

image="lavega-investing:latest"
container="lavega-investing"
volume="lavega-investing-persistence-test"
port="${LAVEGA_INVESTING_PORT:-8790}"
previous_image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"

docker build --progress=plain -f Dockerfile.investing -t "$image" .
current_image_id="$(docker image inspect --format '{{.Id}}' "$image")"

docker rm -f "$container" >/dev/null 2>&1 || true
for legacy_container in lavega-investing-persistent lavega-investing-current lavega-investing-final lavega-investing-issue44-debug; do
  docker rm -f "$legacy_container" >/dev/null 2>&1 || true
done

for legacy_image in lavega-investing-persistent:latest lavega-investing-audit:latest lavega-investing-final:latest lavega-investing-issue44:latest lavega-investing:issue44; do
  docker image rm "$legacy_image" >/dev/null 2>&1 || true
done
if [[ -n "$previous_image_id" && "$previous_image_id" != "$current_image_id" ]]; then
  docker image rm "$previous_image_id" >/dev/null 2>&1 || true
fi

docker run -d \
  --name "$container" \
  -p "$port:8788" \
  -v "$volume:/data" \
  "$image"

echo "LaVega investing is running at http://127.0.0.1:$port"
