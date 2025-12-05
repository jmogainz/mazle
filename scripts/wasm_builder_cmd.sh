#!/usr/bin/env bash
set -euo pipefail

# ----------------------------------------------------------------------
# wasm_builder_cmd.sh - Compiles Rust to WASM if sources changed
# ----------------------------------------------------------------------
#
# Inputs (Environment Variables):
#   RUST_PROJECT_DIR : Path to the rust project root (containing Cargo.toml)
#   WASM_OUTPUT_DIR  : Path where WASM artifacts should be output
#   WASM_FORCE_REBUILD : Set to "1" to force a rebuild
#   WASM_CHECK_ONLY    : Set to "1" to only check if rebuild is needed (exit 1 if stale)
#   HOST_UID/HOST_GID  : Optional UID/GID to chown artifacts to
#
# ----------------------------------------------------------------------

echo "[INFO] [WASM] Starting WASM build process..."

: "${RUST_PROJECT_DIR:?RUST_PROJECT_DIR is required}"
: "${WASM_OUTPUT_DIR:?WASM_OUTPUT_DIR is required}"

MARKER="${WASM_OUTPUT_DIR}/.build-marker"
HASH_FILE="${WASM_OUTPUT_DIR}/.build-hash"
OUT_NAME="mazle_generator"

# Ensure directories exist
if [ ! -d "$RUST_PROJECT_DIR" ]; then
    echo "[ERROR] Rust project directory not found at $RUST_PROJECT_DIR"
    exit 1
fi

mkdir -p "$WASM_OUTPUT_DIR"

# ----------------------------------------------------------------------
# Calculate Source Hash
# ----------------------------------------------------------------------
# We include:
# - All .rs files in the project
# - Cargo.toml
# - rust-toolchain.toml (if present)
# - Build tool versions (to trigger rebuild on toolchain upgrades)
# ----------------------------------------------------------------------
echo "[INFO] [WASM] Calculating source hash..."

# Construct the hash input stream
hash_input() {
    find "$RUST_PROJECT_DIR" -type f -name '*.rs' -print0 | sort -z | xargs -0 -r sha256sum
    sha256sum "$RUST_PROJECT_DIR/Cargo.toml"
    if [ -f "$RUST_PROJECT_DIR/rust-toolchain.toml" ]; then
        sha256sum "$RUST_PROJECT_DIR/rust-toolchain.toml"
    fi
    # Add versions to the hash
    echo "${WASM_PACK_VERSION:-} ${RUST_TOOLCHAIN:-} ${RUST_VERSION:-}"
}

NEW_HASH=$(hash_input | sha256sum | awk '{print $1}')

# ----------------------------------------------------------------------
# Check Build State
# ----------------------------------------------------------------------
NEEDS_BUILD=1

if [ "${WASM_FORCE_REBUILD:-0}" != "1" ] && [ -f "$HASH_FILE" ]; then
    OLD_HASH=$(cat "$HASH_FILE")
    if [ "$OLD_HASH" = "$NEW_HASH" ]; then
        echo "[INFO] [WASM] Sources unchanged ($NEW_HASH). Skipping build."
        NEEDS_BUILD=0
    fi
fi

# Handle Check-Only Mode
if [ "${WASM_CHECK_ONLY:-0}" = "1" ]; then
    if [ "$NEEDS_BUILD" = "1" ]; then
        echo "[INFO] [WASM] Check result: Stale (rebuild needed)."
        exit 1
    else
        echo "[INFO] [WASM] Check result: Up to date."
        exit 0
    fi
fi

# ----------------------------------------------------------------------
# Execute Build
# ----------------------------------------------------------------------
if [ "$NEEDS_BUILD" = "1" ]; then
    echo "[INFO] [WASM] Rebuilding WASM module..."
    echo "[INFO] [WASM]   Source: $RUST_PROJECT_DIR"
    echo "[INFO] [WASM]   Output: $WASM_OUTPUT_DIR"
    
    # wasm-pack must be run from the rust project directory
    cd "$RUST_PROJECT_DIR"
    
    wasm-pack build --target web --out-dir "$WASM_OUTPUT_DIR" --out-name "$OUT_NAME"
    
    # Update markers
    echo "$NEW_HASH" > "$HASH_FILE"
    touch "$MARKER"
    
    # ----------------------------------------------------------------------
    # Fix Permissions
    # ----------------------------------------------------------------------
    if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
        echo "[INFO] [WASM] Fixing artifact permissions for ${HOST_UID}:${HOST_GID}..."
        chown -R "${HOST_UID}:${HOST_GID}" "$WASM_OUTPUT_DIR"
    fi
    
    echo "[INFO] [WASM] Build complete."
else
    echo "[INFO] [WASM] Up to date. No action taken."
fi
