# syntax=docker/dockerfile:1.4

# ----------------------------------------------------------------------
# WASM Builder Dockerfile
# ----------------------------------------------------------------------
# Multi-stage build that compiles Rust→WASM at BUILD time using Docker
# build cache mounts (persist across `make clean`). Runtime stage simply
# copies pre-built artifacts to the mounted workspace.
# ----------------------------------------------------------------------

ARG RUST_VERSION=1.83
ARG WASM_PACK_VERSION=0.13.1
ARG RUST_TOOLCHAIN=nightly-2025-11-15

#######################################
# Stage 1: Base with wasm-pack & toolchain
#######################################
FROM rust:${RUST_VERSION}-slim-bookworm AS base

ARG WASM_PACK_VERSION
ARG RUST_TOOLCHAIN

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install wasm-pack (locked version for repeatability)
RUN cargo install wasm-pack --version ${WASM_PACK_VERSION} --locked

# Preinstall the exact toolchain from rust-toolchain.toml
# rust-src is required for build-std (rebuilding std with atomics)
RUN rustup toolchain install ${RUST_TOOLCHAIN} --profile minimal --component rust-src --target wasm32-unknown-unknown && \
    rustup default ${RUST_TOOLCHAIN}

WORKDIR /app

#######################################
# Stage 2: Builder (compile WASM)
#######################################
FROM base AS builder

# Build-time environment indicator (used to optionally skip wasm build when artifacts already exist)
ARG BUILD_ENV=dev-test

# Copy any pre-built artifacts from the workspace so we can reuse them in non-prod builds
COPY src/wasm/generator ./prebuilt-wasm

# Copy cargo config (contains RUSTFLAGS for atomics/bulk-memory)
COPY generator-rust/.cargo .cargo/

# Copy manifests and toolchain config
COPY generator-rust/Cargo.toml generator-rust/Cargo.lock generator-rust/rust-toolchain.toml ./

# Copy source code
COPY generator-rust/src/ src/

# Build the WASM module
# Cache mounts persist across builds:
#   - registry: downloaded crates (reused when Cargo.lock unchanged)
#   - git: git dependencies
#   - target: compiled artifacts (smart incremental rebuilds)
#   - wasm-hash: stores hash of last successful build for change detection
RUN --mount=type=cache,id=wasm-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=wasm-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=wasm-target,target=/app/target \
    --mount=type=cache,id=wasm-hash,target=/wasm-hash \
    PREBUILT_WASM="/app/prebuilt-wasm/mazle_generator_bg.wasm"; \
    mkdir -p /wasm-output; \
    # Calculate source hash for change detection \
    NEW_HASH=$(find /app/src -type f -name '*.rs' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1); \
    NEW_HASH="${NEW_HASH}-$(sha256sum /app/Cargo.toml | cut -d' ' -f1)"; \
    NEW_HASH="${NEW_HASH}-$(sha256sum /app/Cargo.lock | cut -d' ' -f1)"; \
    OLD_HASH=""; \
    if [ -f /wasm-hash/.build-hash ]; then OLD_HASH=$(cat /wasm-hash/.build-hash); fi; \
    if [ "$BUILD_ENV" != "prod" ] && [ -f "$PREBUILT_WASM" ]; then \
      echo "[WASM] Existing artifacts detected in src/wasm/generator; skipping wasm-pack build for BUILD_ENV=$BUILD_ENV"; \
      echo "skipped" > /wasm-output/.skip; \
    elif [ "$BUILD_ENV" = "prod" ] && [ "$OLD_HASH" = "$NEW_HASH" ] && [ -f /wasm-hash/mazle_generator_bg.wasm ]; then \
      echo "[WASM] Sources unchanged (hash: ${NEW_HASH:0:12}...); copying cached artifacts"; \
      cp /wasm-hash/mazle_generator* /wasm-output/; \
      cp /wasm-hash/package.json /wasm-output/ 2>/dev/null || true; \
    else \
      if [ "$BUILD_ENV" != "prod" ]; then \
        echo "[WASM] No prebuilt artifacts found; building WASM for BUILD_ENV=$BUILD_ENV"; \
      else \
        echo "[WASM] Sources changed or no cache; building WASM for BUILD_ENV=$BUILD_ENV"; \
      fi; \
      wasm-pack build --target web --out-dir /wasm-output --out-name mazle_generator; \
      # Cache artifacts and hash for future builds \
      if [ "$BUILD_ENV" = "prod" ]; then \
        echo "$NEW_HASH" > /wasm-hash/.build-hash; \
        cp /wasm-output/mazle_generator* /wasm-hash/; \
        cp /wasm-output/package.json /wasm-hash/ 2>/dev/null || true; \
      fi; \
    fi

#######################################
# Stage 3: Runtime (copy artifacts)
#######################################
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy pre-built WASM artifacts from builder stage
COPY --from=builder /wasm-output /wasm-output

# Copy the runtime script
COPY scripts/wasm_builder_cmd.sh /usr/local/bin/wasm_builder_cmd.sh
RUN chmod +x /usr/local/bin/wasm_builder_cmd.sh

# Runtime copies artifacts to mounted workspace
CMD ["/usr/local/bin/wasm_builder_cmd.sh"]
