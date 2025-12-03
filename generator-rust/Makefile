# -------------------------
# Root Makefile for Rust App 'mazle-generator'
# -------------------------

# Connect devops-toolkit
REPO_ROOT      := $(shell git -C $(CURDIR) rev-parse --show-toplevel)
ifndef INCLUDED_TOOLKIT_BOOTSTRAP
  include $(REPO_ROOT)/devops-toolkit/bootstrap.mk
endif


# -------------------------
# External Compose Project Configuration
# -------------------------

ENV ?= dev-test

COMPOSE_PROJECT_NAME := mazle-generator
COMPOSE_NETWORK_NAME ?= mazle_network

WITH_DEPS ?= 0

# Key:Value pairs of dependency services, separated by a space.
# Format: DEP_<service_name>:<service_path>:<port>
DEPS := ""

DEPS_PASSTHROUGH_VARS := WITH_DEPS

COMPOSE_FILE := $(DEVOPS_TOOLKIT_PATH)/backend/docker/rust-app.compose.yaml
COMPOSE_FILE := $(COMPOSE_FILE):override.compose.yaml

ifndef INCLUDED_COMPOSE_PROJECT_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose_project_configuration.mk
endif

# -------------------------
# Compose File Configurations
# -------------------------

# rust-app.compose.yaml configurations
# Note: Use override to prevent inheritance from parent make calls
export APP_NAME := $(COMPOSE_PROJECT_NAME)
override APP_PORT := 3001
export APP_PORT
override APP_HOST_PORT := 3001
export APP_HOST_PORT

# Rust-specific configuration
RUST_BINARY_NAME := mazle-generator

# Deploy target selection (prod/staging use Shuttle for this Rust app)
PROD_DEPLOY_TARGET := shuttle
STAGING_DEPLOY_TARGET := shuttle
SHUTTLE_PROJECT_NAME := mazle-generator

ifndef INCLUDED_COMPOSE_RUST_APP_CONFIGURATION
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/rust-app/compose_rust_app_configuration.mk
endif

# -------------------------
# Final Compose Project Configuration and Targets
# -------------------------

ifndef INCLUDED_COMPOSE_RUST_APP_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-configurations/compose-file-configurations/rust-app/compose_rust_app_targets.mk
endif

ifndef INCLUDED_COMPOSE_PROJECT_TARGETS
  include $(DEVOPS_TOOLKIT_PATH)/backend/make/compose/compose-project-targets/compose_project_targets.mk
endif
