###############################################################################
#  devops/bootstrap.mk
#  • Sets DEVOPS_PATH – directory of this file (always succeeds)
#  • Sets REPO_ROOT   – git-derived or safe fallback
#  • Adds toolkit path to make’s include search (-I)
###############################################################################

# ── 1. locate the toolkit itself (no external commands) ──────────────────────
DEVOPS_PATH := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
export DEVOPS_PATH

# ── 2. establish REPO_ROOT if caller hasn’t ──────────────────────────────────
ifeq ($(origin REPO_ROOT), undefined)
  REPO_ROOT := $(shell git -C $(DEVOPS_PATH) rev-parse --show-toplevel 2>/dev/null)

  ifeq ($(REPO_ROOT),)                     # git failed → fallback + warning
    REPO_ROOT := $(abspath $(DEVOPS_PATH)/..)
    yellow := \033[33m
    normal := \033[0m
    $(warning [bootstrap] git rev-parse failed; falling back to $(REPO_ROOT))
  endif
endif
export REPO_ROOT

# ── 3. make every “include shared/…” resolve from anywhere ───────────────────
MAKEFLAGS += -I$(DEVOPS_PATH)

INCLUDED_DEVOPS_BOOTSTRAP := 1
