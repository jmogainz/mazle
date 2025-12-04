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

COMPOSE_FILE := mazle.compose.yaml

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

DEPS := DEP_GENERATOR_RUST:$(BACKEND_GATEWAY_PATH):3001

ifndef INCLUDED_COMPOSE_PROJECT_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose_project_configuration.mk
endif

# Passthrough FLY_API_TOKEN to backend (it uses Fly.io for deployment)
DEPS_PASSTHROUGH_VARS += FLY_API_TOKEN

export APP_NAME
override APP_PORT := 3000
export APP_HOST_PORT := 3000

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
export NEXT_PUBLIC_DEVTOOLS_ENABLED

ifndef INCLUDED_COMPOSE_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_configuration.mk
endif

# --------------------------------
# WASM Generator Configuration & Targets
# --------------------------------
# MUST be defined BEFORE nextjs_app_targets.mk so up:: wasm runs first

# Path to the WASM output directory
WASM_OUTPUT_DIR := $(CURDIR)/src/wasm/generator
# Marker file for tracking WASM build state
WASM_BUILD_MARKER := $(WASM_OUTPUT_DIR)/.build-marker
# Rust source files to watch for changes
RUST_GENERATOR_SRC := $(shell find $(CURDIR)/generator-rust/src -name '*.rs' 2>/dev/null)

.PHONY: wasm wasm-clean wasm-check _wasm-build

## Build WASM generator from Rust (if sources changed)
## Built with threads support (atomics) for parallel generation via rayon
## Requires: rustup +nightly component add rust-src
wasm:
	@if [ ! -f "$(WASM_BUILD_MARKER)" ]; then \
		echo "[INFO] [WASM] No build marker found. Building..."; \
		$(MAKE) _wasm-build --no-print-directory; \
	elif [ -n "$$(find $(CURDIR)/generator-rust/src -name '*.rs' -newer $(WASM_BUILD_MARKER) 2>/dev/null)" ]; then \
		echo "[INFO] [WASM] Rust sources changed. Rebuilding..."; \
		$(MAKE) _wasm-build --no-print-directory; \
	elif [ "$(CURDIR)/generator-rust/Cargo.toml" -nt "$(WASM_BUILD_MARKER)" ]; then \
		echo "[INFO] [WASM] Cargo.toml changed. Rebuilding..."; \
		$(MAKE) _wasm-build --no-print-directory; \
	else \
		echo "[INFO] [WASM] WASM is up to date."; \
	fi

_wasm-build:
	@echo "[INFO] [WASM] Building generator from Rust sources (with threads)..."
	@if ! command -v wasm-pack >/dev/null 2>&1; then \
		echo "[INFO] [WASM] Installing wasm-pack..."; \
		cargo install wasm-pack; \
	fi
	@echo "[INFO] [WASM] Building with wasm-pack (atomics + shared memory)..."
	@cd $(CURDIR)/generator-rust && \
		wasm-pack build --target web --out-dir $(WASM_OUTPUT_DIR) --out-name mazle_generator
	@touch $(WASM_BUILD_MARKER)
	@echo "[INFO] [WASM] Build complete. Output at $(WASM_OUTPUT_DIR)"
	@echo "[INFO] [WASM] Note: Requires COOP/COEP headers for SharedArrayBuffer"

## Force rebuild of WASM generator
wasm-rebuild:
	@rm -f $(WASM_BUILD_MARKER)
	@$(MAKE) wasm

## Clean WASM build artifacts
wasm-clean:
	@echo "[INFO] [WASM] Cleaning build artifacts..."
	@rm -rf $(WASM_OUTPUT_DIR)
	@echo "[INFO] [WASM] Clean complete."

## Check if WASM needs rebuilding
wasm-check:
	@if [ ! -f "$(WASM_BUILD_MARKER)" ]; then \
		echo "[INFO] [WASM] No build marker found. WASM needs building."; \
		exit 1; \
	elif [ -n "$$(find $(CURDIR)/generator-rust/src -name '*.rs' -newer $(WASM_BUILD_MARKER) 2>/dev/null)" ]; then \
		echo "[INFO] [WASM] Rust sources changed. WASM needs rebuilding."; \
		exit 1; \
	else \
		echo "[INFO] [WASM] WASM is up to date."; \
	fi

# WASM as prerequisite for all up:: calls - defined FIRST so it runs before other up:: rules
up:: wasm

# --------------------------------
# Next.js App Configuration (for backend URL resolution)
# --------------------------------

# Tell the toolkit which env var to set with the backend URL
# This will be passed to Vercel via --build-env during deployment
NEXTJS_BACKEND_ENV_VAR := NEXT_PUBLIC_GENERATOR_URL

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

# --------------------------------
# Dev environment override for _up-app
# --------------------------------
# The toolkit's default _up-app falls back to localhost:3001 for dev,
# but we need to resolve the actual backend domain from the running container.
# This override properly calls _export_current_backend_domain to get the Docker URL.
# Note: Prod/staging use the toolkit's version which correctly handles Vercel + Fly.io

ifeq ($(ENV),$(DEV_ENV))
_up-app: wasm
	@if [ -z "$(COMPOSE_PROFILE_APP_SERVICES)" ]; then \
		echo "[ERROR] [Up-App] No services found matching the '$(COMPOSE_PROFILE_APP)' profile!"; \
	else \
		echo "[INFO] [Up-App] Resolving backend URL (with health check)..."; \
		backend_export="$$( env -i PATH="$$PATH" HOME="$$HOME" UNIQUE_RUNNER_ID="$$UNIQUE_RUNNER_ID" $(MAKE) _export_current_backend_domain --no-print-directory )"; \
		rc=$$?; \
		if [ $$rc -eq 0 ]; then \
			eval "$$backend_export"; \
			export NEXT_PUBLIC_GENERATOR_URL="$$CURRENT_BACKEND_DOMAIN"; \
			echo "[INFO] [Up-App] NEXT_PUBLIC_GENERATOR_URL=$$NEXT_PUBLIC_GENERATOR_URL"; \
		else \
			echo "[WARN] [Up-App] Backend not available (rc=$$rc), WASM fallback will be used"; \
			export NEXT_PUBLIC_GENERATOR_URL=""; \
		fi; \
		echo "[INFO] [Up-App] Starting app services found matching the '$(COMPOSE_PROFILE_APP)' profile..."; \
		echo "[INFO] [Up-App] Found services: $(COMPOSE_PROFILE_APP_SERVICES)"; \
		echo "[INFO] [Up-App] Spinning up app..."; \
		$(COMPOSE_CMD) --profile $(COMPOSE_PROFILE_APP) up -d --no-build; \
		echo "[INFO] [Up-App] Done. $(APP_NAME) is running on $(APP_URL_FROM_ANYWHERE)"; \
	fi
endif
