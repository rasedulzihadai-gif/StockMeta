#!/usr/bin/env bash
# Offline end-to-end test: production server + local mock DeepSeek endpoint.
# The mock verifies the wire format and exercises the validation layer; it does NOT
# do real vision — use the in-app "Acceptance test" with a real API key for that.
# Requires `npm run build` first.   Usage: bash scripts/run-e2e.sh
set -u
PORT="${PORT:-3100}"

# Never test a stale server: refuse to run if something already listens on the port.
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  echo "Port $PORT is already in use — stop that process first." >&2
  exit 2
fi

node scripts/mock-deepseek.mjs > /tmp/mock.log 2>&1 &
MOCK_PID=$!
./node_modules/.bin/next start -p "$PORT" > /tmp/next-test.log 2>&1 &
NEXT_PID=$!

cleanup() {
  kill "$NEXT_PID" "$MOCK_PID" 2>/dev/null
  sleep 1
  pkill -f "next start -p $PORT" 2>/dev/null
  pkill -f "scripts/mock-deepseek.mjs" 2>/dev/null
  true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
  sleep 0.5
done

BASE_URL="http://127.0.0.1:$PORT" node scripts/e2e.mjs
