#!/bin/sh
set -e

REPO="geongeorge/nakedclaw"
INSTALL_DIR="/usr/local/bin"

# Detect OS + arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')    # darwin / linux
ARCH=$(uname -m)                                 # arm64 / x86_64
case "$ARCH" in x86_64) ARCH="x64" ;; aarch64) ARCH="arm64" ;; esac

# Fetch latest release tag
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')

if [ -z "$TAG" ]; then
  echo "Error: could not determine latest release."
  exit 1
fi

# Download binary
ASSET="nakedclaw-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"

echo "Downloading NakedClaw $TAG ($OS/$ARCH)..."
curl -fsSL "$URL" -o /tmp/nakedclaw
chmod +x /tmp/nakedclaw

# Install (sudo if needed)
if [ -w "$INSTALL_DIR" ]; then
  mv /tmp/nakedclaw "$INSTALL_DIR/nakedclaw"
else
  echo "Need sudo to install to $INSTALL_DIR"
  sudo mv /tmp/nakedclaw "$INSTALL_DIR/nakedclaw"
fi

echo "Installed nakedclaw to $INSTALL_DIR/nakedclaw"
echo ""
echo "Get started:"
echo "  nakedclaw setup    # configure credentials"
echo "  nakedclaw start    # start daemon"
echo "  nakedclaw          # chat"
