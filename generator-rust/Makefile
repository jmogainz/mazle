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
#  ####

ENV ?= dev

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
override APP_PORT := 8080

# Rust-specific configuration
RUST_BINARY_NAME := mazle-generator

# Deploy target selection (prod/staging use Fly.io for this Rust app)
PROD_DEPLOY_TARGET := fly
STAGING_DEPLOY_TARGET := fly
STAGING_FLY_TOML_PATH := deploy/staging.fly.toml
PROD_FLY_TOML_PATH := deploy/fly.toml

# Fly.io organization names (override devops-toolkit defaults)
FLY_STAGING_ORG_NAME := mazle-staging
FLY_PROD_ORG_NAME := mazle

# Skip WireGuard - this is a standalone stateless service without internal networking needs
SKIP_FLY_WIREGUARD := 1

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

# -------------------------
# ML / Python bridge + training
# -------------------------
.PHONY: ml-bridge
ml-bridge: ml-venv
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	CARGO_HOME=$(REPO_ROOT)/.cargo CARGO_TARGET_DIR=$(REPO_ROOT)/.cargo-target \
		cd ml/bridge && $(CURDIR)/ml/.venv/bin/python -m maturin develop

.PHONY: ml-venv
ml-venv:
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@if [ ! -d "ml/.venv" ]; then \
		python3 -m venv ml/.venv; \
	fi
	$(CURDIR)/ml/.venv/bin/python -m pip install -U pip
	$(CURDIR)/ml/.venv/bin/python -m pip install -r ml/requirements.txt

.PHONY: ml-setup
ml-setup: ml-venv ml-bridge

ML_CONFIG ?= $(REPO_ROOT)/generator-rust/ml/config/pretrain.yaml
ML_DATA ?=
ML_OUT ?=
ML_DATA_COUNT ?=
ML_EPOCHS ?=
ML_BATCH_SIZE ?=
ML_PRESET ?=
ML_VAL_PCT ?=
ML_TEST_PCT ?=
ML_SHUFFLE_BUFFER ?=
ML_EVAL_STEPS ?=
ML_SOLVER_EVAL ?=
ML_SOLVER_SAMPLES ?=
ML_SOLVER_TARGET_MOVES ?=
ML_AMP ?=
ML_COMPILE ?=
ML_EVAL_TEST ?=
ML_EXTRA_ARGS ?=

ML_TUNE_NUM_SAMPLES ?=
ML_TUNE_ARCH ?=
ML_TUNE_METRIC ?=
ML_TUNE_MODE ?=
ML_TUNE_MAX_CONCURRENT ?=
ML_TUNE_CPUS ?=
ML_TUNE_EXTRA_ARGS ?=

ML_TUNE_NUM_SAMPLES_FLAG := $(if $(ML_TUNE_NUM_SAMPLES),--num-samples $(ML_TUNE_NUM_SAMPLES),)
ML_TUNE_ARCH_FLAG := $(if $(ML_TUNE_ARCH),$(if $(filter 1,$(ML_TUNE_ARCH)),--tune-arch,),)
ML_TUNE_METRIC_FLAG := $(if $(ML_TUNE_METRIC),--metric $(ML_TUNE_METRIC),)
ML_TUNE_MODE_FLAG := $(if $(ML_TUNE_MODE),--mode $(ML_TUNE_MODE),)
ML_TUNE_MAX_CONCURRENT_FLAG := $(if $(ML_TUNE_MAX_CONCURRENT),--max-concurrent $(ML_TUNE_MAX_CONCURRENT),)
ML_TUNE_CPUS_FLAG := $(if $(ML_TUNE_CPUS),--cpus-per-trial $(ML_TUNE_CPUS),)

.PHONY: ml-pretrain
ml-pretrain: ml-venv ml-bridge
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	ML_CONFIG=$(ML_CONFIG) \
	ML_DATA=$(ML_DATA) \
	ML_OUT=$(ML_OUT) \
	ML_DATA_COUNT=$(ML_DATA_COUNT) \
	ML_EPOCHS=$(ML_EPOCHS) \
	ML_BATCH_SIZE=$(ML_BATCH_SIZE) \
	ML_PRESET=$(ML_PRESET) \
	ML_VAL_PCT=$(ML_VAL_PCT) \
	ML_TEST_PCT=$(ML_TEST_PCT) \
	ML_SHUFFLE_BUFFER=$(ML_SHUFFLE_BUFFER) \
	ML_EVAL_STEPS=$(ML_EVAL_STEPS) \
	ML_SOLVER_EVAL=$(ML_SOLVER_EVAL) \
	ML_SOLVER_SAMPLES=$(ML_SOLVER_SAMPLES) \
	ML_SOLVER_TARGET_MOVES=$(ML_SOLVER_TARGET_MOVES) \
	ML_AMP=$(ML_AMP) \
	ML_COMPILE=$(ML_COMPILE) \
	ML_EVAL_TEST=$(ML_EVAL_TEST) \
	ML_EXTRA_ARGS="$(ML_EXTRA_ARGS)" \
	bash ml/scripts/run_pretrain.sh

.PHONY: ml-tune
ml-tune: ml-venv ml-bridge
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	$(CURDIR)/ml/.venv/bin/python ml/tune.py \
		$(ML_CONFIG_FLAG) \
		$(ML_DATA_FLAG) \
		$(ML_OUT_FLAG) \
		$(ML_DATA_COUNT_FLAG) \
		$(ML_EPOCHS_FLAG) \
		$(ML_BATCH_SIZE_FLAG) \
		$(ML_PRESET_FLAG) \
		$(ML_VAL_PCT_FLAG) \
		$(ML_TEST_PCT_FLAG) \
		$(ML_SHUFFLE_BUFFER_FLAG) \
		$(ML_EVAL_STEPS_FLAG) \
		$(ML_AMP_FLAG) \
		$(ML_COMPILE_FLAG) \
		$(ML_EVAL_TEST_FLAG) \
		$(ML_SOLVER_FLAGS) \
		$(ML_TUNE_NUM_SAMPLES_FLAG) \
		$(ML_TUNE_ARCH_FLAG) \
		$(ML_TUNE_METRIC_FLAG) \
		$(ML_TUNE_MODE_FLAG) \
		$(ML_TUNE_MAX_CONCURRENT_FLAG) \
		$(ML_TUNE_CPUS_FLAG) \
		$(ML_TUNE_EXTRA_ARGS)

# -------------------------
# Dataset generation (native, outside Docker)
# -------------------------
DATASET_OUT ?= $(CURDIR)/data/mazle-train.jsonl
DATASET_LOG ?= $(CURDIR)/data/mazle-train.log
DATASET_PID ?= $(CURDIR)/data/mazle-train.pid
DATASET_COUNT ?= 100000
DATASET_START_INDEX ?= 1
DATASET_APPEND ?= 0
DATASET_SEED_PREFIX ?= train
DATASET_MAP_TYPE ?= ice
DATASET_SIZE ?= 15

.PHONY: dataset-gen
dataset-gen: RUST_BUILD_PROFILE := release
dataset-gen: cargo-build
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@mkdir -p "$(dir $(DATASET_OUT))"
	@if command -v setsid >/dev/null 2>&1; then \
		DATASET_OUT="$(DATASET_OUT)" \
		DATASET_COUNT="$(DATASET_COUNT)" \
		DATASET_START_INDEX="$(DATASET_START_INDEX)" \
		DATASET_APPEND="$(DATASET_APPEND)" \
		DATASET_SEED_PREFIX="$(DATASET_SEED_PREFIX)" \
		DATASET_MAP_TYPE="$(DATASET_MAP_TYPE)" \
		DATASET_SIZE="$(DATASET_SIZE)" \
		setsid ./target/release/mazle-generator </dev/null > "$(DATASET_LOG)" 2>&1 & \
		echo $$! | tee "$(DATASET_PID)"; \
	else \
		DATASET_OUT="$(DATASET_OUT)" \
		DATASET_COUNT="$(DATASET_COUNT)" \
		DATASET_START_INDEX="$(DATASET_START_INDEX)" \
		DATASET_APPEND="$(DATASET_APPEND)" \
		DATASET_SEED_PREFIX="$(DATASET_SEED_PREFIX)" \
		DATASET_MAP_TYPE="$(DATASET_MAP_TYPE)" \
		DATASET_SIZE="$(DATASET_SIZE)" \
		nohup ./target/release/mazle-generator </dev/null > "$(DATASET_LOG)" 2>&1 & \
		echo $$! | tee "$(DATASET_PID)"; \
	fi
