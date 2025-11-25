# ------------------------------
# Next.js App Configuration
# ------------------------------

SHELL := /bin/bash

ifeq ($(wildcard Makefile),)
  $(error Error: Makefile not found. Please ensure you are in the root directory of your project.)
endif

ifndef INCLUDED_DEVOPS_BOOTSTRAP
  $(error [toolkit] bootstrap.mk not included before $(lastword $(MAKEFILE_LIST)))
endif

ifndef INCLUDED_ENV_CONFIGURATION
  $(error [ERROR] [Next App Configuration] env_configuration.mk must be included before any app configuration. \
    Include $$(DEVOPS_PATH)/shared/make/utils/env_configuration.mk in your root Makefile.)
endif

ifndef APP_NAME
  $(error APP_NAME is not set. Please define it in your local Makefile. Example: APP_NAME=mazle)
endif

ifneq ($(origin APP_NAME), file)
  $(error APP_NAME should be hardcoded in the root Makefile, not provided at runtime. \
    Example: APP_NAME=mazle)
endif

VERCEL_PROJECT ?= $(APP_NAME)
NODE_BIN ?= npm
NEXT_PORT ?= $(PORT)
NEXT_START_HOST ?= 0.0.0.0

export APP_NAME
export VERCEL_PROJECT
export NODE_BIN
export NEXT_PORT
export NEXT_START_HOST

INCLUDED_NEXT_APP_CONFIGURATION := 1
