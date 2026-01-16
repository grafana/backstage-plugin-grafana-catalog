#!/usr/bin/env bash

# Installs devenv tools required when running on Ubuntu Linux.
ROOT_DIR=$(git rev-parse --show-toplevel)

# Updated versions for Docker API 1.44+ compatibility
KIND_VERSION="0.25.0"
GO_VERSION="1.23.0"
# jq and kubectl are installed from the operating system repository, we don't use a version directly.
TILT_VERSION="0.33.20"
CTLPTL_VERSION="0.8.35"
YARN_VERSION="1.22.22"
KUBECTL_VERSION="1.31"

echo "Go version: ${GO_VERSION}"
echo "Root dir: ${ROOT_DIR}"
echo "Kind version: ${KIND_VERSION}"
echo "Tilt version: ${TILT_VERSION}"
echo "ctlptl version: ${CTLPTL_VERSION}"

set -euxo pipefail

# GitHub Actions runners already have Docker installed with API 1.44+
# Skip Docker reinstallation to avoid version conflicts
echo "Using pre-installed Docker from GitHub Actions runner"
docker version

export PATH=${PATH}:/usr/local/go/bin:${HOME}/go/bin

# Install Go if not present or version is too old
if ! command -v go &> /dev/null || [[ $(go version | grep -oE '[0-9]+\.[0-9]+' | head -1) < "1.21" ]]; then
    echo "Installing Go ${GO_VERSION}..."
    cd /tmp
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o go.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf go.tar.gz
    rm go.tar.gz
    cd -
fi

# Install kind with Go
echo "Installing kind ${KIND_VERSION}..."
go install sigs.k8s.io/kind@v${KIND_VERSION}

# Install tilt and ctlptl
echo "Installing tilt ${TILT_VERSION}..."
curl -fsSL "https://raw.githubusercontent.com/tilt-dev/tilt/v${TILT_VERSION}/scripts/install.sh" | sudo bash

echo "Installing ctlptl ${CTLPTL_VERSION}..."
curl -fsSL "https://github.com/tilt-dev/ctlptl/releases/download/v${CTLPTL_VERSION}/ctlptl.${CTLPTL_VERSION}.linux.x86_64.tar.gz" | sudo tar -xzv -C /usr/local/bin ctlptl

# Verify installations
echo "Verifying installations..."
kind version
tilt version
ctlptl version
docker version
