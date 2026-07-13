#!/usr/bin/env bash
# §8 outer-audit: key-exposure grep of the client bundle (I2).
# Builds the app, then greps the client JS chunks for anything that looks
# like a leaked server secret. Fails (exit 1) if a real key value or a
# server-only env var name appears in code shipped to the browser.
#
# Usage: bash scripts/audit/key-exposure.sh
set -euo pipefail

echo "▶ building (production) so client chunks exist"
pnpm build >/tmp/vaani-build.log 2>&1 || { echo "build failed — see /tmp/vaani-build.log"; exit 1; }

CLIENT_DIR=".next/static"
if [ ! -d "$CLIENT_DIR" ]; then
  echo "no client bundle at $CLIENT_DIR"; exit 1
fi

# Server-only env var NAMES that must never be referenced in client code.
SERVER_ONLY_VARS=(
  SUPABASE_SERVICE_ROLE_KEY DATABASE_URL SARVAM_API_KEY AZURE_SPEECH_KEY
  GOOGLE_SPEECH_API_KEY VAPI_PRIVATE_KEY VAPI_WEBHOOK_SECRET GUPSHUP_API_KEY
  MSG91_AUTH_KEY EXOTEL_API_TOKEN EXOTEL_API_KEY
)

fail=0
echo "▶ scanning $CLIENT_DIR for server-only env var references"
for var in "${SERVER_ONLY_VARS[@]}"; do
  if grep -rqF "$var" "$CLIENT_DIR" 2>/dev/null; then
    echo "  ❌ LEAK: $var referenced in client bundle"
    fail=1
  fi
done

# Heuristic value patterns (provider key prefixes / long secrets).
echo "▶ scanning for key-shaped literals"
if grep -rEq 'sk_live_[A-Za-z0-9]{16,}|service_role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.' "$CLIENT_DIR" 2>/dev/null; then
  echo "  ❌ LEAK: a key-shaped literal (JWT / sk_live / service_role) is in the client bundle"
  grep -rEo 'sk_live_[A-Za-z0-9]{6}|service_role|eyJ[A-Za-z0-9_-]{10}' "$CLIENT_DIR" 2>/dev/null | sort -u | head
  fail=1
fi

# Only NEXT_PUBLIC_* (and Vapi PUBLIC) are allowed to reach the client.
echo "▶ confirming only public vars are inlined"
if grep -rqF "VAPI_PUBLIC_KEY" "$CLIENT_DIR" 2>/dev/null; then
  echo "  ℹ️  VAPI_PUBLIC_KEY present (expected — public by design)"
fi

if [ "$fail" -eq 0 ]; then
  echo "✅ no server secrets found in the client bundle"
else
  echo "❌ key-exposure audit FAILED"
fi
exit $fail
