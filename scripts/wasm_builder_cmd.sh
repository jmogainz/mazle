#!/usr/bin/env bash
set -euo pipefail

# ----------------------------------------------------------------------
# wasm_builder_cmd.sh - Copies pre-built WASM artifacts to workspace
# ----------------------------------------------------------------------
#
# The WASM module is built at Docker BUILD time (using cache mounts).
# This runtime script copies the pre-built artifacts to the mounted
# workspace directory.
#
# Inputs (Environment Variables):
#   WASM_OUTPUT_DIR  : Path where WASM artifacts should be copied to
#   HOST_UID/HOST_GID: Optional UID/GID to chown artifacts to
#
# ----------------------------------------------------------------------

echo "[INFO] [WASM] Starting WASM artifact copy..."

: "${WASM_OUTPUT_DIR:?WASM_OUTPUT_DIR is required}"

# Source directory containing pre-built WASM artifacts (from Docker build)
WASM_SOURCE_DIR="/wasm-output"

if [ -f "$WASM_SOURCE_DIR/.skip" ]; then
    echo "[INFO] [WASM] Build was skipped for this ENV; no artifacts to copy."
    exit 0
fi

if [ ! -d "$WASM_SOURCE_DIR" ]; then
    echo "[ERROR] [WASM] Pre-built WASM artifacts not found at $WASM_SOURCE_DIR"
    echo "[ERROR] [WASM] This indicates the Docker build failed. Rebuild the image."
    exit 1
fi

# Ensure output directory exists
mkdir -p "$WASM_OUTPUT_DIR"

echo "[INFO] [WASM] Copying WASM artifacts..."
echo "[INFO] [WASM]   Source: $WASM_SOURCE_DIR"
echo "[INFO] [WASM]   Destination: $WASM_OUTPUT_DIR"

# Always copy artifacts (fast operation, ensures freshness)
cp -r "$WASM_SOURCE_DIR"/* "$WASM_OUTPUT_DIR/"

# Fix permissions if HOST_UID/HOST_GID provided
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
    echo "[INFO] [WASM] Fixing artifact permissions for ${HOST_UID}:${HOST_GID}..."
    chown -R "${HOST_UID}:${HOST_GID}" "$WASM_OUTPUT_DIR"
fi

echo "[INFO] [WASM] Copy complete."
