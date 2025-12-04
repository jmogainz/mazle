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

ifndef INCLUDED_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_configuration.mk
endif

# --------------------------------
# Next.js App Configuration (for backend URL resolution)
# --------------------------------

ifndef INCLUDED_NEXTJS_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_configuration.mk
endif

ifndef INCLUDED_NEXTJS_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/frontend/make/utils/nextjs_app_targets.mk
endif

# --------------------------------
# WASM Generator Configuration
# --------------------------------

# Path to the WASM output directory
WASM_OUTPUT_DIR := $(CURDIR)/src/wasm/generator
# Marker file for tracking WASM build state
WASM_BUILD_MARKER := $(WASM_OUTPUT_DIR)/.build-marker
# Rust source files to watch for changes
RUST_GENERATOR_SRC := $(shell find $(CURDIR)/generator-rust/src -name '*.rs' 2>/dev/null)

# --------------------------------
# Targets
# --------------------------------

ifndef INCLUDED_COMPOSE_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_targets.mk
endif

# --------------------------------
# WASM Build Targets
# --------------------------------

.PHONY: wasm wasm-clean wasm-check

## Build WASM generator from Rust (if sources changed)
## Built with threads support (atomics) for parallel generation via rayon
## Requires: rustup +nightly component add rust-src
wasm: $(WASM_BUILD_MARKER)

$(WASM_BUILD_MARKER): $(RUST_GENERATOR_SRC) $(CURDIR)/generator-rust/Cargo.toml $(CURDIR)/generator-rust/.cargo/config.toml $(CURDIR)/generator-rust/rust-toolchain.toml
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

# --------------------------------
# Override _up-app to set NEXT_PUBLIC_GENERATOR_URL from backend
# --------------------------------

# For dev-test: client-only mode, no backend needed (uses WASM)
ifeq ($(ENV),$(DEV_TEST_ENV))
_up-app: wasm
	@if [ -z "$(COMPOSE_PROFILE_APP_SERVICES)" ]; then \
		echo "[ERROR] [Up-App] No services found matching the '$(COMPOSE_PROFILE_APP)' profile!"; \
	else \
		echo "[INFO] [Up-App] Running in dev-test mode (client-only, WASM fallback)"; \
		export NEXT_PUBLIC_GENERATOR_URL=""; \
		echo "[INFO] [Up-App] Starting app services found matching the '$(COMPOSE_PROFILE_APP)' profile..."; \
		echo "[INFO] [Up-App] Found services: $(COMPOSE_PROFILE_APP_SERVICES)"; \
		echo "[INFO] [Up-App] Spinning up app..."; \
		$(COMPOSE_CMD) --profile $(COMPOSE_PROFILE_APP) up -d --no-build; \
		echo "[INFO] [Up-App] Done. $(APP_NAME) is running on $(APP_URL_FROM_ANYWHERE)"; \
	fi
endif

# For dev: get backend URL dynamically before starting frontend
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
		echo "[INFO] [Up-App] Done. $$APP_NAME is running on $$APP_URL_FROM_ANYWHERE"; \
	fi
endif

# For Vercel deploys, resolve backend URL before deploying (mazle-specific)
ifeq ($(DEPLOY_TARGET_FOR_ENV),vercel)
_up-app:
	@set -euo pipefail; \
	export LOG_LEVEL=; \
	if ! command -v vercel >/dev/null 2>&1; then \
		echo "[ERROR] [Up App] vercel CLI not found. Install with 'npm i -g vercel'."; \
		exit 1; \
	fi; \
	if [ -z "$(strip $(VERCEL_TOKEN))" ]; then \
		echo "[ERROR] [Up App] VERCEL_TOKEN is required but not set."; \
		exit 1; \
	fi; \
	echo "[INFO] [Up App] Resolving backend URL (with health check)..."; \
	CURRENT_BACKEND_DOMAIN="$$( ENV=$(ENV) FLY_API_TOKEN=$(FLY_API_TOKEN) UNIQUE_RUNNER_ID=$(UNIQUE_RUNNER_ID) $(MAKE) -C $(BACKEND_GATEWAY_PATH) --no-print-directory PRINT_INFO=0 print-public-app-domain | tail -1 )"; \
	export NEXT_PUBLIC_GENERATOR_URL="https://$$CURRENT_BACKEND_DOMAIN"; \
	echo "[INFO] [Up App] NEXT_PUBLIC_GENERATOR_URL=$$NEXT_PUBLIC_GENERATOR_URL"; \
	echo "[INFO] [Up App] Deploying $(APP_NAME) to Vercel..."; \
	DEPLOY_URL=$$(VERCEL_ORG_ID=$(VERCEL_ORG_ID) VERCEL_PROJECT_ID=$(VERCEL_PROJECT_ID) VERCEL_PROJECT_NAME=$(VERCEL_PROJECT_NAME) \
		vercel deploy --prod --token $(VERCEL_TOKEN) --yes --force --cwd $(CURDIR) \
		--build-env NEXT_PUBLIC_GENERATOR_URL="$$NEXT_PUBLIC_GENERATOR_URL" \
		| /usr/bin/grep -Eo 'https://[^ ]+' | tail -n1); \
	if [ -z "$$DEPLOY_URL" ]; then \
		echo "[ERROR] [Up App] Failed to capture Vercel deploy URL."; \
		exit 1; \
	fi; \
	echo "$$DEPLOY_URL" > .last_vercel_deploy_url; \
	echo "[INFO] [Up App] Done. App $(APP_NAME) available at $$DEPLOY_URL."
endif
