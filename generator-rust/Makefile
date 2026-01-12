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
ML_TUNE_CONFIG ?= $(CURDIR)/ml/config/tune-light.yaml
ML_TUNE_LOG ?= $(CURDIR)/data/ml-tune.log
ML_TUNE_PID ?= $(CURDIR)/data/ml-tune.pid

ML_TUNE_CONFIG_FLAG := $(if $(ML_TUNE_CONFIG),--config $(ML_TUNE_CONFIG),)
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
		$(ML_TUNE_CONFIG_FLAG) \
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

.PHONY: ml-tune-bg
ml-tune-bg: ml-venv ml-bridge
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@if [ -n "$(ML_TUNE_CONFIG)" ]; then \
		$(CURDIR)/ml/.venv/bin/python -c 'import json,sys; from pathlib import Path; import yaml; cfg=Path(sys.argv[1]).expanduser(); \
assert cfg.exists(), f"config not found: {cfg}"; \
data=yaml.safe_load(cfg.read_text(encoding="utf-8")) if cfg.suffix.lower() in {".yaml",".yml"} else json.loads(cfg.read_text(encoding="utf-8")); \
assert isinstance(data, dict), "config must be a mapping object"; \
data_value=data.get("data"); \
assert data_value, "config missing required \"data\" path"; \
data_path=Path(str(data_value)).expanduser(); \
data_path=(cfg.parent / data_path).resolve() if not data_path.is_absolute() else data_path; \
assert data_path.exists(), f"data path not found: {data_path}";' "$(ML_TUNE_CONFIG)" || exit 1; \
	fi
	@mkdir -p "$(dir $(ML_TUNE_LOG))"
	@if command -v setsid >/dev/null 2>&1; then \
		setsid $(CURDIR)/ml/.venv/bin/python ml/tune.py \
			$(ML_TUNE_CONFIG_FLAG) \
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
			$(ML_TUNE_EXTRA_ARGS) \
			</dev/null > "$(ML_TUNE_LOG)" 2>&1 & \
		echo $$! | tee "$(ML_TUNE_PID)"; \
	else \
		nohup $(CURDIR)/ml/.venv/bin/python ml/tune.py \
			$(ML_TUNE_CONFIG_FLAG) \
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
			$(ML_TUNE_EXTRA_ARGS) \
			</dev/null > "$(ML_TUNE_LOG)" 2>&1 & \
		echo $$! | tee "$(ML_TUNE_PID)"; \
	fi

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
DATASET_TARGET_MOVES ?=

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
		$(if $(DATASET_TARGET_MOVES),DATASET_TARGET_MOVES="$(DATASET_TARGET_MOVES)") \
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
		$(if $(DATASET_TARGET_MOVES),DATASET_TARGET_MOVES="$(DATASET_TARGET_MOVES)") \
		nohup ./target/release/mazle-generator </dev/null > "$(DATASET_LOG)" 2>&1 & \
		echo $$! | tee "$(DATASET_PID)"; \
	fi

# -------------------------
# Daily KV backfill (native, outside Docker)
# -------------------------
ROOT_APP_NAME := $(shell sed -n 's/^APP_NAME[[:space:]]*:=[[:space:]]*//p' $(REPO_ROOT)/Makefile | head -n 1 | cut -d ' ' -f1)
BWS_PROJECT_NAME_FOR_KV ?= $(ROOT_APP_NAME)-$(ENV)

DAILIES_KV_START ?=
DAILIES_KV_END ?=
DAILIES_KV_FORCE ?= 0
DAILIES_KV_MAP_TYPE ?= ice
DAILIES_KV_PARALLEL ?= 1
DAILIES_KV_CLOSENESS_THRESHOLD ?= 0.99
DAILIES_KV_TARGET_MOVES ?=
DAILIES_KV_LOG ?= $(CURDIR)/data/dailies-kv-backfill.log
DAILIES_KV_PID ?= $(CURDIR)/data/dailies-kv-backfill.pid

.PHONY: dailies-kv-backfill
dailies-kv-backfill: RUST_BUILD_PROFILE := release
dailies-kv-backfill: cargo-build
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@if [ -z "$(DAILIES_KV_START)" ]; then \
		echo "DAILIES_KV_START not set. Example: make dailies-kv-backfill ENV=prod DAILIES_KV_START=2026-01-01 DAILIES_KV_END=2026-01-30"; \
		exit 1; \
	fi
	@if [ -z "$(DAILIES_KV_END)" ]; then \
		echo "DAILIES_KV_END not set. Example: make dailies-kv-backfill ENV=prod DAILIES_KV_START=2026-01-01 DAILIES_KV_END=2026-01-30"; \
		exit 1; \
	fi
	@if [ "$(ENV)" != "prod" ]; then \
		echo "[ERROR] ENV=$(ENV) not allowed. Run with: make dailies-kv-backfill ENV=prod ..."; \
		exit 1; \
	fi
	@if [ -z "$$BWS_ACCESS_TOKEN" ]; then \
		echo "[ERROR] BWS_ACCESS_TOKEN is required to fetch KV secrets from Bitwarden." >&2; \
		exit 1; \
	fi
	@mkdir -p "$(dir $(DAILIES_KV_LOG))"
	@export BWS_PROJECT_NAME="$(BWS_PROJECT_NAME_FOR_KV)"; \
	echo "[INFO] [Dailies KV Backfill] Fetching KV secrets from BWS project '$$BWS_PROJECT_NAME'..."; \
	SECRETS_JSON="$$( "$(DEVOPS_TOOLKIT_PATH)/shared/scripts/fetch_bws_secret.sh" )"; \
	KV_URL="$$(echo "$$SECRETS_JSON" | jq -r '.KV_REST_API_URL // .UPSTASH_REDIS_REST_URL // empty')"; \
	KV_TOKEN="$$(echo "$$SECRETS_JSON" | jq -r '.KV_REST_API_TOKEN // .UPSTASH_REDIS_REST_TOKEN // empty')"; \
	if [ -z "$$KV_URL" ] || [ -z "$$KV_TOKEN" ]; then \
		echo "[ERROR] Missing KV secrets in BWS project '$$BWS_PROJECT_NAME' (need KV_REST_API_URL+KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN)" >&2; \
		exit 1; \
	fi; \
	if command -v setsid >/dev/null 2>&1; then \
		ENV="$(ENV)" \
		KV_REST_API_URL="$$KV_URL" \
		KV_REST_API_TOKEN="$$KV_TOKEN" \
		DAILIES_KV_START="$(DAILIES_KV_START)" \
		DAILIES_KV_END="$(DAILIES_KV_END)" \
		DAILIES_KV_FORCE="$(DAILIES_KV_FORCE)" \
		DAILIES_KV_MAP_TYPE="$(DAILIES_KV_MAP_TYPE)" \
		DAILIES_KV_PARALLEL="$(DAILIES_KV_PARALLEL)" \
		DAILIES_KV_CLOSENESS_THRESHOLD="$(DAILIES_KV_CLOSENESS_THRESHOLD)" \
		$(if $(DAILIES_KV_TARGET_MOVES),DAILIES_KV_TARGET_MOVES="$(DAILIES_KV_TARGET_MOVES)") \
		setsid ./target/release/mazle-generator </dev/null > "$(DAILIES_KV_LOG)" 2>&1 & \
		echo $$! | tee "$(DAILIES_KV_PID)"; \
	else \
		ENV="$(ENV)" \
		KV_REST_API_URL="$$KV_URL" \
		KV_REST_API_TOKEN="$$KV_TOKEN" \
		DAILIES_KV_START="$(DAILIES_KV_START)" \
		DAILIES_KV_END="$(DAILIES_KV_END)" \
		DAILIES_KV_FORCE="$(DAILIES_KV_FORCE)" \
		DAILIES_KV_MAP_TYPE="$(DAILIES_KV_MAP_TYPE)" \
		DAILIES_KV_PARALLEL="$(DAILIES_KV_PARALLEL)" \
		DAILIES_KV_CLOSENESS_THRESHOLD="$(DAILIES_KV_CLOSENESS_THRESHOLD)" \
		$(if $(DAILIES_KV_TARGET_MOVES),DAILIES_KV_TARGET_MOVES="$(DAILIES_KV_TARGET_MOVES)") \
		nohup ./target/release/mazle-generator </dev/null > "$(DAILIES_KV_LOG)" 2>&1 & \
		echo $$! | tee "$(DAILIES_KV_PID)"; \
	fi

# -------------------------
# Multi-move dataset generation (4-9, 11-14 moves, skips 10)
# -------------------------
MULTIMOVE_COUNTS ?= 4 5 6 7 8 9 11 12 13 14
MULTIMOVE_PER_MOVE ?= 20000
MULTIMOVE_START_INDEX ?=
MULTIMOVE_DATA_DIR ?= $(CURDIR)/data

.PHONY: dataset-gen-multimove
dataset-gen-multimove: RUST_BUILD_PROFILE := release
dataset-gen-multimove: cargo-build
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@mkdir -p "$(MULTIMOVE_DATA_DIR)"
	@for moves in $(MULTIMOVE_COUNTS); do \
		outfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.jsonl"; \
		logfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.log"; \
		pidfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.pid"; \
		if [ -n "$(MULTIMOVE_START_INDEX)" ]; then \
			start="$(MULTIMOVE_START_INDEX)"; \
			remaining="$(MULTIMOVE_PER_MOVE)"; \
			echo "$${moves}-move: Manual mode - starting from index $$start, generating $$remaining"; \
		else \
			existing=$$(wc -l < "$$outfile" 2>/dev/null | tr -d ' ' || echo 0); \
			remaining=$$(($(MULTIMOVE_PER_MOVE) - existing)); \
			start=$$((existing + 1)); \
			echo "$${moves}-move: Auto mode - file has $$existing, need $$remaining more (starting at $$start)"; \
		fi; \
		if [ $$remaining -le 0 ]; then \
			echo "$${moves}-move: already complete"; \
		elif [ -f "$$pidfile" ] && ps -p $$(cat "$$pidfile") > /dev/null 2>&1; then \
			echo "$${moves}-move: already running (PID $$(cat $$pidfile))"; \
		else \
			if command -v setsid >/dev/null 2>&1; then \
				DATASET_OUT="$$outfile" \
				DATASET_COUNT="$$remaining" \
				DATASET_START_INDEX="$$start" \
				DATASET_SEED_PREFIX="train-$${moves}m" \
				DATASET_TARGET_MOVES="$$moves" \
				DATASET_APPEND="1" \
				setsid ./target/release/mazle-generator </dev/null > "$$logfile" 2>&1 & \
				echo $$! | tee "$$pidfile"; \
			else \
				DATASET_OUT="$$outfile" \
				DATASET_COUNT="$$remaining" \
				DATASET_START_INDEX="$$start" \
				DATASET_SEED_PREFIX="train-$${moves}m" \
				DATASET_TARGET_MOVES="$$moves" \
				DATASET_APPEND="1" \
				nohup ./target/release/mazle-generator </dev/null > "$$logfile" 2>&1 & \
				echo $$! | tee "$$pidfile"; \
			fi; \
		fi; \
	done
	@# Start the watcher to auto-restart dead generators
	@$(MAKE) --no-print-directory dataset-gen-multimove-watcher UNIQUE_RUNNER_ID="$(UNIQUE_RUNNER_ID)"

.PHONY: dataset-gen-multimove-status
dataset-gen-multimove-status:
	@total=0; running=0; \
	for moves in $(MULTIMOVE_COUNTS); do \
		outfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.jsonl"; \
		pidfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.pid"; \
		count=$$(wc -l < "$$outfile" 2>/dev/null | tr -d ' ' || echo 0); \
		total=$$((total + count)); \
		if [ -f "$$pidfile" ] && ps -p $$(cat "$$pidfile") > /dev/null 2>&1; then \
			status="running"; running=$$((running + 1)); \
		else \
			status="stopped"; \
		fi; \
		printf "%2d-move: %5d / $(MULTIMOVE_PER_MOVE) (%s)\n" $$moves $$count $$status; \
	done; \
	echo "---"; \
	echo "Total: $$total / $$(($(MULTIMOVE_PER_MOVE) * 10)) ($$running running)"

.PHONY: dataset-gen-multimove-stop
dataset-gen-multimove-stop:
	@# Stop watcher first
	@watcherpid="$(MULTIMOVE_DATA_DIR)/multimove-watcher.pid"; \
	if [ -f "$$watcherpid" ]; then \
		pid=$$(cat "$$watcherpid"); \
		if ps -p $$pid > /dev/null 2>&1; then \
			kill $$pid 2>/dev/null && echo "Killed watcher (PID $$pid)"; \
		fi; \
		rm -f "$$watcherpid"; \
	fi
	@for moves in $(MULTIMOVE_COUNTS); do \
		pidfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.pid"; \
		if [ -f "$$pidfile" ]; then \
			pid=$$(cat "$$pidfile"); \
			if ps -p $$pid > /dev/null 2>&1; then \
				kill $$pid 2>/dev/null && echo "Killed $${moves}-move (PID $$pid)"; \
			fi; \
		fi; \
	done

# Internal target to restart dead generators (called by watcher)
.PHONY: dataset-gen-multimove-restart-dead
dataset-gen-multimove-restart-dead:
	@for moves in $(MULTIMOVE_COUNTS); do \
		outfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.jsonl"; \
		logfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.log"; \
		pidfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.pid"; \
		existing=$$(wc -l < "$$outfile" 2>/dev/null | tr -d ' ' || echo 0); \
		remaining=$$(($(MULTIMOVE_PER_MOVE) - existing)); \
		start=$$((existing + 1)); \
		if [ $$remaining -le 0 ]; then \
			: ; \
		elif [ -f "$$pidfile" ] && ps -p $$(cat "$$pidfile") > /dev/null 2>&1; then \
			: ; \
		else \
			echo "$$(date '+%Y-%m-%d %H:%M:%S') Restarting $${moves}-move from index $$start ($$existing done)"; \
			if command -v setsid >/dev/null 2>&1; then \
				DATASET_OUT="$$outfile" \
				DATASET_COUNT="$$remaining" \
				DATASET_START_INDEX="$$start" \
				DATASET_SEED_PREFIX="train-$${moves}m" \
				DATASET_TARGET_MOVES="$$moves" \
				setsid ./target/release/mazle-generator </dev/null >> "$$logfile" 2>&1 & \
				echo $$! > "$$pidfile"; \
			else \
				DATASET_OUT="$$outfile" \
				DATASET_COUNT="$$remaining" \
				DATASET_START_INDEX="$$start" \
				DATASET_SEED_PREFIX="train-$${moves}m" \
				DATASET_TARGET_MOVES="$$moves" \
				nohup ./target/release/mazle-generator </dev/null >> "$$logfile" 2>&1 & \
				echo $$! > "$$pidfile"; \
			fi; \
		fi; \
	done

# Watcher process that monitors and restarts dead generators every 15 seconds
.PHONY: dataset-gen-multimove-watcher
dataset-gen-multimove-watcher:
	@if [ -z "$(UNIQUE_RUNNER_ID)" ]; then \
		echo "UNIQUE_RUNNER_ID not set. Run: export UNIQUE_RUNNER_ID=\$$(whoami)"; \
		exit 1; \
	fi
	@watcherpid="$(MULTIMOVE_DATA_DIR)/multimove-watcher.pid"; \
	watcherlog="$(MULTIMOVE_DATA_DIR)/multimove-watcher.log"; \
	if [ -f "$$watcherpid" ] && ps -p $$(cat "$$watcherpid") > /dev/null 2>&1; then \
		echo "Watcher already running (PID $$(cat $$watcherpid))"; \
	else \
		echo "Starting watcher..."; \
		( \
			while true; do \
				total=0; complete=0; \
				for moves in $(MULTIMOVE_COUNTS); do \
					outfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.jsonl"; \
					count=$$(wc -l < "$$outfile" 2>/dev/null | tr -d ' ' || echo 0); \
					total=$$((total + count)); \
					if [ $$count -ge $(MULTIMOVE_PER_MOVE) ]; then \
						complete=$$((complete + 1)); \
					fi; \
				done; \
				if [ $$complete -eq 10 ]; then \
					echo "$$(date '+%Y-%m-%d %H:%M:%S') All complete! Total: $$total samples. Watcher exiting."; \
					rm -f "$(MULTIMOVE_DATA_DIR)/multimove-watcher.pid"; \
					exit 0; \
				fi; \
				for moves in $(MULTIMOVE_COUNTS); do \
					outfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.jsonl"; \
					logfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.log"; \
					pidfile="$(MULTIMOVE_DATA_DIR)/train-$${moves}move.pid"; \
					existing=$$(wc -l < "$$outfile" 2>/dev/null | tr -d ' ' || echo 0); \
					remaining=$$(($(MULTIMOVE_PER_MOVE) - existing)); \
					start=$$((existing + 1)); \
					if [ $$remaining -le 0 ]; then \
						: ; \
					elif [ -f "$$pidfile" ] && ps -p $$(cat "$$pidfile") > /dev/null 2>&1; then \
						: ; \
					else \
						echo "$$(date '+%Y-%m-%d %H:%M:%S') Restarting $${moves}-move from index $$start ($$existing done)"; \
						DATASET_OUT="$$outfile" \
						DATASET_COUNT="$$remaining" \
						DATASET_START_INDEX="$$start" \
						DATASET_SEED_PREFIX="train-$${moves}m" \
						DATASET_TARGET_MOVES="$$moves" \
						nohup $(CURDIR)/target/release/mazle-generator </dev/null >> "$$logfile" 2>&1 & \
						echo $$! > "$$pidfile"; \
					fi; \
				done; \
				sleep 15; \
			done \
		) >> "$$watcherlog" 2>&1 & \
		echo $$! | tee "$$watcherpid"; \
		echo "Watcher started. Log: $$watcherlog"; \
	fi
