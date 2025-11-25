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

WITH_DEPS := 0
DEPS := ""

ifndef INCLUDED_COMPOSE_PROJECT_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose_project_configuration.mk
endif

export APP_NAME := $(COMPOSE_PROJECT_NAME)
override APP_PORT := 3000

# Deploy target selection (prod/staging use Vercel for this app)
PROD_DEPLOY_TARGET := vercel
STAGING_DEPLOY_TARGET := vercel
VERCEL_PROJECT_NAME := mazle
# Production URL is auto-assigned by Vercel - check dashboard for actual domain

# Public env wiring
export NEXT_PUBLIC_ENV := $(ENV)
NEXT_PUBLIC_DEVTOOLS_ENABLED := 0
ifneq (,$(filter $(ENV),$(DEV_TEST_ENV) $(PROD_ENV)))
  NEXT_PUBLIC_DEVTOOLS_ENABLED := 1
endif
export NEXT_PUBLIC_DEVTOOLS_ENABLED

ifndef INCLUDED_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_configuration.mk
endif

# --------------------------------
# Targets
# --------------------------------

ifndef INCLUDED_COMPOSE_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/app/compose_app_targets.mk
endif
