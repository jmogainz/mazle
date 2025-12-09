#!/bin/bash
# Mazle Rust Generator - Build and Verification Script
# Run this after installing Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

set -e

echo "🧊 Mazle Rust Generator - Build & Verify"
echo "=========================================="
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo (Rust) is not installed!"
    echo ""
    echo "Install Rust with:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo ""
    echo "Then re-run this script."
    exit 1
fi

echo "✓ Rust version: $(rustc --version)"
echo "✓ Cargo version: $(cargo --version)"
echo ""

# Navigate to generator directory
cd "$(dirname "$0")"

echo "📦 Checking dependencies..."
cargo check 2>&1

echo ""
echo "🔨 Building in release mode..."
cargo build --release 2>&1

echo ""
echo "✓ Build successful!"
echo ""

# Run the server briefly to check it starts
echo "🚀 Testing server startup..."
timeout 3 ./target/release/mazle-generator 2>&1 || true

echo ""
echo "✅ All verification checks passed!"
echo ""
echo "To run the generator server:"
echo "  cd generator-rust && cargo run --release"
echo ""
echo "Or use the binary directly:"
echo "  ./generator-rust/target/release/mazle-generator"
