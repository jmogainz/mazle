# -----------------------
# ENV Configuration
# -----------------------

SHELL := /bin/bash

ifeq ($(wildcard Makefile),)
  $(error Error: Makefile not found. Please ensure you are in the root directory of your project.)
endif

ifndef INCLUDED_DEVOPS_BOOTSTRAP
  $(error [toolkit] bootstrap.mk not included before $(lastword $(MAKEFILE_LIST)))
endif

INCLUDED_ENV_CONFIGURATION := 1

# ---------------------------------
# Internal Variable Declaration
# ---------------------------------

ENV ?= dev

DEV_TEST_ENV := dev-test
DEV_ENV := dev
STAGING_TEST_ENV := staging-test
STAGING_ENV := staging
PROD_ENV := prod

ALLOWED_ENVS := $(DEV_TEST_ENV) $(DEV_ENV) $(STAGING_TEST_ENV) $(STAGING_ENV) $(PROD_ENV)

# --------------------------------
# External Variable Validation
# --------------------------------

ifndef ENV
  $(error ENV is not set. Please define it in your local Makefile or runtime/ci environment. \
  Example: ENV=dev-test, Options: $(ALLOWED_ENVS))
endif

ifeq (,$(filter $(ENV),$(ALLOWED_ENVS)))
  $(error ENV is set to an invalid value. Allowed values are: $(ALLOWED_ENVS))
endif

# ------------------------------
# Internal Variable Declaration
# ------------------------------

ifeq ($(ENV),$(PROD_ENV))
  NODE_ENV := production
  ENV_FILE ?= .env.production
  VERCEL_ENV_NAME := production
  VERCEL_DEPLOY_FLAG := --prod
else ifneq (,$(filter $(ENV),$(STAGING_ENV) $(STAGING_TEST_ENV)))
  NODE_ENV := production
  ENV_FILE ?= .env.staging
  VERCEL_ENV_NAME := preview
  VERCEL_DEPLOY_FLAG :=
else
  NODE_ENV := development
  ENV_FILE ?= .env.local
  VERCEL_ENV_NAME := development
  VERCEL_DEPLOY_FLAG :=
endif

PORT ?= 3000
NEXT_TELEMETRY_DISABLED ?= 1

export ENV
export NODE_ENV
export ENV_FILE
export VERCEL_ENV_NAME
export VERCEL_DEPLOY_FLAG
export PORT
export NEXT_TELEMETRY_DISABLED
