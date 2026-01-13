# -------------------------
# Root Makefile for "mazle"
# -------------------------

SHELL := bash

# Connect devops-toolkit
REPO_ROOT      := $(shell git -C $(CURDIR) rev-parse --show-toplevel)
ifndef INCLUDED_TOOLKIT_BOOTSTRAP
  include $(REPO_ROOT)/devops-toolkit/bootstrap.mk
endif


# ------------------------------
# Internal Variable Declaration
# ------------------------------

ENV ?= dev-test
COMPOSE_PROJECT_NAME := mazle
COMPOSE_NETWORK_NAME ?= mazle_network

COMPOSE_FILE := mazle.compose.yaml:mazle.wasm.compose.yaml:$(DEVOPS_TOOLKIT_PATH)/backend/docker/db.compose.yaml:override.compose.yaml

# Backend configuration (like worker-app pattern)
BACKEND_GATEWAY_PATH := generator-rust
APP_NAME := mazle

# Database + migrations (devops-toolkit)
export COMPOSE_DB_NAME := mazle_pg_db
export MIGRATIONS_PATH := $(REPO_ROOT)/migrations
export BWS_PROJECT_NAME_FOR_DB_SECRETS := $(APP_NAME)-$(ENV)

# Include env configuration early so we can use DEV_TEST_ENV, PROD_ENV etc.
ifndef INCLUDED_ENV_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/shared/make/utils/env_configuration.mk
endif

# --------------------------------
# Backend dependency configuration
# --------------------------------
# WITH_DEPS controls whether backend is launched/deployed:
#   dev-test: WITH_DEPS=0 (WASM fallback, no backend needed)
#   others:   WITH_DEPS=1 (backend auto-starts/deploys)
#
# Override with:
#   make up WITH_DEPS=0      # Manual override
# --------------------------------
ifeq ($(ENV),$(DEV_TEST_ENV))
  WITH_DEPS ?= 0
else
  WITH_DEPS ?= 1
endif

DEPS := DEP_GENERATOR_RUST:$(BACKEND_GATEWAY_PATH):8080

# Ngrok Configuration (Managed by DevOps Toolkit)
# Set to 1 to enable Ngrok tunnel (same default for all envs).
ENABLE_NGROK_FOR_DEV ?= 1
export ENABLE_NGROK_FOR_DEV

ifndef INCLUDED_COMPOSE_PROJECT_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose_project_configuration.mk
endif

# Passthrough FLY_API_TOKEN to backend (it uses Fly.io for deployment)
DEPS_PASSTHROUGH_VARS += FLY_API_TOKEN
# Passthrough Docker build cache vars for GHA caching
DEPS_PASSTHROUGH_VARS += DOCKER_BUILD_CACHE_FROM DOCKER_BUILD_CACHE_TO

export APP_NAME
override APP_PORT := 8080

# Deploy target selection (prod/staging use Vercel for this app)
PROD_DEPLOY_TARGET := vercel
STAGING_DEPLOY_TARGET := vercel
VERCEL_PROJECT_NAME := mazle

# Public env wiring
export NEXT_PUBLIC_ENV := $(ENV)
NEXT_PUBLIC_DEVTOOLS_ENABLED := 0
ifneq (,$(filter $(ENV),$(DEV_TEST_ENV)))
  NEXT_PUBLIC_DEVTOOLS_ENABLED := 1
endif

# Nginx: in dev-test the Rust backend isn't running, so allow the upstream
# host to be unresolved at startup. These vars are substituted into
# nginx/nginx.conf.template.
NGINX_RESOLVER_DIRECTIVE ?=
NGINX_BACKEND_RESOLVE_SUFFIX ?=
NGINX_BACKEND_ZONE_DIRECTIVE ?=
ifeq ($(ENV),$(DEV_TEST_ENV))
  NGINX_RESOLVER_DIRECTIVE := resolver 127.0.0.11 ipv6=off valid=30s;
  NGINX_BACKEND_RESOLVE_SUFFIX := resolve
  NGINX_BACKEND_ZONE_DIRECTIVE := zone backend 64k;
endif
export NGINX_RESOLVER_DIRECTIVE
export NGINX_BACKEND_RESOLVE_SUFFIX
export NGINX_BACKEND_ZONE_DIRECTIVE

# Toggle for running the frontend as a production-style build locally
FRONTEND_RELEASE_MODE ?= 0

FRONTEND_NODE_ENV := development
FRONTEND_CHOKIDAR_USEPOLLING := 1
FRONTEND_WATCHPACK_POLLING := 1

ifeq ($(FRONTEND_RELEASE_MODE),1)
  NEXT_PUBLIC_DEVTOOLS_ENABLED := 0
  FRONTEND_NODE_ENV := production
  FRONTEND_CHOKIDAR_USEPOLLING := 0
  FRONTEND_WATCHPACK_POLLING := 0
endif

export NEXT_PUBLIC_DEVTOOLS_ENABLED
export FRONTEND_RELEASE_MODE
export FRONTEND_NODE_ENV
export FRONTEND_CHOKIDAR_USEPOLLING
export FRONTEND_WATCHPACK_POLLING

ifndef INCLUDED_COMPOSE_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_configuration.mk
endif

# --------------------------------
# WASM Generator Configuration
# --------------------------------
# Environment variables used by wasm-build service in mazle.wasm.compose.yaml
# The build_pre_sync profile handles running this before the main build

WASM_PACK_VERSION ?= 0.13.1
WASM_RUST_VERSION ?= 1.83
WASM_RUST_TOOLCHAIN := $(shell sed -n 's/^channel[[:space:]]*=[[:space:]]*\"\\(.*\\)\"/\\1/p' $(CURDIR)/generator-rust/rust-toolchain.toml)
WASM_RUST_TOOLCHAIN := $(if $(strip $(WASM_RUST_TOOLCHAIN)),$(strip $(WASM_RUST_TOOLCHAIN)),nightly)
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
export WASM_PACK_VERSION
export WASM_RUST_VERSION
export WASM_RUST_TOOLCHAIN
export HOST_UID
export HOST_GID

# --------------------------------
# Next.js App Configuration (for backend URL resolution)
# --------------------------------

# WASM_ONLY=1 disables backend URL resolution/export so the app defaults to WASM.
WASM_ONLY ?= 0

ifneq ($(ENV),$(DEV_TEST_ENV))
  ifneq ($(WASM_ONLY),1)
    # Tell the toolkit which env var to set with the backend URL
    # This will be passed to Vercel via --build-env during deployment
    NEXTJS_BACKEND_ENV_VAR := NEXT_PUBLIC_GENERATOR_URL
  endif
endif

ifndef INCLUDED_NEXTJS_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_configuration.mk
endif

ifndef INCLUDED_NEXTJS_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_targets.mk
endif

# --------------------------------
# Local Env (BWS)
# --------------------------------

ifndef INCLUDED_ENV_LOCAL_UTILS
  include $(DEVOPS_TOOLKIT_PATH)/shared/make/utils/env_local.mk
endif

# Load BWS .env.local in dev + dev-test.
ifneq (,$(filter $(ENV),$(DEV_ENV) $(DEV_TEST_ENV)))
up:: env-local
endif

# --------------------------------
# Targets (toolkit includes)
# --------------------------------

ifndef INCLUDED_COMPOSE_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_targets.mk
endif
