#!/bin/bash
# EC2 user data: cloud-init runs this once, as root, on first boot of an Ubuntu 24.04 instance.
# Installs Docker + Compose and nothing else — the app arrives with deploy/push.sh.
# Progress and errors: /var/log/cloud-init-output.log on the instance.
set -euxo pipefail

# Builds (pnpm install, sharp, prisma) are memory-hungry; swap keeps a 4 GB box from OOMing.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 rsync
systemctl enable --now docker
usermod -aG docker ubuntu
mkdir -p /home/ubuntu/shutter && chown ubuntu:ubuntu /home/ubuntu/shutter
