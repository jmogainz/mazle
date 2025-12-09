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
# Build-time environment indicator (used to optionally skip wasm build when artifacts already exist)
ARG BUILD_ENV=dev-test

#######################################
# Stage 1: Base with wasm-pack & toolchain
#######################################
FROM rust:${RUST_VERSION}-slim-bookworm AS base

ARG WASM_PACK_VERSION
ARG RUST_TOOLCHAIN
ARG BUILD_ENV

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

ARG BUILD_ENV

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
RUN --mount=type=cache,id=wasm-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=wasm-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=wasm-target,target=/app/target \
    PREBUILT_WASM="/app/prebuilt-wasm/mazle_generator_bg.wasm"; \
    mkdir -p /wasm-output; \
    if [ "$BUILD_ENV" != "prod" ] && [ -f "$PREBUILT_WASM" ]; then \
      echo "[WASM] Existing artifacts detected in src/wasm/generator; skipping wasm-pack build for BUILD_ENV=$BUILD_ENV"; \
      echo "skipped" > /wasm-output/.skip; \
    else \
      if [ "$BUILD_ENV" != "prod" ]; then \
        echo "[WASM] No prebuilt artifacts found; building WASM for BUILD_ENV=$BUILD_ENV"; \
      fi; \
      wasm-pack build --target web --out-dir /wasm-output --out-name mazle_generator; \
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
