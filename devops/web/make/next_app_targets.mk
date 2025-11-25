# ------------------------------
# Next.js App Targets
# ------------------------------

SHELL := /bin/bash

ifndef INCLUDED_DEVOPS_BOOTSTRAP
  $(error [toolkit] bootstrap.mk not included before $(lastword $(MAKEFILE_LIST)))
endif

ifndef INCLUDED_ENV_CONFIGURATION
  $(error [ERROR] [Next App Targets] env_configuration.mk must be included before any app targets. \
    Include $$(DEVOPS_PATH)/shared/make/utils/env_configuration.mk in your root Makefile.)
endif

ifndef INCLUDED_NEXT_APP_CONFIGURATION
  $(error [ERROR] [Next App Targets] next_app_configuration.mk must be included before any app targets. \
    Include $$(DEVOPS_PATH)/web/make/next_app_configuration.mk in your root Makefile.)
endif

VERCEL_ORG_FLAG := $(if $(VERCEL_ORG_ID),--org $(VERCEL_ORG_ID),)
VERCEL_TOKEN_FLAG := $(if $(VERCEL_TOKEN),--token $(VERCEL_TOKEN),)
VERCEL_PROJECT_FLAG := $(if $(VERCEL_PROJECT),--project $(VERCEL_PROJECT),)
ENV_EXPORTS := ENV=$(ENV) NODE_ENV=$(NODE_ENV) NEXT_TELEMETRY_DISABLED=$(NEXT_TELEMETRY_DISABLED)

.PHONY: install dev lint typecheck check build start clean verify-env-file \
        vercel-link vercel-env vercel-build vercel-deploy-preview vercel-deploy-prod vercel-dev

## Ensure the computed env file exists
verify-env-file:
	@if [ ! -f "$(ENV_FILE)" ]; then \
	  echo "[ERROR] $(ENV_FILE) not found for ENV=$(ENV). Create it or run 'make vercel-env' first."; \
	  exit 1; \
	fi

## Install node_modules
install:
	$(NODE_BIN) install

## Run Next.js in dev mode with Fast Refresh
dev:
	$(ENV_EXPORTS) PORT=$(PORT) $(NODE_BIN) run dev -- --hostname $(NEXT_START_HOST) --port $(PORT)

## Run ESLint
lint:
	$(NODE_BIN) run lint

## Run TypeScript type-checks (no emit)
typecheck:
	$(NODE_BIN) exec tsc --noEmit --pretty

## Run lint + typecheck
check: lint typecheck

## Production build for the selected ENV
build: verify-env-file
	$(ENV_EXPORTS) $(NODE_BIN) run build

## Serve the built app locally
start: verify-env-file build
	$(ENV_EXPORTS) PORT=$(PORT) $(NODE_BIN) run start -- --hostname $(NEXT_START_HOST) --port $(PORT)

## Remove build artifacts
clean:
	rm -rf .next .turbo .vercel/output

## One-time: link this repo to the Vercel project
vercel-link:
	npx vercel link $(VERCEL_PROJECT_FLAG) $(VERCEL_ORG_FLAG) --yes $(VERCEL_TOKEN_FLAG)

## Pull env vars from Vercel into the correct env file
vercel-env:
	npx vercel env pull $(ENV_FILE) --environment $(VERCEL_ENV_NAME) $(VERCEL_ORG_FLAG) $(VERCEL_TOKEN_FLAG)

## Create a .vercel/output build for deploys
vercel-build: verify-env-file
	$(ENV_EXPORTS) npx vercel build --yes $(VERCEL_DEPLOY_FLAG) $(VERCEL_ORG_FLAG) $(VERCEL_TOKEN_FLAG)

## Deploy a preview build to Vercel
vercel-deploy-preview: vercel-build
	npx vercel deploy --prebuilt --yes $(VERCEL_PROJECT_FLAG) $(VERCEL_ORG_FLAG) $(VERCEL_TOKEN_FLAG)

## Deploy a production build to Vercel
vercel-deploy-prod: vercel-build
	npx vercel deploy --prebuilt --yes --prod $(VERCEL_PROJECT_FLAG) $(VERCEL_ORG_FLAG) $(VERCEL_TOKEN_FLAG)

## Run `vercel dev` locally with Vercel-style env injection
vercel-dev:
	$(ENV_EXPORTS) PORT=$(PORT) npx vercel dev --yes --port $(PORT) $(VERCEL_ORG_FLAG) $(VERCEL_TOKEN_FLAG)

INCLUDED_NEXT_APP_TARGETS := 1
