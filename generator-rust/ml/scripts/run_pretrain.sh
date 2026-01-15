#!/usr/bin/env bash
set -euo pipefail

# Note: build the Rust bridge separately (one-time) via:
#   export UNIQUE_RUNNER_ID=$(whoami)
#   cd /Users/jmogainz/mazle/generator-rust && make ml-bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ML_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ML_DIR}/.." && pwd)"

CONFIG_PATH="${ML_CONFIG:-$ML_DIR/config/pretrain.yaml}"
DATA_PATH="${ML_DATA:-}"
OUT_DIR="${ML_OUT:-}"
DATA_COUNT="${ML_DATA_COUNT:-}"
EPOCHS="${ML_EPOCHS:-}"
BATCH_SIZE="${ML_BATCH_SIZE:-}"
PRESET="${ML_PRESET:-}"
VAL_PCT="${ML_VAL_PCT:-}"
TEST_PCT="${ML_TEST_PCT:-}"
SHUFFLE_BUFFER="${ML_SHUFFLE_BUFFER:-}"
EVAL_STEPS="${ML_EVAL_STEPS:-}"
SOLVER_EVAL="${ML_SOLVER_EVAL:-}"
SOLVER_EVAL_SAMPLES="${ML_SOLVER_SAMPLES:-}"
SOLVER_TARGET_MOVES="${ML_SOLVER_TARGET_MOVES:-}"
AMP="${ML_AMP:-}"
COMPILE="${ML_COMPILE:-}"
EVAL_TEST="${ML_EVAL_TEST:-}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
VENV_DIR="${VENV_DIR:-$ML_DIR/.venv}"
EXTRA_ARGS="${ML_EXTRA_ARGS:-}"

if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

source "${VENV_DIR}/bin/activate"

if [[ "${INSTALL_DEPS}" == "1" ]]; then
  pip install -r "${ML_DIR}/requirements.txt"
fi

cmd=(
  python3 "${ML_DIR}/pretrain.py"
  --config "${CONFIG_PATH}"
)

if [[ -n "${DATA_PATH}" ]]; then
  cmd+=(--data "${DATA_PATH}")
fi
if [[ -n "${OUT_DIR}" ]]; then
  cmd+=(--out "${OUT_DIR}")
fi
if [[ -n "${DATA_COUNT}" ]]; then
  cmd+=(--data-count "${DATA_COUNT}")
fi
if [[ -n "${EPOCHS}" ]]; then
  cmd+=(--epochs "${EPOCHS}")
fi
if [[ -n "${BATCH_SIZE}" ]]; then
  cmd+=(--batch-size "${BATCH_SIZE}")
fi
if [[ -n "${PRESET}" ]]; then
  cmd+=(--preset "${PRESET}")
fi
if [[ -n "${VAL_PCT}" ]]; then
  cmd+=(--val-pct "${VAL_PCT}")
fi
if [[ -n "${TEST_PCT}" ]]; then
  cmd+=(--test-pct "${TEST_PCT}")
fi
if [[ -n "${SHUFFLE_BUFFER}" ]]; then
  cmd+=(--shuffle-buffer "${SHUFFLE_BUFFER}")
fi
if [[ -n "${EVAL_STEPS}" ]]; then
  cmd+=(--eval-steps "${EVAL_STEPS}")
fi
if [[ -n "${AMP}" ]]; then
  if [[ "${AMP}" == "1" ]]; then
    cmd+=(--amp)
  else
    cmd+=(--no-amp)
  fi
fi
if [[ -n "${COMPILE}" ]]; then
  if [[ "${COMPILE}" == "1" ]]; then
    cmd+=(--compile)
  else
    cmd+=(--no-compile)
  fi
fi
if [[ -n "${EVAL_TEST}" ]]; then
  if [[ "${EVAL_TEST}" == "1" ]]; then
    cmd+=(--eval-test)
  else
    cmd+=(--no-eval-test)
  fi
fi
if [[ -n "${SOLVER_EVAL}" ]]; then
  if [[ "${SOLVER_EVAL}" == "1" ]]; then
    cmd+=(--solver-eval)
  else
    cmd+=(--no-solver-eval)
  fi
fi
if [[ -n "${SOLVER_EVAL_SAMPLES}" ]]; then
  cmd+=(--solver-eval-samples "${SOLVER_EVAL_SAMPLES}")
fi
if [[ -n "${SOLVER_TARGET_MOVES}" ]]; then
  cmd+=(--solver-target-moves "${SOLVER_TARGET_MOVES}")
fi

if [[ -n "${EXTRA_ARGS}" ]]; then
  read -r -a extra <<< "${EXTRA_ARGS}"
  cmd+=("${extra[@]}")
fi

"${cmd[@]}"
