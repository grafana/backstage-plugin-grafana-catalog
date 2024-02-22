#!/usr/bin/env bash

#apt-get update
# sudo apt-get install -y git 

# Installs devenv tools required when running on Ubuntu Linux.
ROOT_DIR=$(git rev-parse --show-toplevel)

source ${ROOT_DIR}/devenv/scripts/_requirements.sh
echo ${GO_VERSION}
echo ${ROOT_DIR}
echo ${CURL_MAJOR_VERSION}
echo ${KUBECTL_VERSION}

set -euxo pipefail

# Install docker tools needed for tilt
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --batch --dearmor | sudo tee /etc/apt/keyrings/docker.gpg > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$UBUNTU_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

export PATH=${PATH}:/usr/local/go/bin

# Install with Go:
go install sigs.k8s.io/kind@v${KIND_VERSION}

# Install tilt and ctlptl
curl -fsSL "https://raw.githubusercontent.com/tilt-dev/tilt/v${TILT_VERSION}/scripts/install.sh" | sudo bash
curl -fsSL "https://github.com/tilt-dev/ctlptl/releases/download/v${CTLPTL_VERSION}/ctlptl.${CTLPTL_VERSION}.linux.x86_64.tar.gz" | sudo tar -xzv -C /usr/local/bin ctlptl
