#!/bin/sh
set -e

# Runtime guard for dev generator URL: only set when an external tunnel is enabled (and not in dev-test).
if { [ "${ENABLE_NGROK_FOR_DEV}" = "1" ] || [ "${ENABLE_CLOUDFLARED_FOR_DEV}" = "1" ]; } \
  && [ -n "${APP_URL_FROM_ANYWHERE}" ] \
  && [ "${ENV:-}" != "dev-test" ]; then
  export NEXT_PUBLIC_DEV_GENERATOR_URL="${APP_URL_FROM_ANYWHERE}"
else
  unset NEXT_PUBLIC_DEV_GENERATOR_URL
fi

# Ensure NEXTAUTH_URL is set for auth to work in dev (ngrok or LAN)
if [ -n "${APP_URL_FROM_ANYWHERE}" ]; then
  export NEXTAUTH_URL="${APP_URL_FROM_ANYWHERE}"
fi

# Release mode simulates the production deploy: full build + optimized server.
if [ "${FRONTEND_RELEASE_MODE}" = "1" ]; then
  echo "[INFO] [frontend] Release mode enabled – running npm run build && npm run start"
  npm run build
  exec npm run start
fi

exec "$@"
