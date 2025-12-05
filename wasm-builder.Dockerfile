# syntax=docker/dockerfile:1.4

# ----------------------------------------------------------------------
# WASM Builder Dockerfile
# ----------------------------------------------------------------------
# Minimal tool image for building the WASM generator.
# Follows the 'migrate' pattern from devops-toolkit.
# ----------------------------------------------------------------------

ARG RUST_VERSION=1.83
ARG WASM_PACK_VERSION=0.13.1
ARG RUST_TOOLCHAIN=nightly

FROM rust:${RUST_VERSION}-slim-bookworm AS wasm-tools

# Re-declare ARGs used in this stage
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

# Preinstall the toolchain used by generator-rust (nightly with rust-src + wasm target)
RUN rustup toolchain install ${RUST_TOOLCHAIN} --profile minimal --component rust-src --target wasm32-unknown-unknown

# ----------------------------------------------------------------------
# Copy Builder Script
# ----------------------------------------------------------------------
WORKDIR /app
COPY scripts/wasm_builder_cmd.sh /usr/local/bin/wasm_builder_cmd.sh
RUN chmod +x /usr/local/bin/wasm_builder_cmd.sh

# Default envs
ENV PATH="/usr/local/cargo/bin:${PATH}"

# Run the builder script by default
CMD ["/usr/local/bin/wasm_builder_cmd.sh"]
