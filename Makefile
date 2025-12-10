# -------------------------
# Root Makefile for "mazle"
# -------------------------

SHELL := /bin/bash

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

COMPOSE_FILE := mazle.compose.yaml:mazle.wasm.compose.yaml

# Backend configuration (like worker-app pattern)
BACKEND_GATEWAY_PATH := generator-rust
APP_NAME := mazle

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
# Override with: make up WITH_DEPS=0
# --------------------------------
ifeq ($(ENV),$(DEV_TEST_ENV))
  WITH_DEPS ?= 0
else
  WITH_DEPS ?= 1
endif

DEPS := DEP_GENERATOR_RUST:$(BACKEND_GATEWAY_PATH):8080

# Ngrok Configuration (Managed by DevOps Toolkit)
# Set to 1 to enable Ngrok tunnel
ENABLE_NGROK_FOR_DEV ?= 1

ifndef INCLUDED_COMPOSE_PROJECT_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose_project_configuration.mk
endif

# Passthrough FLY_API_TOKEN to backend (it uses Fly.io for deployment)
DEPS_PASSTHROUGH_VARS += FLY_API_TOKEN

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

ifneq ($(ENV),$(DEV_TEST_ENV))
  # Tell the toolkit which env var to set with the backend URL
  # This will be passed to Vercel via --build-env during deployment
  NEXTJS_BACKEND_ENV_VAR := NEXT_PUBLIC_GENERATOR_URL
endif

ifndef INCLUDED_NEXTJS_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_configuration.mk
endif

ifndef INCLUDED_NEXTJS_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_targets.mk
endif

# --------------------------------
# Targets (toolkit includes)
# --------------------------------

ifndef INCLUDED_COMPOSE_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_targets.mk
endif
