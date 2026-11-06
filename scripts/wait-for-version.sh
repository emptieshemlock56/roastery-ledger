#!/usr/bin/env bash
# Polls <url>/health until it reports the expected short commit SHA (max ~15 min).
set -euo pipefail
url="${1:?url}"; want="${2:?sha}"
for i in $(seq 1 90); do
  got=$(curl -fsS "$url/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
  if [ "$got" = "$want" ]; then echo "Live: $url is running $want"; exit 0; fi
  echo "[$i] waiting for $want (currently: ${got:-unreachable})"; sleep 10
done
echo "Timed out waiting for $url to run $want" >&2; exit 1
