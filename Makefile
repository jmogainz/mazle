# -------------------------
# Root Makefile for "mazle"
# -------------------------

ENV ?= dev
APP_NAME := mazle
VERCEL_PROJECT ?= $(APP_NAME)
NODE_BIN ?= npm
PORT ?= 3000
NEXT_START_HOST ?= 0.0.0.0

ifndef INCLUDED_DEVOPS_BOOTSTRAP
  include devops/bootstrap.mk
endif

ifndef INCLUDED_HELP
  include $(DEVOPS_PATH)/shared/make/help.mk
endif

ifndef INCLUDED_ENV_CONFIGURATION
  include $(DEVOPS_PATH)/shared/make/utils/env_configuration.mk
endif

ifndef INCLUDED_NEXT_APP_CONFIGURATION
  include $(DEVOPS_PATH)/web/make/next_app_configuration.mk
endif

ifndef INCLUDED_NEXT_APP_TARGETS
  include $(DEVOPS_PATH)/web/make/next_app_targets.mk
endif
