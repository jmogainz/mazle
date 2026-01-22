# syntax=docker/dockerfile:1.4

# ────────────────────────────────  Dependencies  ────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat curl
COPY package*.json ./
# Dev entrypoint helper (used in dev-compose target)
COPY scripts/dev-env-entrypoint.sh /usr/local/bin/dev-env-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-env-entrypoint.sh
# Cache npm downloads across builds to avoid re-fetching packages.
RUN --mount=type=cache,target=/root/.npm npm ci --progress=false

# ────────────────────────────────  Builder  ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG ENV=dev
ARG NEXT_PUBLIC_ENV=dev
ARG NEXT_PUBLIC_DEVTOOLS_ENABLED=0
ARG NEXT_PUBLIC_GENERATOR_URL=
ARG NEXT_PUBLIC_DEV_GENERATOR_URL=
ARG ENABLE_NGROK_FOR_DEV=1
ARG ENABLE_CLOUDFLARED_FOR_DEV=0
ARG APP_URL_FROM_ANYWHERE=

ENV ENV=${ENV}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_DEVTOOLS_ENABLED=${NEXT_PUBLIC_DEVTOOLS_ENABLED}
ENV NEXT_PUBLIC_GENERATOR_URL=${NEXT_PUBLIC_GENERATOR_URL}
ENV NEXT_PUBLIC_DEV_GENERATOR_URL=${NEXT_PUBLIC_DEV_GENERATOR_URL}
ENV ENABLE_NGROK_FOR_DEV=${ENABLE_NGROK_FOR_DEV}
ENV ENABLE_CLOUDFLARED_FOR_DEV=${ENABLE_CLOUDFLARED_FOR_DEV}
ENV APP_URL_FROM_ANYWHERE=${APP_URL_FROM_ANYWHERE}
ENV NEXTAUTH_URL=${APP_URL_FROM_ANYWHERE}
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
# Copy only what the build needs (keep context lean)
COPY package*.json ./
COPY next.config.mjs ./
COPY tsconfig.json ./
COPY next-env.d.ts ./
COPY middleware.ts ./
COPY vercel.json ./
COPY public ./public
COPY src ./src

# Cache Next.js build artifacts between builds when using BuildKit.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=cache,target=/root/.npm \
    npm run build

# ────────────────────────────────  Runtime  ───────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ARG ENV=dev
ARG NEXT_PUBLIC_ENV=dev
ARG NEXT_PUBLIC_DEVTOOLS_ENABLED=0
ARG NEXT_PUBLIC_GENERATOR_URL=
ARG NEXT_PUBLIC_DEV_GENERATOR_URL=
ARG ENABLE_NGROK_FOR_DEV=1
ARG ENABLE_CLOUDFLARED_FOR_DEV=0
ARG APP_URL_FROM_ANYWHERE=

ENV ENV=${ENV}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_DEVTOOLS_ENABLED=${NEXT_PUBLIC_DEVTOOLS_ENABLED}
ENV NEXT_PUBLIC_GENERATOR_URL=${NEXT_PUBLIC_GENERATOR_URL}
ENV NEXT_PUBLIC_DEV_GENERATOR_URL=${NEXT_PUBLIC_DEV_GENERATOR_URL}
ENV ENABLE_NGROK_FOR_DEV=${ENABLE_NGROK_FOR_DEV}
ENV ENABLE_CLOUDFLARED_FOR_DEV=${ENABLE_CLOUDFLARED_FOR_DEV}
ENV APP_URL_FROM_ANYWHERE=${APP_URL_FROM_ANYWHERE}
ENV NEXTAUTH_URL=${APP_URL_FROM_ANYWHERE}
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache curl libc6-compat

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 8080

CMD ["npm", "run", "start"]
