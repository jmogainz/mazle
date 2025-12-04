# syntax=docker/dockerfile:1.4

# ────────────────────────────────  Dependencies  ────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat curl
COPY package*.json ./
RUN npm ci

# ────────────────────────────────  Builder  ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG ENV=dev-test
ARG NEXT_PUBLIC_ENV=dev-test
ARG NEXT_PUBLIC_DEVTOOLS_ENABLED=0
ARG NEXT_PUBLIC_GENERATOR_URL=

ENV ENV=${ENV}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_DEVTOOLS_ENABLED=${NEXT_PUBLIC_DEVTOOLS_ENABLED}
ENV NEXT_PUBLIC_GENERATOR_URL=${NEXT_PUBLIC_GENERATOR_URL}
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ────────────────────────────────  Runtime  ───────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ARG ENV=dev-test
ARG NEXT_PUBLIC_ENV=dev-test
ARG NEXT_PUBLIC_DEVTOOLS_ENABLED=0
ARG NEXT_PUBLIC_GENERATOR_URL=

ENV ENV=${ENV}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_DEVTOOLS_ENABLED=${NEXT_PUBLIC_DEVTOOLS_ENABLED}
ENV NEXT_PUBLIC_GENERATOR_URL=${NEXT_PUBLIC_GENERATOR_URL}
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache curl libc6-compat

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3000

CMD ["npm", "run", "start"]
