#!/bin/sh
# Runtime guard for dev generator URL: only set when NGROK is enabled.

if [ "${ENABLE_NGROK_FOR_DEV}" = "1" ] && [ -n "${APP_URL_FROM_ANYWHERE}" ]; then
  export NEXT_PUBLIC_DEV_GENERATOR_URL="${APP_URL_FROM_ANYWHERE}"
else
  unset NEXT_PUBLIC_DEV_GENERATOR_URL
fi

exec "$@"
