#!/bin/bash
set -e

echo ""
echo "============================================"
echo "   AI API Gateway - One-Click Deploy"
echo "============================================"
echo ""

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- Pre-flight checks ----
if [ "$(id -u)" -ne 0 ]; then
    error "Please run as root: sudo bash deploy.sh"
fi

if [ ! -f .env ]; then
    error ".env file not found. Copy .env.example to .env and edit it first."
fi

# ---- Step 1: Install Docker ----
info "Checking Docker..."
if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    info "Docker installed."
else
    info "Docker already installed: $(docker --version)"
fi

# ---- Step 2: Check Docker Compose ----
info "Checking Docker Compose..."
if docker compose version &>/dev/null; then
    info "Docker Compose v2 ready."
elif command -v docker-compose &>/dev/null; then
    warn "Found docker-compose v1. Consider upgrading to v2."
    alias docker-compose='docker compose'
else
    info "Installing Docker Compose plugin..."
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

# ---- Step 3: Generate session secret if default ----
SECRET=$(grep SESSION_SECRET .env | cut -d'=' -f2)
if [ -z "$SECRET" ] || [ "$SECRET" = "change-this-to-a-random-string-at-least-32-chars-long" ]; then
    info "Generating secure session secret..."
    NEW_SECRET=$(openssl rand -hex 32)
    sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${NEW_SECRET}|" .env
    info "Session secret generated."
fi

# ---- Step 4: Create directories ----
info "Creating directories..."
mkdir -p data nginx/conf.d nginx/certs nginx/logs html

# ---- Step 5: Pull and start ----
info "Pulling latest images..."
docker compose pull

info "Starting services..."
docker compose up -d

# ---- Step 6: Wait for health ----
info "Waiting for services to start..."
sleep 5
for i in $(seq 1 12); do
    if curl -sf http://localhost:3000/api/status &>/dev/null; then
        info "New-API is up and running!"
        break
    fi
    echo -n "."
    sleep 3
done

if ! curl -sf http://localhost:3000/api/status &>/dev/null; then
    error "New-API failed to start. Check logs: docker compose logs new-api"
fi

# ---- Step 7: Show info ----
SERVER_IP=$(curl -sf https://ifconfig.me 2>/dev/null || curl -sf https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo "============================================"
echo "   Deployment Complete!"
echo "============================================"
echo ""
echo "  API Dashboard:  http://${SERVER_IP}:3000"
echo "  Default User:   root"
echo "  Default Pass:   123456"
echo ""
echo "  Next steps:"
echo "  1. Open the dashboard and CHANGE THE PASSWORD"
echo "  2. Go to Channels -> Add QuickRouter as upstream"
echo "  3. Set your pricing ratios in Settings"
echo "  4. Create tokens for your users"
echo "  5. Configure domain + SSL (see README.md)"
echo ""
echo "============================================"
